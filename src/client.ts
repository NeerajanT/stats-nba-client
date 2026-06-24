// Resilient request core for stats.nba.com (and stats.wnba.com).
//
// WHY THIS EXISTS — datacenter IPs are blocked. stats.nba.com returns 403 to
// requests originating from Vercel/AWS/GCP and most cloud hosts. Requests work
// from residential IPs (your laptop, a home server) or through a residential /
// rotating proxy. Set NBA_PROXY_URL (e.g. http://user:pass@host:port), or pass
// `proxyUrl` in options, to route via undici's ProxyAgent. Unset, requests go
// direct. The active mode is logged once per process.
//
// Every call funnels through fetchNba(), which centralizes the browser-mimicking
// headers, inter-request pacing, and exponential backoff + jitter on 429/403/5xx.

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const HOSTS = {
  nba: "https://stats.nba.com/stats",
  wnba: "https://stats.wnba.com/stats",
} as const;

export type League = keyof typeof HOSTS;

// Header set proven against stats.nba.com: a desktop UA + Referer/Origin pinned
// to nba.com + the x-nba-stats-* pair the site's own XHR layer sends. The same
// set works for stats.wnba.com.
export const NBA_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 60_000;
// Minimum spacing between requests (rate-limit friendliness). Override via the
// `spacingMs` option or the NBA_REQUEST_DELAY_MS env var.
const DEFAULT_SPACING_MS = 600;

export type NbaParams = Record<string, string | number | null | undefined>;

export interface FetchNbaOptions {
  /** "nba" (stats.nba.com) or "wnba" (stats.wnba.com). Default "nba". */
  league?: League;
  /** Override the base URL entirely (takes precedence over `league`). */
  baseUrl?: string;
  /** Max retry attempts on 429/403/5xx and network errors. Default 5. */
  maxAttempts?: number;
  /** Per-request timeout in ms. Default 60000. */
  timeoutMs?: number;
  /** Minimum spacing between requests in ms. Default 600 (or NBA_REQUEST_DELAY_MS). */
  spacingMs?: number;
  /** Residential/rotating proxy URL. Default process.env.NBA_PROXY_URL. */
  proxyUrl?: string;
}

let lastRequestAt = 0;
let proxyAgent: unknown = null;
let proxyAgentUrl: string | null = null;
let loggedMode = false;

/** Resolve the fetch implementation: undici's fetch + ProxyAgent when a proxy
 * URL is configured (Node's built-in fetch rejects undici dispatchers), the
 * global fetch otherwise. */
async function getFetcher(proxyUrl: string | undefined): Promise<{
  fetchFn: typeof fetch;
  init: Record<string, unknown>;
}> {
  if (!proxyUrl) {
    if (!loggedMode) {
      console.log(
        "[nba] direct mode — no proxy configured (datacenter IPs will 403)",
      );
      loggedMode = true;
    }
    return { fetchFn: fetch, init: {} };
  }
  const { fetch: undiciFetch, ProxyAgent } = await import("undici");
  if (!proxyAgent || proxyAgentUrl !== proxyUrl) {
    proxyAgent = new ProxyAgent(proxyUrl);
    proxyAgentUrl = proxyUrl;
  }
  if (!loggedMode) {
    console.log("[nba] proxy mode — routing via configured proxy");
    loggedMode = true;
  }
  return {
    fetchFn: undiciFetch as unknown as typeof fetch,
    init: { dispatcher: proxyAgent },
  };
}

function resolveSpacing(opt: number | undefined): number {
  if (typeof opt === "number" && Number.isFinite(opt) && opt >= 0) return opt;
  const v = parseInt(process.env.NBA_REQUEST_DELAY_MS ?? "", 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SPACING_MS;
}

function resolveBaseUrl(opts: FetchNbaOptions): string {
  if (opts.baseUrl) return opts.baseUrl.replace(/\/+$/, "");
  return HOSTS[opts.league ?? "nba"];
}

/**
 * GET {base}/{endpoint}?{params} and return the parsed JSON body.
 *
 * stats.nba.com endpoints require every documented param to be present — pass
 * null/undefined for "empty" params and they're sent as "". Retries 429/403/5xx
 * and network errors with exponential backoff + jitter; non-retryable 4xx (e.g.
 * 400 param errors) throw immediately.
 */
export async function fetchNba(
  endpoint: string,
  params: NbaParams,
  opts: FetchNbaOptions = {},
): Promise<unknown> {
  const url = new URL(`${resolveBaseUrl(opts)}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v == null ? "" : String(v));
  }

  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const spacing = resolveSpacing(opts.spacingMs);
  const proxyUrl = opts.proxyUrl ?? process.env.NBA_PROXY_URL;
  const { fetchFn, init } = await getFetcher(proxyUrl);

  let lastError: Error = new Error("unreachable");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Pace requests so bursts (loops over dates/games) stay polite.
    const wait = lastRequestAt + spacing - Date.now();
    if (wait > 0) await delay(wait);
    lastRequestAt = Date.now();

    try {
      const res = await fetchFn(url.toString(), {
        headers: NBA_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
        ...init,
      } as RequestInit);

      if (res.ok) return await res.json();

      // 429/403 = rate-limited / IP-blocked (sometimes transient through
      // rotating proxies); 5xx = server hiccup. Everything else (400 param
      // errors) won't improve with retries.
      if (![429, 403].includes(res.status) && res.status < 500) {
        throw new Error(`NBA API ${res.status} for ${endpoint}`);
      }
      lastError = new Error(`NBA API ${res.status} for ${endpoint}`);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /NBA API 4\d\d/.test(err.message) &&
        !/4(03|29)/.test(err.message)
      ) {
        throw err; // non-retryable 4xx from the branch above
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < maxAttempts) {
      const backoff = Math.min(2 ** attempt * 1000, 30_000);
      const jitter = Math.random() * 500;
      await delay(backoff + jitter);
    }
  }
  throw lastError;
}

/** 2025 → "2025-26" — the Season string stats.nba.com expects. */
export function seasonString(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/** "2026-01-15" (ISO date) → "01/15/2026" — the DateFrom/DateTo/GameDate
 * format stats.nba.com expects. */
export function toNbaDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

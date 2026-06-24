# stats-nba-client

[![CI](https://github.com/NeerajanT/stats-nba-client/actions/workflows/ci.yml/badge.svg)](https://github.com/NeerajanT/stats-nba-client/actions/workflows/ci.yml)

A small, resilient TypeScript client for **stats.nba.com** and **stats.wnba.com** — the public endpoints behind nba.com/stats. It handles the things that make these endpoints annoying to hit reliably from real apps.

> **Why does stats.nba.com return 403 from my server?**
> Because the NBA blocks datacenter IPs. Requests from **Vercel, AWS, GCP, and most cloud hosts get a `403`**, while the same request from your laptop (a residential IP) works fine. This client gives you (a) the exact browser-style headers the site expects, (b) retry + backoff for the transient blocks, and (c) one-line **residential-proxy routing** so it works from the cloud too.

Extracted from production use at **EdgeFinder** and cleaned up for general use.

## Features

- ✅ The proven browser-mimicking header set (UA + `Referer`/`Origin` + `x-nba-stats-*`)
- ✅ Exponential backoff + jitter on `429` / `403` / `5xx`; non-retryable `4xx` fail fast
- ✅ Polite inter-request pacing (configurable) so loops over dates/games don't hammer the API
- ✅ Optional **residential/rotating proxy** via `undici`'s `ProxyAgent` — the fix for cloud `403`s
- ✅ **WNBA** support (`stats.wnba.com`) with a single option
- ✅ A `normalize()` helper that turns the awkward `{ headers, rowSet }` column format into row objects
- ✅ Zero required dependencies (Node 18+ global `fetch`); `undici` is an optional peer, only needed for the proxy path

## Install

```bash
npm install stats-nba-client
# only needed if you use a proxy:
npm install undici
```

Requires **Node 18+** (uses the global `fetch`).

## Usage

```ts
import { fetchNba, normalize, seasonString, toNbaDate } from "stats-nba-client";

// Yesterday's-style call: NBA scoreboard for a given day.
const raw = await fetchNba("scoreboardv2", {
  GameDate: toNbaDate("2026-01-15"), // "01/15/2026"
  LeagueID: "00",
  DayOffset: 0,
});

// stats.nba.com returns column-oriented tables — normalize to row objects:
const games = normalize(raw); // [{ GAME_ID, HOME_TEAM_ID, ... }, ...]
```

```ts
// A player's shot chart for the current season.
const shots = normalize(
  await fetchNba("shotchartdetail", {
    PlayerID: 201939,
    Season: seasonString(2025), // "2025-26"
    SeasonType: "Regular Season",
    TeamID: 0,
    ContextMeasure: "FGA",
    // NBA endpoints want every documented param present — pass null for "empty":
    DateFrom: null,
    DateTo: null,
  }),
);
```

### WNBA

```ts
const wnbaGames = normalize(
  await fetchNba("leaguegamelog", { LeagueID: "10", Season: "2025" }, { league: "wnba" }),
);
```

### Running from the cloud (getting past the 403)

Point the client at a residential or rotating proxy. Either set an env var:

```bash
export NBA_PROXY_URL="http://user:pass@your-proxy-host:port"
```

…or pass it per call:

```ts
await fetchNba("scoreboardv2", params, { proxyUrl: "http://user:pass@host:port" });
```

When a proxy is configured the client lazily loads `undici` and routes through its `ProxyAgent`. Without one, it goes direct (fine for local/residential runs).

## API

### `fetchNba(endpoint, params, options?) => Promise<unknown>`

GETs `https://stats.nba.com/stats/{endpoint}?{params}` and returns the parsed JSON.

| Option | Default | Description |
|---|---|---|
| `league` | `"nba"` | `"nba"` (stats.nba.com) or `"wnba"` (stats.wnba.com) |
| `baseUrl` | — | Override the base URL entirely (takes precedence over `league`) |
| `maxAttempts` | `5` | Retry attempts on `429`/`403`/`5xx` and network errors |
| `timeoutMs` | `60000` | Per-request timeout |
| `spacingMs` | `600` | Minimum spacing between requests (or `NBA_REQUEST_DELAY_MS`) |
| `proxyUrl` | `NBA_PROXY_URL` | Residential/rotating proxy URL |

### `normalize(response, which?) => Record<string, unknown>[]`

Zips a result set's `headers` + `rowSet` into row objects. `which` selects a set by index (default `0`) or by `name`. Handles both the `resultSets: [...]` and single `resultSet: {...}` shapes; returns `[]` for missing/empty tables.

- `normalizeAll(response)` → every set keyed by name.
- `rowsFromResultSet(set)` → zip one raw set.

### Helpers

- `seasonString(2025)` → `"2025-26"`
- `toNbaDate("2026-01-15")` → `"01/15/2026"`
- `NBA_HEADERS` — the exported header set, if you want to make your own requests.

## Notes & etiquette

- These are **undocumented public endpoints**. Be polite: keep the default pacing, cache responses, and don't hammer them. This library is for analytics/research, not abuse.
- No API key is required (and none is included). The proxy URL is always supplied by you.

## License

[MIT](./LICENSE)

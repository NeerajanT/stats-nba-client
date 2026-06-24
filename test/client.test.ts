import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock undici so the proxy path is exercised without a real network/proxy.
vi.mock("undici", () => ({
  fetch: vi.fn(),
  ProxyAgent: vi.fn().mockImplementation(function (this: any, url: string) {
    this.url = url;
  }),
}));

import { fetchNba, seasonString, toNbaDate } from "../src/client";
import { fetch as undiciFetch, ProxyAgent } from "undici";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("date / season helpers", () => {
  it("seasonString formats the NBA season string", () => {
    expect(seasonString(2025)).toBe("2025-26");
    expect(seasonString(1999)).toBe("1999-00");
  });

  it("toNbaDate reformats ISO dates to MM/DD/YYYY", () => {
    expect(toNbaDate("2026-01-15")).toBe("01/15/2026");
    expect(toNbaDate("2026-01-15T12:00:00Z")).toBe("01/15/2026");
  });
});

describe("fetchNba", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(undiciFetch).mockReset();
    delete process.env.NBA_PROXY_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes params (null/undefined → empty string) and hits the NBA host", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    const out = await fetchNba(
      "scoreboardv2",
      { GameDate: "01/15/2026", LeagueID: "00", DayOffset: 0, Foo: null },
      { spacingMs: 0 },
    );
    expect(out).toEqual({ ok: 1 });
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      "https://stats.nba.com/stats/scoreboardv2",
    );
    expect(calledUrl.searchParams.get("GameDate")).toBe("01/15/2026");
    expect(calledUrl.searchParams.get("DayOffset")).toBe("0");
    expect(calledUrl.searchParams.get("Foo")).toBe("");
  });

  it("routes to stats.wnba.com when league is 'wnba'", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    await fetchNba("leaguegamelog", { LeagueID: "10" }, {
      league: "wnba",
      spacingMs: 0,
    });
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.origin).toBe("https://stats.wnba.com");
  });

  it("honors an explicit baseUrl override", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    await fetchNba("x", {}, { baseUrl: "https://example.test/stats/", spacingMs: 0 });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://example.test/stats/x");
  });

  it("sends the proven browser headers", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    await fetchNba("x", {}, { spacingMs: 0 });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-nba-stats-token"]).toBe("true");
    expect(headers.Referer).toBe("https://www.nba.com/");
    expect(headers["User-Agent"]).toContain("Mozilla/5.0");
  });

  it("throws immediately on a non-retryable 4xx (no retry)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 400));
    await expect(
      fetchNba("x", {}, { spacingMs: 0, maxAttempts: 3 }),
    ).rejects.toThrow(/NBA API 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 403 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 403))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    const out = await fetchNba("x", {}, { spacingMs: 0, maxAttempts: 2 });
    expect(out).toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("gives up after maxAttempts on persistent 503", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(
      fetchNba("x", {}, { spacingMs: 0, maxAttempts: 2 }),
    ).rejects.toThrow(/NBA API 503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("uses the undici fetch + a ProxyAgent when a proxy URL is given", async () => {
    vi.mocked(undiciFetch).mockResolvedValueOnce(
      jsonResponse({ viaProxy: true }) as never,
    );
    const out = await fetchNba("x", {}, {
      spacingMs: 0,
      proxyUrl: "http://user:pass@proxy.test:8080",
    });
    expect(out).toEqual({ viaProxy: true });
    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ProxyAgent).toHaveBeenCalledWith("http://user:pass@proxy.test:8080");
    // the dispatcher is threaded into the request init
    const init = vi.mocked(undiciFetch).mock.calls[0][1] as Record<string, unknown>;
    expect(init.dispatcher).toBeDefined();
  });
});

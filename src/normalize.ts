// stats.nba.com responses are column-oriented: each result table is a
// { headers: string[], rowSet: unknown[][] } pair. Almost every consumer
// reimplements the zip from columns → row objects. This does it once.
//
// Two response shapes exist in the wild:
//   { resultSets: [{ name, headers, rowSet }, ...] }   (most endpoints)
//   { resultSet:  {  name, headers, rowSet  }      }   (a few, e.g. some
//                                                        single-table endpoints)

export interface NbaResultSet {
  name?: string;
  headers: string[];
  rowSet: unknown[][];
}

export interface NbaResponse {
  resultSets?: NbaResultSet[];
  resultSet?: NbaResultSet;
}

export type NbaRow = Record<string, unknown>;

/** Zip one result set's headers + rowSet into row objects. */
export function rowsFromResultSet(rs: NbaResultSet): NbaRow[] {
  if (!rs || !Array.isArray(rs.headers) || !Array.isArray(rs.rowSet)) return [];
  const { headers, rowSet } = rs;
  return rowSet.map((row) => {
    const obj: NbaRow = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = row[i];
    }
    return obj;
  });
}

/**
 * Normalize a stats.nba.com response into row objects.
 *
 * - By default returns the FIRST result set's rows (the common case).
 * - Pass a set name or index to target a specific table.
 * - Returns [] for missing/empty tables rather than throwing.
 */
export function normalize(
  response: unknown,
  which: string | number = 0,
): NbaRow[] {
  const sets = resultSets(response);
  if (sets.length === 0) return [];

  if (typeof which === "number") {
    return rowsFromResultSet(sets[which]);
  }
  const match = sets.find((s) => s.name === which);
  return match ? rowsFromResultSet(match) : [];
}

/** Normalize every result set, keyed by its `name` (falls back to index). */
export function normalizeAll(response: unknown): Record<string, NbaRow[]> {
  const out: Record<string, NbaRow[]> = {};
  resultSets(response).forEach((rs, i) => {
    out[rs.name ?? String(i)] = rowsFromResultSet(rs);
  });
  return out;
}

/** Pull the result-set array out of either response shape. */
function resultSets(response: unknown): NbaResultSet[] {
  if (!response || typeof response !== "object") return [];
  const r = response as NbaResponse;
  if (Array.isArray(r.resultSets)) return r.resultSets;
  if (r.resultSet) return [r.resultSet];
  return [];
}

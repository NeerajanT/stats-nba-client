export {
  fetchNba,
  seasonString,
  toNbaDate,
  NBA_HEADERS,
} from "./client";
export type { NbaParams, FetchNbaOptions, League } from "./client";

export {
  normalize,
  normalizeAll,
  rowsFromResultSet,
} from "./normalize";
export type { NbaResponse, NbaResultSet, NbaRow } from "./normalize";

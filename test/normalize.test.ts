import { describe, it, expect } from "vitest";
import {
  normalize,
  normalizeAll,
  rowsFromResultSet,
} from "../src/normalize";

describe("normalize", () => {
  it("zips the first result set's headers + rowSet into objects", () => {
    const res = {
      resultSets: [
        {
          name: "Players",
          headers: ["PLAYER_ID", "PLAYER_NAME", "PTS"],
          rowSet: [
            [201939, "Stephen Curry", 30],
            [2544, "LeBron James", 27],
          ],
        },
      ],
    };
    expect(normalize(res)).toEqual([
      { PLAYER_ID: 201939, PLAYER_NAME: "Stephen Curry", PTS: 30 },
      { PLAYER_ID: 2544, PLAYER_NAME: "LeBron James", PTS: 27 },
    ]);
  });

  it("targets a result set by index", () => {
    const res = {
      resultSets: [
        { name: "A", headers: ["X"], rowSet: [[1]] },
        { name: "B", headers: ["Y"], rowSet: [[2]] },
      ],
    };
    expect(normalize(res, 1)).toEqual([{ Y: 2 }]);
  });

  it("targets a result set by name", () => {
    const res = {
      resultSets: [
        { name: "A", headers: ["X"], rowSet: [[1]] },
        { name: "B", headers: ["Y"], rowSet: [[2]] },
      ],
    };
    expect(normalize(res, "B")).toEqual([{ Y: 2 }]);
  });

  it("handles the single `resultSet` (non-array) shape", () => {
    const res = {
      resultSet: { name: "Solo", headers: ["A", "B"], rowSet: [["x", "y"]] },
    };
    expect(normalize(res)).toEqual([{ A: "x", B: "y" }]);
  });

  it("returns [] for empty / missing / malformed input", () => {
    expect(normalize(null)).toEqual([]);
    expect(normalize({})).toEqual([]);
    expect(normalize({ resultSets: [] })).toEqual([]);
    expect(normalize({ resultSets: [{ headers: ["A"], rowSet: [] }] })).toEqual(
      [],
    );
    expect(normalize("nope" as unknown)).toEqual([]);
  });

  it("returns [] when a named set is absent", () => {
    const res = { resultSets: [{ name: "A", headers: ["X"], rowSet: [[1]] }] };
    expect(normalize(res, "DoesNotExist")).toEqual([]);
  });

  it("normalizeAll keys every set by name (index fallback)", () => {
    const res = {
      resultSets: [
        { name: "A", headers: ["X"], rowSet: [[1]] },
        { headers: ["Y"], rowSet: [[2]] }, // no name → index "1"
      ],
    };
    expect(normalizeAll(res)).toEqual({ A: [{ X: 1 }], "1": [{ Y: 2 }] });
  });

  it("rowsFromResultSet tolerates a malformed set", () => {
    expect(
      rowsFromResultSet({ headers: undefined as never, rowSet: [] }),
    ).toEqual([]);
  });
});

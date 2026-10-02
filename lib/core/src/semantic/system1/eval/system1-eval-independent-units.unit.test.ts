import { describe, expect, it } from "vitest";
import { aggregateCommittedDuplicateGroups } from "./system1-eval-independent-units.js";

describe("System-1 independent request units", () => {
  it("[happy] counts a duplicate group as exact only when every committed row is exact", () => {
    const groups = aggregateCommittedDuplicateGroups(
      [
        { id: "a", group: "dup-a", committed: true, exact: true },
        { id: "b", group: "dup-a", committed: true, exact: false },
        { id: "c", group: "dup-b", committed: true, exact: true },
        { id: "d", group: "dup-b", committed: false, exact: false },
        { id: "e", group: "dup-c", committed: false, exact: false },
      ],
      {
        duplicateGroup: (row) => row.group,
        committed: (row) => row.committed,
        exact: (row) => row.exact,
      },
    );

    expect(groups).toEqual([
      {
        duplicateGroup: "dup-a",
        committedRows: 2,
        exactRows: 1,
        exact: false,
        rows: [
          { id: "a", group: "dup-a", committed: true, exact: true },
          { id: "b", group: "dup-a", committed: true, exact: false },
        ],
      },
      {
        duplicateGroup: "dup-b",
        committedRows: 1,
        exactRows: 1,
        exact: true,
        rows: [{ id: "c", group: "dup-b", committed: true, exact: true }],
      },
    ]);
  });

  it("[invalid-input] [error-handling] rejects a committed row without a duplicate group instead of pooling it", () => {
    expect(() =>
      aggregateCommittedDuplicateGroups([{ group: "g1" }, { group: "" }], {
        duplicateGroup: (row) => row.group,
        committed: () => true,
        exact: () => true,
      }),
    ).toThrowError(
      new Error("Every committed row must have a duplicate group."),
    );
  });
});

export interface CommittedDuplicateGroup<T> {
  readonly duplicateGroup: string;
  readonly committedRows: number;
  readonly exactRows: number;
  readonly exact: boolean;
  readonly rows: readonly T[];
}

/** Collapses committed rows conservatively: one wrong committed row fails its group. */
export function aggregateCommittedDuplicateGroups<T>(
  rows: readonly T[],
  selectors: {
    readonly duplicateGroup: (row: T) => string;
    readonly committed: (row: T) => boolean;
    readonly exact: (row: T) => boolean;
  },
): readonly CommittedDuplicateGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!selectors.committed(row)) continue;
    const group = selectors.duplicateGroup(row);
    // An empty id would silently pool unrelated rows into one "independent" group.
    if (group === "")
      throw new Error("Every committed row must have a duplicate group.");
    const members = groups.get(group) ?? [];
    members.push(row);
    groups.set(group, members);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([duplicateGroup, members]) => {
      const exactRows = members.filter(selectors.exact).length;
      return {
        duplicateGroup,
        committedRows: members.length,
        exactRows,
        exact: exactRows === members.length,
        rows: members,
      };
    });
}

/**
 * Line-based diff calculator for LSP incremental updates
 *
 * Algorithm: Line-based diff with auto-fallback to full sync if >30% changed
 * Handles edge cases: empty files, single-line, complete rewrites
 */

export interface LineChange {
  type: "insert" | "delete" | "replace";
  startLine: number;
  endLine?: number;
  newText?: string;
}

export interface DiffResult {
  full: boolean; // If true, client should use full content sync
  changes: LineChange[];
}

// Performance metrics for LSP diff calculations
export const diffMetrics = {
  incrementalUpdates: 0,
  fullSyncs: 0,
  totalDiffs: 0,

  recordIncremental(): void {
    this.incrementalUpdates++;
    this.totalDiffs++;
  },

  recordFullSync(): void {
    this.fullSyncs++;
    this.totalDiffs++;
  },

  getStats() {
    if (this.totalDiffs === 0) {
      return { incrementalRate: 0, fullSyncRate: 0 };
    }
    return {
      incrementalCount: this.incrementalUpdates,
      fullSyncCount: this.fullSyncs,
      incrementalRate: ((this.incrementalUpdates / this.totalDiffs) * 100).toFixed(2),
      fullSyncRate: ((this.fullSyncs / this.totalDiffs) * 100).toFixed(2),
    };
  },

  reset(): void {
    this.incrementalUpdates = 0;
    this.fullSyncs = 0;
    this.totalDiffs = 0;
  },
};

/**
 * Calculate line-by-line diff between old and new content
 *
 * @param oldContent Previous file content
 * @param newContent New file content
 * @param fullSyncThreshold Percentage threshold for fallback to full sync (0-100)
 * @returns DiffResult with `full` flag and incremental changes
 */
export function calculateLineDiff(
  oldContent: string,
  newContent: string,
  fullSyncThreshold: number = 30
): DiffResult {
  // Normalize line endings
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Edge case: empty files
  if (oldLines.length === 0 && newLines.length === 0) {
    return { full: false, changes: [] };
  }

  if (oldLines.length === 0 && newLines.length > 0) {
    return {
      full: false,
      changes: [
        {
          type: "insert",
          startLine: 0,
          newText: newContent,
        },
      ],
    };
  }

  if (oldLines.length > 0 && newLines.length === 0) {
    return {
      full: false,
      changes: [
        {
          type: "delete",
          startLine: 0,
          endLine: oldLines.length - 1,
        },
      ],
    };
  }

  // Calculate simple diff using longest common subsequence (LCS) approximation
  const changes: LineChange[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      // Lines match, move to next
      oldIndex++;
      newIndex++;
    } else {
      // Find next matching line
      let oldMatchIndex = oldIndex + 1;
      let newMatchIndex = newIndex + 1;
      let oldDistance = Infinity;
      let newDistance = Infinity;

      // Look ahead in old lines
      while (oldMatchIndex < oldLines.length && oldDistance === Infinity) {
        if (oldLines[oldMatchIndex] === newLines[newIndex]) {
          oldDistance = oldMatchIndex - oldIndex;
        }
        oldMatchIndex++;
      }

      // Look ahead in new lines
      while (newMatchIndex < newLines.length && newDistance === Infinity) {
        if (newLines[newMatchIndex] === oldLines[oldIndex]) {
          newDistance = newMatchIndex - newIndex;
        }
        newMatchIndex++;
      }

      // Decide: insert, delete, or replace
      if (oldDistance === Infinity && newDistance === Infinity) {
        // No matching lines found, replace current block
        const deleteCount = Math.max(1, oldIndex < oldLines.length ? 1 : 0);
        const insertText = newLines.slice(newIndex, newIndex + 1).join("\n");

        changes.push({
          type: deleteCount > 0 ? "replace" : "insert",
          startLine: oldIndex,
          endLine: oldIndex + deleteCount - 1,
          newText: insertText,
        });

        oldIndex += deleteCount;
        newIndex += 1;
      } else if (oldDistance <= newDistance) {
        // Delete old lines
        changes.push({
          type: "delete",
          startLine: oldIndex,
          endLine: oldIndex,
        });
        oldIndex++;
      } else {
        // Insert new lines
        const insertText = newLines[newIndex];
        changes.push({
          type: "insert",
          startLine: oldIndex,
          newText: insertText,
        });
        newIndex++;
      }
    }
  }

  // Handle remaining lines
  if (oldIndex < oldLines.length) {
    changes.push({
      type: "delete",
      startLine: oldIndex,
      endLine: oldLines.length - 1,
    });
  }

  if (newIndex < newLines.length) {
    const remainingLines = newLines.slice(newIndex);
    changes.push({
      type: "insert",
      startLine: oldLines.length,
      newText: remainingLines.join("\n"),
    });
  }

  // Decide: use full sync or incremental changes
  const changedLineCount = changes.reduce((acc, change) => {
    if (change.type === "delete" && change.endLine !== undefined) {
      acc += change.endLine - change.startLine + 1;
    } else {
      acc += 1;
    }
    return acc;
  }, 0);

  const changePercentage = (changedLineCount / Math.max(oldLines.length, 1)) * 100;
  const useFull = changePercentage > fullSyncThreshold;

  // Record metric for analysis
  if (useFull) {
    diffMetrics.recordFullSync();
  } else {
    diffMetrics.recordIncremental();
  }

  return {
    full: useFull,
    changes: useFull ? [] : changes,
  };
}

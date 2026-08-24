-- 0010_l3_anchor_ranges.sql
-- Issue #68's region-anchor prerequisite: `git blame` is line-level, but decisions anchor to
-- file-level L2 nodes only, so file-level validity degenerates to "any surviving line keeps the
-- rationale alive" (a fully rewritten feature leaving one old comment line would resurrect its
-- dead rationale). This column captures the writing commit's diff hunks ({path,startRow,endRow}
-- JSON array) at write time via getChangedLineRanges(), giving the future blame-based validity
-- pass a region to judge ownership against. NULL on rows written before this column existed or
-- by paths that don't capture anchors -- consumers treat NULL as "unknown region", falling back
-- to file-level judgment rather than fabricating one.

ALTER TABLE l3_nodes ADD COLUMN anchor_ranges TEXT;

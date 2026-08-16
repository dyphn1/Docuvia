/** Core-internal shim — `parseSourceTrailer` now lives in `@workspace/contracts` (shared by
 *  `lib/core`'s hydration/snapshot services and `lib/ui-core`'s `analyze` workflow, Virtual
 *  Contracts §8). Kept as a re-export so existing `./git-trailers.js` importers don't churn. */
export { parseSourceTrailer } from "@workspace/contracts";

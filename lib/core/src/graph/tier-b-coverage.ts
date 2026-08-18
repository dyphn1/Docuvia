/** Core-internal shim — `resolveTierBCoverageHint` now lives in `@workspace/contracts` (reused
 *  by `lib/ui-core`'s `ImpactWorkflow`, Virtual Contracts §8). Kept as a re-export so existing
 *  `./tier-b-coverage.js` importers (e.g. `QueryService.getContext()`) don't churn. */
export { resolveTierBCoverageHint } from "@workspace/contracts";

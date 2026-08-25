import { docuviaFactory, TOKENS } from "@workspace/contracts";
import { GitLocalProvider } from "./git-local-provider.js";

/**
 * Self-registration side effect (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md's Bootstrap phase) — imported
 * once, for its side effect only, by the Presentation layer. Every `resolve()` afterwards
 * returns a fresh, transient `GitLocalProvider` (it holds no state, so transience costs nothing).
 */
docuviaFactory.register(TOKENS.GitProvider, () => new GitLocalProvider());
// Same transient provider, registered under the narrow blame-ownership capability token
// (issue #68) so consumers depend on `ILineBlameProvider`, not the whole `IGitProvider`.
docuviaFactory.register(TOKENS.LineBlameProvider, () => new GitLocalProvider());
import { GitDiagnosticRunner } from "./diagnostic-runner.js";
docuviaFactory.register(
  TOKENS.DiagnosticRunnerGit,
  () => new GitDiagnosticRunner(),
);

import { docuviaFactory, TOKENS } from "@workspace/contracts";
import { Libgit2Provider } from "./libgit2-provider.js";

/**
 * Self-registration side effect (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md's Bootstrap phase) — imported
 * once, for its side effect only, by the Presentation layer. Every `resolve()` afterwards
 * returns a fresh, transient `Libgit2Provider` (it holds no state, so transience costs nothing).
 */
docuviaFactory.register(TOKENS.GitProvider, () => new Libgit2Provider());
import { GitDiagnosticRunner } from "./diagnostic-runner.js";
docuviaFactory.register(
  TOKENS.DiagnosticRunnerGit,
  () => new GitDiagnosticRunner(),
);

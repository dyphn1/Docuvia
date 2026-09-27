import process from "process";
import { docuviaFactory, TOKENS } from "@workspace/contracts";

/**
 * Bootstrap phase (see docs/gitbook/architecture/application-lifecycle-and-state.md): the
 * Presentation layer is the only layer that explicitly imports implementation libraries, purely
 * for their `docuviaFactory` self-registration side effect — it never instantiates them
 * directly. Import this module once, before calling anything on `docuviaApi`.
 */
import "@workspace/git-local";
import "@workspace/schema";
import "@workspace/core";
import "@workspace/remote-api";
import "@workspace/llm-api";
import "@workspace/semantic-decision";

// Presentation owns host-environment access. Resolve-time snapshotting preserves dotenv/runtime
// updates that happened before a workflow constructs GitLocalProvider, while keeping every
// implementation library detached from the global process environment.
docuviaFactory.register(TOKENS.HostEnvironment, () =>
  Object.freeze({ ...process.env }),
);

/**
 * Bootstrap phase (see docs/gitbook/architecture/application-lifecycle-and-state.md): the
 * Presentation layer is the only layer that explicitly imports implementation libraries, purely
 * for their `docuviaFactory` self-registration side effect — it never instantiates them
 * directly. Import this module once, before calling anything on `docuviaApi`.
 */
import "@workspace/libgit2";
import "@workspace/schema";
import "@workspace/core";

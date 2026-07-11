import { docuviaFactory, TOKENS } from "@workspace/contracts";
import { GraphStore } from "./sqlite/graph-store.js";

/**
 * Self-registration side effect (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md's Bootstrap phase). `GraphStore`
 * opening is async, so the factory registers a *builder function* rather than an instance —
 * the Orchestration layer resolves this once, then explicitly `await`s it with the per-run
 * `dbPath`, matching "ui-core explicitly calls .initialize()" for every transient resource.
 */
docuviaFactory.register(TOKENS.GraphStoreOpener, () => GraphStore.open);

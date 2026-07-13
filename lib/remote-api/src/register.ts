import { docuviaFactory, TOKENS } from "@workspace/contracts";
import { FetchRemoteSyncClient } from "./fetch-remote-sync-client.js";

/**
 * Self-registration side effect (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md's Bootstrap phase). The token
 * carries a builder function (not a shared instance) since a fresh, transient client is created
 * per `sync` run, then explicitly `.initialize()`d with the per-run `apiUrl`/`pat` sourced from
 * `docuviaMemory` by the Orchestration layer.
 */
docuviaFactory.register(
  TOKENS.RemoteSyncClient,
  () => () => new FetchRemoteSyncClient(),
);

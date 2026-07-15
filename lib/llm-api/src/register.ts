import { docuviaFactory, TOKENS } from "@workspace/contracts";
import { FetchLlmClient } from "./fetch-llm-client.js";

/**
 * Self-registration side effect (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md's Bootstrap phase). The token
 * carries a builder function (not a shared instance) since a fresh, transient client is created
 * per call, then explicitly `.initialize()`d with the `baseUrl`/`apiKey` sourced from
 * `docuviaMemory` by the Orchestration layer.
 */
docuviaFactory.register(TOKENS.LlmClient, () => () => new FetchLlmClient());

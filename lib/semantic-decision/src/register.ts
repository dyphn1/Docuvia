import {
  docuviaFactory,
  TOKENS,
  type DocuviaFactory,
} from "@workspace/contracts";
import { LocalSemanticDecisionProvider } from "./semantic-decision-provider.js";

/**
 * Composition seam for #468's model-isolated feature provider.
 *
 * The package self-registers like the other implementation libraries. Upper layers resolve only
 * TOKENS.SemanticDecisionProvider and never import this package directly except at the
 * Presentation composition root for registration side effects.
 */
export function registerSemanticDecisionProvider(
  factory: DocuviaFactory = docuviaFactory,
): void {
  factory.register(
    TOKENS.SemanticDecisionProvider,
    () => new LocalSemanticDecisionProvider(),
  );
}

registerSemanticDecisionProvider();

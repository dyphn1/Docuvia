import type {
  ISemanticDecisionValidator,
  SemanticDecisionRequest,
  SemanticDecisionOutcome,
} from "@workspace/contracts";
import { validateSemanticRequest } from "./semantic-decision-request.js";
import { validateSemanticOutcome } from "./semantic-decision-outcome.js";

/** Pure model-agnostic boundary. No thresholds, model imports, graph writes or resource lifetime. */
export class SemanticDecisionValidator implements ISemanticDecisionValidator {
  validateRequest(value: unknown): SemanticDecisionRequest {
    return validateSemanticRequest(value);
  }
  validateOutcome(
    request: SemanticDecisionRequest,
    value: unknown,
  ): SemanticDecisionOutcome {
    return validateSemanticOutcome(this.validateRequest(request), value);
  }
}

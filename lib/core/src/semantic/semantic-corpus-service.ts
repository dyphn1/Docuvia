import type {
  ISemanticCorpusService,
  SemanticCorpusLabelResult,
} from "@workspace/contracts";
import { validateCorpusSample } from "./semantic-corpus-validation.js";
import { labelCorpusSample } from "./semantic-corpus-labels.js";

/** Pure offline corpus policy. Collection and model execution belong to other boundaries. */
export class SemanticCorpusService implements ISemanticCorpusService {
  label(sample: unknown): SemanticCorpusLabelResult {
    return labelCorpusSample(validateCorpusSample(sample));
  }
}

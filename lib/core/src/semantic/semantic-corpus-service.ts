import type {
  ISemanticCorpusService,
  SemanticCorpusLabelResult,
  SemanticCorpusReport,
} from "@workspace/contracts";
import { validateCorpusSample } from "./semantic-corpus-validation.js";
import { labelCorpusSample } from "./semantic-corpus-labels.js";
import { validateCorpusManifest } from "./semantic-corpus-manifest.js";
import { auditCorpus } from "./semantic-corpus-audit.js";

/** Pure offline corpus policy. Collection and model execution belong to other boundaries. */
export class SemanticCorpusService implements ISemanticCorpusService {
  label(sample: unknown): SemanticCorpusLabelResult {
    return labelCorpusSample(validateCorpusSample(sample));
  }
  audit(manifest: unknown): SemanticCorpusReport {
    return auditCorpus(validateCorpusManifest(manifest));
  }
}

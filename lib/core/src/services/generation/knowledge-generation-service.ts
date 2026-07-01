import { KnowledgeGenerationPipeline } from "./knowledge-generation-pipeline.js";
import { L1ProcessingService } from "./l1-processing-service.js";
import { L2ProcessingService } from "./l2-processing-service.js";
import { L3ProcessingService } from "./l3-processing-service.js";
import { LlmGenerationService } from "./llm-generation-service.js";

/**
 * Executes the full knowledge generation pipeline.
 * Replaced as part of the POP refactoring.
 */
export async function executeKnowledgeGeneration(
  projectId: number,
  userId: number | undefined,
  bodyOptions: any
) {
  const llmGenerationService = new LlmGenerationService();
  const l1ProcessingService = new L1ProcessingService(llmGenerationService);
  const l3ProcessingService = new L3ProcessingService(llmGenerationService);
  const l2ProcessingService = new L2ProcessingService(llmGenerationService, l3ProcessingService);

  const pipeline = new KnowledgeGenerationPipeline(l1ProcessingService, l2ProcessingService);
  return pipeline.execute(projectId, userId, bodyOptions);
}

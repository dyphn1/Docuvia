import { IntentClassifierService } from "./router/intent-classifier.service.js";
import { VectorSearchService } from "./router/vector-search.service.js";
import { GraphTraversalService } from "./router/graph-traversal.service.js";
import { DirectLookupService } from "./router/direct-lookup.service.js";
import { HybridSearchService } from "./router/hybrid-search.service.js";
import { IntentRouterService } from "./router/intent-router.service.js";
import { sanitizeQuery } from "./router/router.utils.js";

// Export types to maintain backward compatibility for consumers
export type {
  RoutingStrategy,
  IntentClassification,
  AgenticSearchResult,
  RouteQueryResult,
} from "../types/intent-router.types.js";

export { sanitizeQuery };

// Instantiate services
const classifier = new IntentClassifierService();
const vectorSearchHandler = new VectorSearchService();
const graphTraversalHandler = new GraphTraversalService();
const directLookupHandler = new DirectLookupService();
const hybridSearchHandler = new HybridSearchService(vectorSearchHandler, graphTraversalHandler);
const intentRouter = new IntentRouterService(
  classifier,
  vectorSearchHandler,
  graphTraversalHandler,
  directLookupHandler,
  hybridSearchHandler
);

// Facade exports
export const classifyIntent = classifier.classifyIntent.bind(classifier);
export const vectorSearchHandlerFn = vectorSearchHandler.search.bind(vectorSearchHandler);
export const graphTraversalHandlerFn = graphTraversalHandler.traverse.bind(graphTraversalHandler);
export const directLookupHandlerFn = directLookupHandler.lookup.bind(directLookupHandler);
export const routeQuery = intentRouter.routeQuery.bind(intentRouter);

// Exporting original names in case they are used directly
export {
  vectorSearchHandlerFn as vectorSearchHandler,
  graphTraversalHandlerFn as graphTraversalHandler,
  directLookupHandlerFn as directLookupHandler,
};

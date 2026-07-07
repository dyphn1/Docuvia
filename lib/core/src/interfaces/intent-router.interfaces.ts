import {
  IntentClassification,
  AgenticSearchResult,
  RouteQueryResult,
  SearchOutcome,
} from "../types/intent-router.types.js";

export interface IIntentClassifier {
  classifyIntent(query: string, projectId?: number): Promise<IntentClassification>;
}

export interface IVectorSearchHandler {
  search(
    query: string,
    projectId?: number,
    limit?: number,
    includePending?: boolean
  ): Promise<SearchOutcome>;
}

export interface IGraphTraversalHandler {
  traverse(moduleName: string, projectId?: number, limit?: number): Promise<AgenticSearchResult[]>;
}

export interface IDirectLookupHandler {
  lookup(
    searchQuery: string,
    projectId?: number,
    limit?: number,
    includePending?: boolean
  ): Promise<AgenticSearchResult[]>;
}

export interface IHybridSearchHandler {
  search(
    query: string,
    classification: IntentClassification,
    projectId?: number,
    limit?: number,
    includePending?: boolean
  ): Promise<SearchOutcome>;
}

export interface IIntentRouter {
  routeQuery(
    query: string,
    projectId?: number,
    limit?: number,
    includePending?: boolean
  ): Promise<RouteQueryResult>;
}

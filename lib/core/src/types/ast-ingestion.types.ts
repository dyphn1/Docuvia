export interface AstEvent {
  type: "file" | "class" | "function" | "call" | "method_call" | "import" | "api_contract";
  path?: string;
  name?: string;
  method?: string;
  object?: string;
  source?: string;
  localName?: string;
  contractName?: string;
  version?: string;
  description?: string;
  basePath?: string;
  fullPath?: string;
  summary?: string;
  operationId?: string | null;
  tags?: string[];
  consumers?: string[];
  filePath?: string;
  [key: string]: unknown;
}

export interface IngestionResult {
  l2Created: number;
  l3Created: number;
  linksCreated: number;
  contractsCreated: number;
  filesSkipped: number;
  errors: string[];
}

export interface FileEvent {
  filePath: string;
  baseName: string;
  dirPath: string;
  l2Type: "package" | "module" | "pcd";
  pathPatterns: string[];
}

export interface SymbolEvent {
  name: string;
  fqn: string;
  filePath: string;
  l2NodeId: number;
  nodeType: "rule" | "change";
}

export interface ImportEvent {
  source: string;
  localName: string;
  importerFilePath: string;
}

export interface CallEvent {
  name: string;
  method?: string;
  object?: string;
  callerFilePath: string;
  isMethodCall: boolean;
}

export interface ContractEvent {
  contractName: string;
  version?: string;
  description?: string;
  basePath?: string;
  method?: string;
  path?: string;
  fullPath?: string;
  summary?: string;
  operationId?: string | null;
  tags?: string[];
  consumers?: string[];
  filePath: string;
}

export interface ProcessedEvents {
  fileEvents: FileEvent[];
  classEvents: SymbolEvent[];
  functionEvents: SymbolEvent[];
  importEvents: ImportEvent[];
  callEvents: CallEvent[];
  contractEvents: ContractEvent[];
}

export interface L2ProcessingResult {
  filePathToL2Id: Map<string, number>;
  pathToL2Id: Map<string, number>;
}

export interface L3ProcessingResult {
  fqnToL3Id: Map<string, number>;
  nameToL3Id: Map<string, number>;
  l3IdToL2Id: Map<number, number>;
}

export interface ContractEndpointsResult {
  contractEndpointToL3Id: Map<string, number>;
  contractPathToL2Id: Map<string, number>;
}

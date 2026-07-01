export interface L3NodeAI {
  title: string;
  nodeType: "change" | "rule" | "decision" | "context";
  content: string;
  commitHash: string;
  confidence: number;
}

export interface L2NodeAI {
  name: string;
  type: "package" | "module" | "pcd";
  description: string;
  l1TagNames: string[];
  l3Nodes: L3NodeAI[];
}

export interface ILlmGenerationService {
  condenseL3Node(projectId: number, node: any, model: string): Promise<string | null>;
  generateL1Tags(
    projectId: number,
    commits: Array<{ message: string; hash: string }>,
    existingTags: string[],
    model: string,
    systemPromptOverride: string
  ): Promise<Array<{ name: string; category: string; description: string }>>;
  generateL2Nodes(
    projectId: number,
    commits: Array<{ message: string; hash: string }>,
    l1Tags: Array<{ id: number; name: string }>,
    documentContext: string,
    model: string,
    systemPromptOverride: string,
    corrections: Array<{ original: string; corrected: string }>,
    previousL2Names?: string[]
  ): Promise<L2NodeAI[]>;
}

export interface IL1ProcessingService {
  processL1Tagger(
    tx: any,
    projectId: number,
    projectName: string,
    commitData: any[],
    model: string,
    similarityThreshold: number
  ): Promise<{ l1TagsCreated: number; reviewTasksCreated: number; tagMap: Map<string, number> }>;
}

export interface IL2ProcessingService {
  processL2Nodes(
    tx: any,
    projectId: number,
    project: any,
    validCommits: any[],
    commitData: any[],
    documents: any[],
    documentContext: string,
    tagMap: Map<string, number>,
    model: string,
    similarityThreshold: number,
    condensationThreshold: number,
    condensationReviewRequired: boolean
  ): Promise<{
    l2Created: number;
    l2Updated: number;
    l3Created: number;
    rTasksCreated: number;
    crossLinks: number;
  }>;
}

export interface IL3ProcessingService {
  processL3Nodes(
    tx: any,
    projectId: number,
    l2node: any,
    l2data: L2NodeAI,
    similarityThreshold: number,
    condensationThreshold: number,
    condensationReviewRequired: boolean,
    model: string,
    commitHashMap: Map<string, number>
  ): Promise<{ l3Created: number; rTasksCreated: number }>;
}

export interface IKnowledgeGenerationPipeline {
  execute(projectId: number, userId: number | undefined, bodyOptions: any): Promise<any>;
}

import { logger } from "../utils/logger.js";

export class QueryService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async query(target: string, options: any): Promise<any> {
    logger.info({ target, options }, "Querying local knowledge graph");
    // STUB
    return {
      l2: { name: "Mock L2 Module" },
      l3: [{ title: "Mock Decision 1", status: "active", content: "This is a mock response" }],
    };
  }
}

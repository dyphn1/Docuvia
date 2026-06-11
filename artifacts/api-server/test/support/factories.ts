import { 
  db, 
  l2NodesTable, 
  l3NodesTable, 
  projectsTable,
  commitsTable,
  documentsTable,
  l1TagsTable,
  nodeLinksTable
} from "@workspace/db";
import type { 
  InsertL2Node, 
  InsertL3Node, 
  InsertProject,
  InsertCommit,
  InsertDocument,
  InsertL1Tag,
  InsertNodeLink
} from "@workspace/db";

type DbLike = typeof db;

let sequence = 0;

function nextSequence() {
  sequence += 1;
  return sequence;
}

export const ProjectFactory = {
  build(overrides: Partial<InsertProject> = {}): InsertProject {
    const id = nextSequence();
    return {
      name: `Project ${id}`,
      repoUrl: `https://github.com/example/project-${id}`,
      description: `Generated project ${id}`,
      status: "active",
      vcsType: "git",
      ...overrides,
    };
  },
  async create(overrides: Partial<InsertProject> = {}, client: DbLike = db) {
    const [project] = await client
      .insert(projectsTable)
      .values(ProjectFactory.build(overrides))
      .returning();

    await client.insert(l2NodesTable).values({
      projectId: project.id,
      name: "System: Uncategorized",
      type: "sys-uncategorized",
      isSystem: true,
      description: "Default bucket for unassigned L3 decisions",
      aiGenerated: false,
    });

    return project;
  },
};

export const L2NodeFactory = {
  build(projectId: number, overrides: Partial<InsertL2Node> = {}): InsertL2Node {
    const id = nextSequence();
    return {
      projectId,
      name: `module-${id}`,
      type: "module",
      description: `Generated module ${id}`,
      aiGenerated: true,
      needsReview: false,
      ...overrides,
    };
  },
  async create(projectId: number, overrides: Partial<InsertL2Node> = {}, client: DbLike = db) {
    const [node] = await client
      .insert(l2NodesTable)
      .values(L2NodeFactory.build(projectId, overrides))
      .returning();
    return node;
  },
};

export const L3NodeFactory = {
  build(l2NodeId: number, overrides: Partial<InsertL3Node> = {}): InsertL3Node {
    const id = nextSequence();
    return {
      l2NodeId,
      title: `Decision ${id}`,
      content: `Generated decision ${id}`,
      nodeType: "decision",
      aiGenerated: true,
      ...overrides,
    };
  },
  async create(l2NodeId: number, overrides: Partial<InsertL3Node> = {}, client: DbLike = db) {
    const [node] = await client
      .insert(l3NodesTable)
      .values(L3NodeFactory.build(l2NodeId, overrides))
      .returning();
    return node;
  },
};

export const CommitFactory = {
  build(projectId: number, overrides: Partial<InsertCommit> = {}): InsertCommit {
    const id = nextSequence();
    return {
      projectId,
      hash: `sha${id}1234567890abcdef1234567890abcdef1234`,
      message: `Generated commit ${id}`,
      author: `author${id}@example.com`,
      date: new Date(),
      ...overrides,
    };
  },
  async create(projectId: number, overrides: Partial<InsertCommit> = {}, client: DbLike = db) {
    const [commit] = await client
      .insert(commitsTable)
      .values(CommitFactory.build(projectId, overrides))
      .returning();
    return commit;
  },
};

export const DocumentFactory = {
  build(projectId: number, overrides: Partial<InsertDocument> = {}): InsertDocument {
    const id = nextSequence();
    return {
      projectId,
      title: `Document ${id}`,
      type: "markdown",
      content: `Generated document content ${id}`,
      contentHash: `hash${id}1234567890abcdef1234567890abcdef`,
      ...overrides,
    };
  },
  async create(projectId: number, overrides: Partial<InsertDocument> = {}, client: DbLike = db) {
    const [document] = await client
      .insert(documentsTable)
      .values(DocumentFactory.build(projectId, overrides))
      .returning();
    return document;
  },
};

export const L1TagFactory = {
  build(overrides: Partial<InsertL1Tag> = {}): InsertL1Tag {
    const id = nextSequence();
    return {
      name: `L1Tag ${id}`,
      description: `Generated tag ${id}`,
      ...overrides,
    };
  },
  async create(overrides: Partial<InsertL1Tag> = {}, client: DbLike = db) {
    const [tag] = await client
      .insert(l1TagsTable)
      .values(L1TagFactory.build(overrides))
      .returning();
    return tag;
  },
};

export const NodeLinkFactory = {
  build(sourceId: number, targetId: number, overrides: Partial<InsertNodeLink> = {}): InsertNodeLink {
    return {
      sourceId,
      targetId,
      description: "Generated node link",
      aiGenerated: true,
      ...overrides,
    };
  },
  async create(sourceId: number, targetId: number, overrides: Partial<InsertNodeLink> = {}, client: DbLike = db) {
    const [link] = await client
      .insert(nodeLinksTable)
      .values(NodeLinkFactory.build(sourceId, targetId, overrides))
      .returning();
    return link;
  },
};

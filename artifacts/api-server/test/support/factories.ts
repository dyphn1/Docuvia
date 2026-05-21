import { db, l2NodesTable, l3NodesTable, projectsTable } from "@workspace/db";
import type { InsertL2Node, InsertL3Node, InsertProject } from "@workspace/db";

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


import { db } from "@workspace/db";
import { 
  projectsTable, l2NodesTable, l3NodesTable, commitsTable, documentsTable, 
  l1TagsTable, reviewTasksTable, correctionExamplesTable, pullRequestsTable, 
  llmConfigsTable, promptTemplatesTable, activityLogTable 
} from "@workspace/db";
import { 
  InsertProject, InsertL2Node, InsertL3Node, InsertCommit, InsertDocument, 
  InsertL1Tag, InsertReviewTask, InsertCorrectionExample, InsertPullRequest, 
  InsertLlmConfig, InsertPromptTemplate, InsertActivityLog 
} from "@workspace/db";
import { faker } from "@faker-js/faker";

faker.seed(123); // Seed faker for deterministic test execution

// Helper to get active db or transaction client
const getDb = (client?: any) => client ?? db;

export const ProjectFactory = {
  build: (overrides?: Partial<InsertProject>): InsertProject => ({
    name: faker.company.name(),
    repoUrl: faker.internet.url(),
    defaultBranch: "main",
    ...overrides,
  }),
  create: async (overrides?: Partial<InsertProject>, client?: any) => {
    const data = ProjectFactory.build(overrides);
    const [inserted] = await getDb(client).insert(projectsTable).values(data).returning();
    return inserted;
  },
};

export const L2NodeFactory = {
  build: (projectId: number, overrides?: Partial<InsertL2Node>): InsertL2Node => ({
    projectId,
    name: faker.system.fileName(),
    type: "module",
    description: faker.lorem.sentence(),
    ...overrides,
  }),
  create: async (overrides?: Partial<InsertL2Node>, client?: any) => {
    let projectId = overrides?.projectId;
    if (!projectId) {
      const project = await ProjectFactory.create({}, client);
      projectId = project.id;
    }
    const data = L2NodeFactory.build(projectId, overrides);
    const [inserted] = await getDb(client).insert(l2NodesTable).values(data).returning();
    return inserted;
  },
};

export const L3NodeFactory = {
  build: (l2NodeId: number, overrides?: Partial<InsertL3Node>): InsertL3Node => ({
    l2NodeId,
    title: faker.lorem.words(3),
    content: faker.lorem.paragraph(),
    nodeType: "change",
    ...overrides,
  }),
  create: async (overrides?: Partial<InsertL3Node>, client?: any) => {
    let l2NodeId = overrides?.l2NodeId;
    if (!l2NodeId) {
      const l2 = await L2NodeFactory.create({}, client);
      l2NodeId = l2.id;
    }
    const data = L3NodeFactory.build(l2NodeId, overrides);
    const [inserted] = await getDb(client).insert(l3NodesTable).values(data).returning();
    return inserted;
  },
};

export const CommitFactory = {
  build: (projectId: number, overrides?: Partial<InsertCommit>): InsertCommit => ({
    projectId,
    hash: faker.git.commitSha(),
    message: faker.git.commitMessage(),
    author: faker.person.fullName(),
    valid: true,
    vcsType: "git",
    ...overrides,
  }),
  create: async (overrides?: Partial<InsertCommit>, client?: any) => {
    let projectId = overrides?.projectId;
    if (!projectId) {
      const project = await ProjectFactory.create({}, client);
      projectId = project.id;
    }
    const data = CommitFactory.build(projectId, overrides);
    const [inserted] = await getDb(client).insert(commitsTable).values(data).returning();
    return inserted;
  },
};

export const DocumentFactory = {
  build: (projectId: number, overrides?: Partial<InsertDocument>): InsertDocument => ({
    projectId,
    filename: faker.system.fileName(),
    docType: "txt",
    content: faker.lorem.paragraphs(2),
    ...overrides,
  }),
  create: async (overrides?: Partial<InsertDocument>, client?: any) => {
    let projectId = overrides?.projectId;
    if (!projectId) {
      const project = await ProjectFactory.create({}, client);
      projectId = project.id;
    }
    const data = DocumentFactory.build(projectId, overrides);
    const [inserted] = await getDb(client).insert(documentsTable).values(data).returning();
    return inserted;
  },
};

export const ActivityLogFactory = {
  build: (projectId: number, overrides?: Partial<InsertActivityLog>): InsertActivityLog => ({
    projectId,
    type: "commit",
    description: faker.lorem.sentence(),
    ...overrides,
  }),
  create: async (overrides?: Partial<InsertActivityLog>, client?: any) => {
    let projectId = overrides?.projectId;
    if (!projectId) {
      const project = await ProjectFactory.create({}, client);
      projectId = project.id;
    }
    const data = ActivityLogFactory.build(projectId, overrides);
    const [inserted] = await getDb(client).insert(activityLogTable).values(data).returning();
    return inserted;
  },
};

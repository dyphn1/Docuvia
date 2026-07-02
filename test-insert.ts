import { db, l2NodesTable, projectsTable } from "./lib/db/src/index.ts";
async function run() {
  try {
    const [p] = await db
      .insert(projectsTable)
      .values({ name: "p", repoUrl: "http://a" })
      .returning();
    await db.insert(l2NodesTable).values({
      projectId: p.id,
      name: "test",
      type: "module",
      embedding: Array(1536).fill(0.1),
    });
    console.log("Success 1536");
  } catch (e) {
    console.error(e);
  }
}
run();

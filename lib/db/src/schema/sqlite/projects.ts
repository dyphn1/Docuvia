import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const projectsTable = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    repoUrl: text("repo_url").notNull(),
    description: text("description"),
    status: text("status")
      .$type<"active" | "indexing" | "paused" | "error">()
      .notNull()
      .default("active"),
    vcsType: text("vcs_type").$type<"git" | "svn">().notNull().default("git"),
    svnUrl: text("svn_url"),
    lastGitIngestedAt: text("last_git_ingested_at"),
    lastSvnRevision: integer("last_svn_revision"),
    lastAstIngestedAt: text("last_ast_ingested_at"),
    ownerId: integer("owner_id").notNull().default(1),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    ownerIdx: index("projects_owner_id_idx").on(table.ownerId),
    repoUrlIdx: index("projects_repo_url_idx").on(table.repoUrl),
  })
);

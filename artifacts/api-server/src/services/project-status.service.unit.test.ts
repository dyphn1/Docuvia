import { describe, it, expect, beforeEach } from "vitest";
import { ProjectStatusService } from "./project-status.service.js";
// @ts-ignore
import { withRollback } from "@workspace/test-utils";
// @ts-ignore
import { ProjectFactory, CommitFactory } from "@workspace/test-utils";
import { db, commitsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

describe("ProjectStatusService", () => {
  let service: ProjectStatusService;

  beforeEach(() => {
    service = new ProjectStatusService();
  });

  it("should return status with 0 pending commits if none are pending", async () => {
    await withRollback(async () => {
      // Arrange
      const project = await ProjectFactory.create({
        vcsType: "git",
      });

      // Create a processed commit
      await CommitFactory.create({
        projectId: project.id,
        processedAt: new Date(),
      });

      // Act
      const status = await service.getStatus(project.id, project);

      // Assert
      expect(status).toEqual({
        projectId: project.id,
        vcsType: "git",
        lastGitIngestedAt: null,
        lastSvnRevision: null,
        pendingCommits: 0,
      });
    });
  });

  it("should count pending commits correctly", async () => {
    await withRollback(async () => {
      // Arrange
      const project = await ProjectFactory.create({
        vcsType: "git",
      });

      // Create two pending commits
      await CommitFactory.create({
        projectId: project.id,
        processedAt: null,
      });
      await CommitFactory.create({
        projectId: project.id,
        processedAt: null,
      });

      // Create one processed commit
      await CommitFactory.create({
        projectId: project.id,
        processedAt: new Date(),
      });

      // Create pending commit for another project
      const otherProject = await ProjectFactory.create();
      await CommitFactory.create({
        projectId: otherProject.id,
        processedAt: null,
      });

      // Act
      const status = await service.getStatus(project.id, project);

      // Assert
      expect(status.pendingCommits).toBe(2);
      expect(status.projectId).toBe(project.id);
    });
  });

  it("should format dates correctly", async () => {
    await withRollback(async () => {
      // Arrange
      const date = new Date("2026-01-01T10:00:00.000Z");
      const project = await ProjectFactory.create({
        vcsType: "svn",
        lastGitIngestedAt: date,
        lastSvnRevision: 42,
      });

      // Act
      const status = await service.getStatus(project.id, project);

      // Assert
      expect(status.lastGitIngestedAt).toBe(date.toISOString());
      expect(status.lastSvnRevision).toBe(42);
      expect(status.vcsType).toBe("svn");
    });
  });
});

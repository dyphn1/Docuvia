import { describe, it, expect, beforeEach } from "vitest";
import { DashboardService } from "./dashboard.service.js";
// @ts-ignore
import { withRollback } from "../../test/support/db.js";
// @ts-ignore
import {
  ProjectFactory,
  L1TagFactory,
  L2NodeFactory,
  L3NodeFactory,
  ReviewTaskFactory,
  ActivityLogFactory,
} from "../../test/support/factories.js";

describe("DashboardService", () => {
  let service: DashboardService;

  beforeEach(() => {
    service = new DashboardService();
  });

  it("should return correct counts and recent activity", async () => {
    await withRollback(async () => {
      // Arrange
      // Create some projects
      const project1 = await ProjectFactory.create({ name: "Project Alpha" });
      const project2 = await ProjectFactory.create({ name: "Project Beta" });

      // Create tags and nodes
      await L1TagFactory.create();
      await L1TagFactory.create();

      const l2_1 = await L2NodeFactory.create({ projectId: project1.id });
      await L2NodeFactory.create({ projectId: project2.id });
      await L2NodeFactory.create({ projectId: project2.id }); // 3 L2 nodes total

      await L3NodeFactory.create({ l2NodeId: l2_1.id });
      await L3NodeFactory.create({ l2NodeId: l2_1.id }); // 2 L3 nodes total

      // Create some review tasks
      await ReviewTaskFactory.create({ status: "pending" });
      await ReviewTaskFactory.create({ status: "pending" });
      await ReviewTaskFactory.create({ status: "approved" }); // 2 pending total

      // Create activity logs (one with no project, some with project)
      await ActivityLogFactory.create({
        projectId: project1.id,
        type: "commit",
        description: "Commit 1",
      });
      const log2 = await ActivityLogFactory.create({
        projectId: project2.id,
        type: "review_resolved",
        description: "Review 1",
      });

      // Act
      const stats = await service.getDashboardStats();

      // Assert
      expect(stats.totalProjects).toBeGreaterThanOrEqual(2);
      expect(stats.totalL1Tags).toBeGreaterThanOrEqual(2);
      expect(stats.totalL2Nodes).toBeGreaterThanOrEqual(3);
      expect(stats.totalL3Nodes).toBeGreaterThanOrEqual(2);
      expect(stats.pendingReviews).toBeGreaterThanOrEqual(2);

      expect(stats.recentActivity.length).toBeGreaterThanOrEqual(2);

      const foundLog2 = stats.recentActivity.find((a) => a.id === log2.id);
      expect(foundLog2).toBeDefined();
      expect(foundLog2?.projectName).toBe("Project Beta");
      expect(foundLog2?.type).toBe("review_resolved");
      expect(foundLog2?.description).toBe("Review 1");
    });
  });

  it("should handle activity logs without a project", async () => {
    await withRollback(async () => {
      // Arrange
      const log = await ActivityLogFactory.create({
        projectId: null as any,
        type: "document",
        description: "System started",
      });

      // Act
      const stats = await service.getDashboardStats();

      // Assert
      const foundLog = stats.recentActivity.find((a) => a.id === log.id);
      expect(foundLog).toBeDefined();
      expect(foundLog?.projectName).toBeNull();
      expect(foundLog?.type).toBe("document");
    });
  });
});

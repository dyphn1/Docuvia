import { describe, it, expect, beforeEach, vi } from "vitest";
import { DocumentService } from "./document.service.js";
// @ts-ignore
import { withRollback } from "@workspace/test-utils";
// @ts-ignore
import { DocumentFactory, ProjectFactory } from "@workspace/test-utils";
import { db, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import fs from "fs";
import * as core from "@workspace/core";
import * as hashUtils from "../lib/utils/hash.js";

vi.mock("fs", () => {
  return {
    default: {
      promises: {
        open: vi.fn(),
      },
    },
  };
});

vi.mock("@workspace/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/core")>();
  return {
    ...actual,
    detectDocType: vi.fn(),
    extractText: vi.fn(),
  };
});

vi.mock("../lib/utils/hash.js", () => {
  return {
    computeHashFromStream: vi.fn(),
  };
});

describe("DocumentService", () => {
  let service: DocumentService;

  beforeEach(() => {
    service = new DocumentService();
    vi.resetAllMocks();
  });

  describe("listMiscDocuments", () => {
    it("should return documents with no projectId", async () => {
      await withRollback(async () => {
        // Arrange
        await DocumentFactory.create({ projectId: null as any });
        await DocumentFactory.create({ projectId: null as any });

        const project = await ProjectFactory.create();
        await DocumentFactory.create({ projectId: project.id }); // Should not be listed

        // Act
        const docs = await service.listMiscDocuments();

        // Assert
        expect(docs.length).toBeGreaterThanOrEqual(2);
        docs.forEach((d) => {
          expect(d.projectId).toBeNull();
        });
      });
    });
  });

  describe("affiliateDocument", () => {
    it("should affiliate a document and update its status", async () => {
      await withRollback(async () => {
        // Arrange
        const doc = await DocumentFactory.create({ projectId: null as any, status: "processing" });
        const project = await ProjectFactory.create();

        // Act
        const updated = await service.affiliateDocument(doc.id, project.id);

        // Assert
        expect(updated).toBeDefined();
        expect(updated?.projectId).toBe(project.id);
        expect(updated?.status).toBe("affiliated");
        expect(updated?.affiliatedAt).toBeDefined();

        const inDb = await db.select().from(documentsTable).where(eq(documentsTable.id, doc.id));
        expect(inDb[0].projectId).toBe(project.id);
      });
    });

    it("should return null if document does not exist", async () => {
      await withRollback(async () => {
        // Arrange (no setup needed)

        // Act
        const result = await service.affiliateDocument(999999, 1);

        // Assert
        expect(result).toBeNull();
      });
    });
  });

  describe("processAndSaveDocument", () => {
    it("should process and save a valid document", async () => {
      await withRollback(async () => {
        // Arrange
        // Mock fs.promises.open
        const mockFd = {
          read: vi.fn().mockImplementation((buf) => {
            Buffer.from("25504446", "hex").copy(buf); // Valid PDF signature
            return { bytesRead: 4 };
          }),
          close: vi.fn(),
        };
        vi.mocked(fs.promises.open).mockResolvedValue(mockFd as any);

        vi.mocked(core.detectDocType).mockReturnValue("pdf");
        vi.mocked(core.extractText).mockResolvedValue("Extracted content here");
        vi.mocked(hashUtils.computeHashFromStream).mockResolvedValue("hash123");

        const file = {
          path: "/tmp/file.pdf",
          originalname: "test.pdf",
        };

        // Act
        const result = await service.processAndSaveDocument(file, 1);

        // Assert
        expect(result).toBeDefined();
        expect(result.filename).toBe("test.pdf");
        expect(result.docType).toBe("pdf");
        expect(result.content).toBe("Extracted content here");
        expect(result.contentHash).toBe("hash123");
        expect(result.validityStatus).toBe("pending_affiliation");
        expect(result.uploadedBy).toBe(1);

        expect(fs.promises.open).toHaveBeenCalledWith("/tmp/file.pdf", "r");
        expect(core.extractText).toHaveBeenCalledWith("/tmp/file.pdf", "pdf", "test.pdf");
        expect(hashUtils.computeHashFromStream).toHaveBeenCalledWith("/tmp/file.pdf");
      });
    });

    it("should throw error if quota exceeded", async () => {
      await withRollback(async () => {
        // Arrange
        // Insert 1000 misc documents to exceed quota
        const docs = Array.from({ length: 1000 }).map((_, i) => ({
          filename: `doc${i}.txt`,
          docType: "txt" as const,
          content: "content",
          projectId: null,
        }));
        await db.insert(documentsTable).values(docs);

        // Act
        const promise = service.processAndSaveDocument(
          { path: "/tmp/a.txt", originalname: "a.txt" },
          1
        );

        // Assert
        await expect(promise).rejects.toThrow("QUOTA_EXCEEDED");
      });
    });

    it("should throw error if file path is missing", async () => {
      await withRollback(async () => {
        // Arrange
        const file = { originalname: "a.txt" };

        // Act
        const promise = service.processAndSaveDocument(file, 1);

        // Assert
        await expect(promise).rejects.toThrow("MISSING_FILE_PATH");
      });
    });

    it("should throw error on invalid PDF signature", async () => {
      await withRollback(async () => {
        // Arrange
        const mockFd = {
          read: vi.fn().mockImplementation((buf) => {
            Buffer.from("00000000", "hex").copy(buf); // Invalid PDF signature
            return { bytesRead: 4 };
          }),
          close: vi.fn(),
        };
        vi.mocked(fs.promises.open).mockResolvedValue(mockFd as any);
        vi.mocked(core.detectDocType).mockReturnValue("pdf");

        // Act
        const promise = service.processAndSaveDocument(
          { path: "/tmp/a.pdf", originalname: "a.pdf" },
          1
        );

        // Assert
        await expect(promise).rejects.toThrow("INVALID_SIGNATURE_PDF");
      });
    });

    it("should throw error on invalid Office signature", async () => {
      await withRollback(async () => {
        // Arrange
        const mockFd = {
          read: vi.fn().mockImplementation((buf) => {
            Buffer.from("00000000", "hex").copy(buf); // Invalid DOCX signature
            return { bytesRead: 4 };
          }),
          close: vi.fn(),
        };
        vi.mocked(fs.promises.open).mockResolvedValue(mockFd as any);
        vi.mocked(core.detectDocType).mockReturnValue("docx");

        // Act
        const promise = service.processAndSaveDocument(
          { path: "/tmp/a.docx", originalname: "a.docx" },
          1
        );

        // Assert
        await expect(promise).rejects.toThrow("INVALID_SIGNATURE_OFFICE");
      });
    });
  });
});

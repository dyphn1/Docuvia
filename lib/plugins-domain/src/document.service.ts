import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db";
import { eq, isNull, count, sql } from "drizzle-orm";
import {
  detectDocType,
  extractText,
  computeHashFromStream,
  IDocumentService,
} from "@workspace/core";
import fs from "fs";

function serializeDocument(d: any) {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    affiliatedAt: d.affiliatedAt?.toISOString() ?? null,
  };
}

export class DocumentService implements IDocumentService {
  async listDocumentsByProjectId(projectId: number) {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.projectId, projectId))
      .orderBy(documentsTable.createdAt);

    return docs.map(serializeDocument);
  }

  async listMiscDocuments() {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(isNull(documentsTable.projectId))
      .orderBy(documentsTable.createdAt);

    return docs.map(serializeDocument);
  }

  async affiliateDocument(id: number, projectId: number) {
    const [updated] = await db
      .update(documentsTable)
      .set({
        projectId,
        affiliatedAt: new Date(),
        status: "affiliated",
      })
      .where(eq(documentsTable.id, id))
      .returning();

    if (!updated) return null;

    return serializeDocument(updated);
  }

  async processAndSaveDocument(file: any, uploadedBy: number) {
    // Max's Rule: Enforce a strict file count quota for the anonymous pool
    const [quotaCheck] = await db
      .select({ count: count() })
      .from(documentsTable)
      .where(isNull(documentsTable.projectId));

    if (quotaCheck.count >= 1000) {
      throw new Error("QUOTA_EXCEEDED");
    }

    const filePath = file.path;
    if (!filePath) {
      throw new Error("MISSING_FILE_PATH");
    }

    // Max's Rule: Validate Magic Bytes to prevent spoofed extensions from slipping through.
    const fd = await fs.promises.open(filePath, "r");
    const headerBuffer = Buffer.alloc(4);
    await fd.read(headerBuffer, 0, 4, 0);
    await fd.close();
    const hexHeader = headerBuffer.toString("hex").toUpperCase();

    // PDF magic bytes: 25504446
    // DOCX/PPTX (ZIP) magic bytes: 504B0304
    const docType = detectDocType(file.originalname);
    if (docType === "pdf" && !hexHeader.startsWith("25504446")) {
      throw new Error("INVALID_SIGNATURE_PDF");
    }
    if ((docType === "docx" || docType === "pptx") && !hexHeader.startsWith("504B0304")) {
      throw new Error("INVALID_SIGNATURE_OFFICE");
    }

    const contentHash = await computeHashFromStream(filePath);
    const rawContent = await extractText(filePath, docType, file.originalname);

    const [inserted] = await db
      .insert(documentsTable)
      .values({
        filename: file.originalname,
        content: rawContent,
        docType,
        contentHash,
        // Max's Rule: Explicit status flag so background workers ignore it
        validityStatus: "pending_affiliation",
        uploadedBy,
      })
      .returning();

    return inserted;
  }
}

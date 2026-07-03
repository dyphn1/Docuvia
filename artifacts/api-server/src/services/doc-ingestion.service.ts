import { db, documentsTable, projectsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { processIngestion, detectDocType, extractText, DocumentItem } from "@workspace/core";
import { computeHashFromStream } from "@workspace/core";

export class DocumentIngestionService {
  async ingestDocumentFromFile(
    project: typeof projectsTable.$inferSelect,
    filePath: string,
    originalname: string,
    commitSha?: string
  ) {
    let docType = detectDocType(originalname);
    const ext = originalname.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "log") docType = "build_artifact";

    let content: string;
    try {
      content = await extractText(filePath, docType, originalname);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse document: ${msg}`);
    }

    if (!content || content.length === 0) {
      throw new Error("Extracted content is empty");
    }

    const docItem: DocumentItem = {
      filename: originalname,
      docType,
      content,
      commitSha,
    };

    const { ingested, skipped, errors } = await processIngestion({
      type: "document",
      projectId: project.id,
      projectName: project.name,
      items: [docItem],
    });

    if (errors.length > 0) {
      throw new Error(`Ingestion failed: ${errors.join(", ")}`);
    }

    if (skipped > 0) {
      return { skipped: true };
    }

    const docs = await db
      .select()
      .from(documentsTable)
      .where(
        and(eq(documentsTable.projectId, project.id), eq(documentsTable.filename, originalname))
      )
      .orderBy(sql`${documentsTable.createdAt} desc`)
      .limit(1);

    return { skipped: false, document: docs[0] };
  }

  async ingestDocumentFromContent(
    project: typeof projectsTable.$inferSelect,
    filename: string,
    content: string,
    commitSha?: string,
    docTypeInput?: string
  ) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "md";
    let docType: "markdown" | "txt" | "pdf" | "docx" | "pptx" | "build_artifact" = "markdown";
    if (ext === "txt") docType = "txt";
    else if (ext === "pdf") docType = "pdf";
    else if (ext === "docx") docType = "docx";
    else if (ext === "pptx") docType = "pptx";
    else if (["map", "fv", "fd", "log"].includes(ext)) docType = "build_artifact";

    if (docTypeInput) docType = docTypeInput as any;

    const docItem: DocumentItem = {
      filename,
      docType,
      content,
      commitSha,
    };

    const { ingested, skipped, errors } = await processIngestion({
      type: "document",
      projectId: project.id,
      projectName: project.name,
      items: [docItem],
    });

    if (errors.length > 0) {
      throw new Error(`Ingestion failed: ${errors.join(", ")}`);
    }

    if (skipped > 0) {
      return { skipped: true };
    }

    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.projectId, project.id), eq(documentsTable.filename, filename)))
      .orderBy(sql`${documentsTable.createdAt} desc`)
      .limit(1);

    return { skipped: false, document: docs[0] };
  }

  async ingestBuildArtifactFromFile(
    project: typeof projectsTable.$inferSelect,
    filePath: string,
    originalname: string
  ) {
    const contentHash = await computeHashFromStream(filePath);
    const strippedContent = await extractText(filePath, "build_artifact", originalname);

    const result = await processIngestion({
      type: "document",
      projectId: project.id,
      projectName: project.name,
      items: [
        {
          filename: originalname,
          content: strippedContent,
          docType: "build_artifact",
          contentHash,
        },
      ],
    });
    return result;
  }
}

import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "../support/db";
import { computeHashFromBuffer } from "../../src/lib/utils/hash";

describe("POST /api/documents", () => {
  it("stores uploaded text files with a content hash", async () => {
    await withRollback(async () => {
      const payload = Buffer.from("Hello Docuvia");
      const response = await request(app)
        .post("/api/documents")
        .set("Authorization", "Bearer test-api-key")
        .attach("file", payload, {
          filename: "notes.txt",
          contentType: "text/plain",
        });
      console.log(response.text);

      expect(response.body.filename).toBe("notes.txt");
      expect(response.body.docType).toBe("txt");
      expect(response.body.content).toBe("Hello Docuvia");
      expect(response.body.contentHash).toBe(computeHashFromBuffer(payload));
    });
  });
});

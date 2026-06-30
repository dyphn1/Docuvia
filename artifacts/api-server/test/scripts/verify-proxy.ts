import express from "express";
import request from "supertest";
import { llmProxyRouter } from "../../src/proxy/llm-proxy.js";

const app = express();
app.use("/proxy/v1", llmProxyRouter);

async function run() {
  // Create a mock 50KB payload
  let largeCodeBlock = "```javascript\n";
  for (let i = 0; i < 2000; i++) {
    largeCodeBlock +=
      'function mockFunction() { console.log("this is a very long code block to trigger compression"); }\n';
  }
  largeCodeBlock += "```";

  console.log(`Original code block length: ${largeCodeBlock.length} bytes`);

  const response = await request(app)
    .post("/proxy/v1/chat/completions")
    .send({
      model: "gpt-4",
      messages: [{ role: "user", content: `Please review this code:\n${largeCodeBlock}` }],
    });

  const body = response.body as any;
  if (!body || !body._debug_modified_body || !body._debug_modified_body.messages) {
    console.error("❌ Failed to get proper response format", body);
    process.exit(1);
  }
  const compressedContent = body._debug_modified_body.messages[1].content;
  console.log(`Compressed content length: ${compressedContent.length} bytes`);

  if (compressedContent.length < 5000 && compressedContent.includes("COMPRESSED_SKELETON_ID")) {
    console.log("✅ Compression successful. Size is < 5KB.");
  } else {
    console.error("❌ Compression failed or size is too large.");
    process.exit(1);
  }
}

run().catch(console.error);

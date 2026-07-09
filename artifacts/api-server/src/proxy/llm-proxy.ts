import express, { Router, Request, Response } from "express";
import { compressPrompt } from "./compressor.js";
import { Readable } from "node:stream";
import { API_MESSAGES } from "@workspace/core";
import {
  PROXY_JSON_LIMIT,
  OPENAI_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_VERSION_HEADER_KEY,
  ANTHROPIC_VERSION_HEADER_VAL,
} from "../constants/index.js";

export const llmProxyRouter = Router();

// Apply JSON body parsing for the proxy
llmProxyRouter.use(express.json({ limit: PROXY_JSON_LIMIT }));

llmProxyRouter.post("/chat/completions", async (req: Request, res: Response) => {
  // OpenAI format
  const body = req.body;
  let modified = false;

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === "string") {
        const { compressedText, hasChanges } = await compressPrompt(msg.content);
        if (hasChanges) {
          msg.content = compressedText;
          modified = true;
        }
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && typeof part.text === "string") {
            const { compressedText, hasChanges } = await compressPrompt(part.text);
            if (hasChanges) {
              part.text = compressedText;
              modified = true;
            }
          }
        }
      }
    }

    // Inject system prompt instructing the LLM about the MCP tool
    if (modified) {
      const systemInstruction = API_MESSAGES.COMPRESSED_BLOCK_INSTRUCTION;
      const firstMsg = body.messages[0];
      if (firstMsg && firstMsg.role === "system") {
        firstMsg.content += "\n" + systemInstruction;
      } else {
        body.messages.unshift({ role: "system", content: systemInstruction });
      }
    }
  }

  // Proxy the request to the real LLM endpoint
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "";

  try {
    const fetchResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    for (const [key, value] of fetchResponse.headers.entries()) {
      res.setHeader(key, value);
    }
    res.status(fetchResponse.status);

    if (fetchResponse.body) {
      Readable.fromWeb(fetchResponse.body as any).pipe(res);
    } else {
      res.end();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

llmProxyRouter.post("/messages", async (req: Request, res: Response) => {
  // Anthropic format
  const body = req.body;
  let modified = false;

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === "string") {
        const { compressedText, hasChanges } = await compressPrompt(msg.content);
        if (hasChanges) {
          msg.content = compressedText;
          modified = true;
        }
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && typeof part.text === "string") {
            const { compressedText, hasChanges } = await compressPrompt(part.text);
            if (hasChanges) {
              part.text = compressedText;
              modified = true;
            }
          }
        }
      }
    }
  }

  if (modified) {
    const systemInstruction = API_MESSAGES.COMPRESSED_BLOCK_INSTRUCTION;
    if (body.system) {
      body.system += "\n" + systemInstruction;
    } else {
      body.system = systemInstruction;
    }
  }

  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || ANTHROPIC_DEFAULT_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "";

  try {
    const fetchResponse = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        [ANTHROPIC_VERSION_HEADER_KEY]: ANTHROPIC_VERSION_HEADER_VAL,
      },
      body: JSON.stringify(body),
    });

    for (const [key, value] of fetchResponse.headers.entries()) {
      res.setHeader(key, value);
    }
    res.status(fetchResponse.status);

    if (fetchResponse.body) {
      Readable.fromWeb(fetchResponse.body as any).pipe(res);
    } else {
      res.end();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

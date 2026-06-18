import express, { Router, Request, Response } from 'express';
import { saveCompressedPayload } from '../memory/shared-memory.js';
import crypto from 'crypto';

export const llmProxyRouter = Router();

// Apply JSON body parsing for the proxy
llmProxyRouter.use(express.json({ limit: '50mb' }));

// Dummy compression logic
function compressPrompt(text: string): { compressedText: string, hasChanges: boolean } {
    let hasChanges = false;
    // Replace large text (e.g., code blocks) with skeletons
    const codeBlockRegex = /```[\s\S]*?```/g;
    
    const compressedText = text.replace(codeBlockRegex, (match) => {
        if (match.length > 500) {
            hasChanges = true;
            const id = crypto.randomUUID();
            saveCompressedPayload(id, match);
            return `\`\`\`\n// [COMPRESSED_SKELETON_ID: ${id}]\n// Use docuvia_retrieve_original MCP tool to read the full code if needed.\nfunction skeleton() { /* ... */ }\n\`\`\``;
        }
        return match;
    });

    return { compressedText, hasChanges };
}

llmProxyRouter.post('/chat/completions', (req: Request, res: Response) => {
    // OpenAI format
    const body = req.body;
    let modified = false;

    if (body.messages && Array.isArray(body.messages)) {
        for (const msg of body.messages) {
            if (typeof msg.content === 'string') {
                const { compressedText, hasChanges } = compressPrompt(msg.content);
                if (hasChanges) {
                    msg.content = compressedText;
                    modified = true;
                }
            } else if (Array.isArray(msg.content)) {
                 for (const part of msg.content) {
                     if (part.type === 'text' && typeof part.text === 'string') {
                         const { compressedText, hasChanges } = compressPrompt(part.text);
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
             const systemInstruction = "System: Some large code blocks have been compressed. Use the `docuvia_retrieve_original` MCP tool with the provided COMPRESSED_SKELETON_ID if you need to read the full code.";
             const firstMsg = body.messages[0];
             if (firstMsg && firstMsg.role === 'system') {
                 firstMsg.content += '\\n' + systemInstruction;
             } else {
                 body.messages.unshift({ role: 'system', content: systemInstruction });
             }
        }
    }

    // Proxy the request to the real LLM endpoint (mocked here)
    // For local tests we just echo the compressed body.
    res.json({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Date.now(),
        model: body.model || "mock-model",
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: "This is a mock proxy response. Received compressed payload.",
                },
                finish_reason: "stop"
            }
        ],
        // return the modified body for verification purposes
        _debug_modified_body: body
    });
});

llmProxyRouter.post('/messages', (req: Request, res: Response) => {
    // Anthropic format
    const body = req.body;
    let modified = false;

    if (body.messages && Array.isArray(body.messages)) {
        for (const msg of body.messages) {
            if (typeof msg.content === 'string') {
                const { compressedText, hasChanges } = compressPrompt(msg.content);
                if (hasChanges) {
                    msg.content = compressedText;
                    modified = true;
                }
            } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                     if (part.type === 'text' && typeof part.text === 'string') {
                         const { compressedText, hasChanges } = compressPrompt(part.text);
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
         const systemInstruction = "System: Some large code blocks have been compressed. Use the `docuvia_retrieve_original` MCP tool with the provided COMPRESSED_SKELETON_ID if you need to read the full code.";
         if (body.system) {
             body.system += '\\n' + systemInstruction;
         } else {
             body.system = systemInstruction;
         }
    }

    res.json({
        id: "msg_mock",
        type: "message",
        role: "assistant",
        content: [
            {
                type: "text",
                text: "This is a mock proxy response. Received compressed payload."
            }
        ],
        model: body.model || "mock-model",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        // return the modified body for verification purposes
        _debug_modified_body: body
    });
});

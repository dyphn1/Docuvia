import { HttpResponse, http } from "msw";

async function openaiChatHandler({ request }: any) {
  const body = (await request.json()) as any;
  const messages = body.messages || [];
  const lastUserMessage = messages.reverse().find((m: any) => m.role === "user")?.content || "";

  let content = "[]";

  if (lastUserMessage.includes("Generate L1 tags")) {
    const jsonStr = JSON.stringify([
      { name: "tag1", category: "feature", description: "desc" }
    ]);
    // Fuzzing: wrap in markdown and add prefix/suffix
    content = `Here are the L1 tags you requested:\n\n\`\`\`json\n${jsonStr}\n\`\`\`\n\nHope this helps!`;
  } else if (lastUserMessage.includes("Generate L2/L3 knowledge nodes")) {
    const jsonStr = JSON.stringify([
      {
        name: "module1",
        type: "module",
        description: "L2 node desc",
        l1TagNames: ["tag1"],
        l3Nodes: [
          {
            title: "rule1",
            nodeType: "rule",
            content: "l3 content",
            commitHash: "12345678",
            confidence: 0.9
          }
        ]
      }
    ]);
    content = `\`\`\`json\n${jsonStr}\n\`\`\``;
  } else if (lastUserMessage.includes("Synthesize updated content")) {
    content = "Updated content from mock.";
  } else if (lastUserMessage.includes("Extract architecture decisions")) {
    content = `\`\`\`json\n[]\n\`\`\``;
  } else {
    content = "{}";
  }

  return HttpResponse.json({
    id: "chatcmpl-mock",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  });
}

export const openaiHandlers = [
  http.post("https://api.openai.com/v1/chat/completions", openaiChatHandler),
  http.post("http://127.0.0.1:65535/v1/chat/completions", openaiChatHandler),
];

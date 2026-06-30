import { HttpResponse, http } from "msw";
import githubCommits from "./fixtures/github-commits.json";
import { openaiHandlers } from "./handlers/openai";

// Max's Rule: Network-level MSW interception for LLM tests, with fuzzy factories

export const handlers = [
  http.post("http://127.0.0.1:65535/v1/chat/completions", async ({ request }) => {
    // Generate dynamic fuzzy responses instead of static fixtures
    const fuzzyResponse = {
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: Date.now(),
      model: "mock-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Mocked LLM generation response. (Dynamic MSW payload)",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
    return HttpResponse.json(fuzzyResponse);
  }),

  ...openaiHandlers,
  http.get("https://api.github.com/repos/:owner/:repo/commits", () => {
    return HttpResponse.json(githubCommits);
  }),
  http.get("https://api.github.com/repos/:owner/:repo/pulls/:pullNumber", ({ params }) => {
    return HttpResponse.json({
      number: Number(params.pullNumber),
      title: "Mock pull request",
      body: "Mock pull request body",
      html_url: `https://github.com/${params.owner}/${params.repo}/pull/${params.pullNumber}`,
    });
  }),
  http.get("https://api.github.com/repos/:owner/:repo/pulls/:pullNumber/commits", () => {
    return HttpResponse.json(githubCommits);
  }),
  http.post("https://api.github.com/repos/:owner/:repo/issues/:issueNumber/comments", () => {
    return HttpResponse.json({ id: 1, body: "Mock comment" }, { status: 201 });
  }),
  http.get("https://api.github.com/simulate-error/400", () => {
    return HttpResponse.json({ message: "Bad Request simulation" }, { status: 400 });
  }),
  http.get("https://api.github.com/simulate-error/500", () => {
    return HttpResponse.json({ message: "Internal Server Error simulation" }, { status: 500 });
  }),
  http.post("http://127.0.0.1:65535/v1/embeddings", async () => {
    return HttpResponse.json({
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: "text-embedding-3-small",
    });
  }),
];

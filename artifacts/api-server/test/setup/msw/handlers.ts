import { HttpResponse, http } from "msw";
import githubCommits from "./fixtures/github-commits.json";
import { openaiHandlers } from "./handlers/openai";

// Max's Rule: Network-level MSW interception for LLM tests, with fuzzy factories

export const handlers = [
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

  // Explicit 4xx/5xx failure handlers for error resiliency tests
  http.get("https://api.github.com/repos/:owner/:repo/simulate-403", () => {
    return HttpResponse.json({ message: "API rate limit exceeded" }, { status: 403 });
  }),
  http.get("https://api.github.com/repos/:owner/:repo/simulate-500", () => {
    return HttpResponse.json({ message: "GitHub Internal Error" }, { status: 500 });
  }),
  http.post("http://127.0.0.1:65535/v1/simulate-error/429", () => {
    return HttpResponse.json(
      {
        error: {
          message: "Rate limit exceeded",
          type: "requests",
          param: null,
          code: "rate_limit_exceeded",
        },
      },
      { status: 429 }
    );
  }),
  http.post("http://127.0.0.1:65535/v1/simulate-error/503", () => {
    return HttpResponse.json(
      {
        error: {
          message: "OpenAI Service Unavailable",
          type: "server_error",
          param: null,
          code: null,
        },
      },
      { status: 503 }
    );
  }),

  http.get("https://api.github.com/simulate-error/400", () => {
    return HttpResponse.json({ message: "Bad Request simulation" }, { status: 400 });
  }),
  http.get("https://api.github.com/simulate-error/500", () => {
    return HttpResponse.json({ message: "Internal Server Error simulation" }, { status: 500 });
  }),
];

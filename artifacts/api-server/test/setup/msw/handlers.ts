import { HttpResponse, http } from "msw";
import githubCommits from "./fixtures/github-commits.json";
import { openaiHandlers } from "./handlers/openai";

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
  http.post("http://127.0.0.1:65535/v1/embeddings", async () => {
    return HttpResponse.json({
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: "text-embedding-3-small",
    });
  }),
];

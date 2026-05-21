import { afterAll, afterEach, beforeAll } from "vitest";

process.env.PORT ||= "8080";
process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/docuvia_test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||= "test-key";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||= "http://127.0.0.1:65535/v1";

const [{ server }, { pool }] = await Promise.all([import("./msw/server"), import("@workspace/db")]);

beforeAll(() => {
  server.listen({
    onUnhandledRequest(request, print) {
      const url = new URL(request.url);
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
        return;
      }
      print.error();
    },
  });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await pool.end();
});

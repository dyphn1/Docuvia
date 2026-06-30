import { afterAll, afterEach, beforeAll } from "vitest";
import net from "net";

process.env.PORT ||= "8080";
process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/docuvia_test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://api.openai.com/v1";
process.env.MCP_PAT ||= "test-mcp-token";
process.env.DOCUVIA_API_KEY ||= "test-api-key";
process.env.ADMIN_SECRET_TOKEN ||= "dev-secret-token";

async function checkDbConnection() {
  return new Promise<void>((resolve, reject) => {
    const dbUrl = new URL(process.env.DATABASE_URL!);
    const host = dbUrl.hostname;
    const port = parseInt(dbUrl.port, 10) || 5432;

    const socket = new net.Socket();
    socket.setTimeout(2000);

    socket.on("connect", () => {
      socket.destroy();
      resolve();
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(
        new Error(
          `Test Setup Aborted: Could not connect to PostgreSQL at ${host}:${port}. Is the database running?`
        )
      );
    });

    socket.on("error", (err) => {
      socket.destroy();
      reject(
        new Error(
          `Test Setup Aborted: Could not connect to PostgreSQL at ${host}:${port}. Is the database running? Error: ${err.message}`
        )
      );
    });

    socket.connect(port, host);
  });
}

try {
  await checkDbConnection();
} catch (error) {
  if (error instanceof Error) {
    console.error(`\n\x1b[31m[Test Setup Error]\x1b[0m ${error.message}\n`);
  } else {
    console.error(`\n\x1b[31m[Test Setup Error]\x1b[0m ${String(error)}\n`);
  }
  process.exit(1);
}

const [{ server }, { pool }] = await Promise.all([import("./msw/server"), import("@workspace/db")]);

server.listen({
  onUnhandledRequest(request, print) {
    const url = new URL(request.url);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return;
    }
    print.error();
  },
});

beforeAll(() => {
  // Empty beforeAll
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await pool.end();
});

import net from "node:net";
import { spawnSync } from "node:child_process";

const host = "127.0.0.1";
const port = 5432;

function isDbRunning() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function run() {
  const pushSchema = () => {
    console.log("Pushing database schema...");
    const pushResult = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push"], {
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        TEST_ENV: "1",
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/docuvia_test",
      },
    });
    if (pushResult.status !== 0) {
      console.error("Failed to push database schema");
      process.exit(1);
    }
  };

  if (await isDbRunning()) {
    console.log("Database is already running.");
    pushSchema();
    process.exit(0);
  }

  console.log("Database not found. Starting via docker compose...");
  const result = spawnSync("docker", ["compose", "up", "-d", "db"], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error("Failed to start docker compose");
    process.exit(1);
  }

  console.log("Waiting for database to be ready...");
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isDbRunning()) {
      console.log("Database is ready!");
      break;
    }
    if (i === 14) {
      console.error("Database did not start in time.");
      process.exit(1);
    }
  }

  // Push schema
  pushSchema();

  process.exit(0);
}

run();

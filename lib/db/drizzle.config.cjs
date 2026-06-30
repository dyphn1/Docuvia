const { defineConfig } = require("drizzle-kit");
const fs = require("node:fs");
const path = require("node:path");

const rootEnvPath = path.resolve(__dirname, "../../.env");
if (!process.env.TEST_ENV && fs.existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

module.exports = defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

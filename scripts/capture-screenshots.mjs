import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, "../docs/gitbook/images");

const routes = [
  { path: "/", name: "dashboard" },
  { path: "/projects", name: "projects-list" },
  { path: "/pipeline", name: "pipeline" },
  { path: "/query", name: "query" },
  { path: "/review", name: "review" },
  { path: "/l1-tags", name: "l1-tags" },
  { path: "/mcp", name: "mcp" },
];

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const baseUrl = "http://localhost:18774";

  for (const route of routes) {
    console.log(`Capturing ${route.name}...`);
    try {
      await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000); // Wait for animations/data
      await page.screenshot({ path: path.join(outDir, `${route.name}.png`) });
    } catch (err) {
      console.error(`Failed to capture ${route.name}:`, err);
    }
  }

  await browser.close();
  console.log("Screenshots captured successfully.");
}

run().catch(console.error);

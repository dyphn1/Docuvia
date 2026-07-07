const fs = require("fs");

const file = "lib/core/src/services/llm-provider.ts";
let content = fs.readFileSync(file, "utf8");

content = content.replace(
  /import \{ createLlmClient \} from "@workspace\/integrations-openai-ai-server";\n/,
  ""
);
content = content.replace(
  /const client = createLlmClient\(\{ provider, model, apiKey, baseUrl \}\);\n\n  return \{ orchestrator, client, model \};/,
  "return { orchestrator, model, apiKey, baseUrl, provider };"
);

fs.writeFileSync(file, content);

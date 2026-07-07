const fs = require("fs");

const file = "lib/core/src/services/embedding.ts";
let content = fs.readFileSync(file, "utf8");

const newCode = `
    const { apiKey, baseUrl, provider } = await getLlmOrchestratorForProject(projectId);
    
    let url = baseUrl;
    if (provider === "openai" && !url.endsWith('/embeddings')) {
      url = url.endsWith('/') ? \`\${url}embeddings\` : \`\${url}/embeddings\`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${apiKey}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8192),
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      })
    });

    if (!res.ok) {
      throw new Error(\`Embedding request failed: \${res.status} \${await res.text()}\`);
    }

    const response = await res.json();
    return response.data[0]?.embedding ?? null;
`;

content = content.replace(
  /    const \{ client \} = await getLlmOrchestratorForProject\(projectId\);\n    const response = await client\.embeddings\.create\(\{[\s\S]*?\}\);\n    return response\.data\[0\]\?\.embedding \?\? null;/,
  newCode.trim()
);

fs.writeFileSync(file, content);

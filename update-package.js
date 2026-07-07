const fs = require("fs");

function removeDependency(file, depName) {
  const content = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = false;
  if (content.dependencies && content.dependencies[depName]) {
    delete content.dependencies[depName];
    changed = true;
  }
  if (content.devDependencies && content.devDependencies[depName]) {
    delete content.devDependencies[depName];
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(file, JSON.stringify(content, null, 2) + "\n");
    console.log(`Removed ${depName} from ${file}`);
  }
}

removeDependency("lib/core/package.json", "@workspace/integrations-openai-ai-server");
removeDependency("artifacts/api-server/package.json", "@workspace/integrations-openai-ai-server");

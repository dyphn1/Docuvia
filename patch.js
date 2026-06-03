const fs = require('fs');
const file = 'artifacts/vscode-client/src/KnowledgeStore.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
  `      // Offline fallback: git show docuvia-knowledge:{projectId}/...
      if (tags.length === 0 && modules.length === 0 && manifest.project_id !== undefined) {`,
  `      // Local fallback: read from .docuvia directory directly
      if (tags.length === 0 && modules.length === 0) {
        try {
          const tagsYaml = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, 'l1_tags.yaml'));
          if (tagsYaml) {
            tags = parseTags(tagsYaml, 'l1_tags.yaml');
            const match = tagsYaml.match(/^project_name:\\s*"([^"\\n]+)"/m);
            if (match) projectName = match[1];
          }

          const modulesYaml = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, 'l2_modules.yaml'));
          if (modulesYaml) modules = parseModules(modulesYaml, 'l2_modules.yaml');

          const routerYaml = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, 'l3_router.yaml'));
          if (routerYaml) routerIndex = parseRouter(routerYaml, 'l3_router.yaml');

          // Read l3_decisions
          const decisionsDir = vscode.Uri.joinPath(docuviaDir, 'l3_decisions');
          try {
            const entries = await vscode.workspace.fs.readDirectory(decisionsDir);
            for (const [name, type] of entries) {
              if (type === vscode.FileType.File && name.endsWith('.md')) {
                const md = await this.readUriSafe(vscode.Uri.joinPath(decisionsDir, name));
                if (md) {
                  const decision = parseDecision(md, name);
                  if (decision) decisions.set(decision.id, decision);
                }
              }
            }
          } catch {
            // decisions dir might not exist
          }
        } catch (err) {
          this._outputChannel.appendLine(\`[Docuvia] Local fallback failed: \${String(err)}\`);
        }
      }

      // Offline fallback: git show docuvia-knowledge:{projectId}/...
      if (tags.length === 0 && modules.length === 0 && manifest.project_id !== undefined) {`
);
// wait we need to import parseModules and parseRouter
if(!code.includes('parseModules')) {
  code = code.replace('import { parseDecision, parseManifest, parseSingleModule, parseTags } from \'./parser.js\';', 'import { parseDecision, parseManifest, parseSingleModule, parseTags, parseModules, parseRouter } from \'./parser.js\';');
}
fs.writeFileSync(file, code);

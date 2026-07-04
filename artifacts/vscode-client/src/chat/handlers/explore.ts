import * as vscode from "vscode";
import * as path from "path";
import {
  L1_TEMPLATES,
  buildRawYaml,
  formatYamlAsTable,
  detectProjectTypes,
  refineTagsWithLM,
  generateTagsDynamically,
} from "../ontology.js";

export async function handleExplore(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  userPrompt?: string
): Promise<void> {
  // Resolve workspace root up-front so all button paths can reference it (BUG A-3 fix)
  let workspaceRoot = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri.fsPath
    : undefined;

  if (!workspaceRoot) {
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 1) {
      workspaceRoot = folders[0].uri.fsPath;
    } else if (folders.length > 1) {
      const picked = await vscode.window.showWorkspaceFolderPick({
        placeHolder: "Select a workspace to explore",
      });
      if (picked) {
        workspaceRoot = picked.uri.fsPath;
      }
    }
  }

  if (!workspaceRoot) {
    stream.markdown("No workspace folder is open or selected.");
    return;
  }

  // If user specified a type directly, use the matching template without workspace detection
  if (userPrompt) {
    const promptLower = userPrompt.trim().toLowerCase();
    const TYPE_TOKENS = L1_TEMPLATES.map((t) => t.projectType);
    const matchedToken = TYPE_TOKENS.find((t) => promptLower.includes(t));
    if (matchedToken) {
      const template = L1_TEMPLATES.find(
        (t) => t.projectType === matchedToken || t.keywords.includes(matchedToken)
      );
      if (template) {
        stream.progress(`Using ${template.label} template...`);
        const yaml = await buildRawYaml(template);
        const table = formatYamlAsTable(yaml);
        stream.markdown(`**Template:** ${template.label}\n\nSuggested L1 Tags:\n\n${table}`);
        stream.button({
          command: "docuvia.acceptL1Tags",
          title: "Accept & Write to local.db",
          arguments: [yaml, workspaceRoot],
        });
        return;
      }
    }
  }

  stream.progress("Reading workspace files...");

  // Read README.md (continue if absent)
  let readmeContent = "";
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(workspaceRoot, "README.md"))
    );
    readmeContent = Buffer.from(bytes).toString("utf-8");
  } catch (err: any) {
    console.debug(
      `[ExploreHandler] README.md not found or unreadable: ${err.message || String(err)}`
    );
  }

  // Read package.json (continue if absent)
  let pkgJson: Record<string, unknown> = {};
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(workspaceRoot, "package.json"))
    );
    pkgJson = JSON.parse(Buffer.from(bytes).toString("utf-8")) as Record<string, unknown>;
  } catch (err: any) {
    console.debug(
      `[ExploreHandler] package.json not found or unreadable: ${err.message || String(err)}`
    );
  }

  const detectedTypes = detectProjectTypes(readmeContent, pkgJson);

  if (detectedTypes.length > 0) {
    const label = detectedTypes.map((t) => t.label).join(" + ");
    stream.progress(`Detected project mix: ${label}`);
    const refinedYaml = await refineTagsWithLM(detectedTypes, readmeContent, request.model, token);
    const table = formatYamlAsTable(refinedYaml);
    stream.markdown(`**Detected:** ${label}\n\nSuggested L1 Tags:\n\n${table}`);
    stream.button({
      command: "docuvia.acceptL1Tags",
      title: "Accept & Write to local.db",
      arguments: [refinedYaml, workspaceRoot],
    });
  } else {
    stream.progress(
      `Unrecognized standard patterns. Analyzing dependencies dynamically with AI...`
    );
    const dynamicYaml = await generateTagsDynamically(readmeContent, pkgJson, request.model, token);

    if (dynamicYaml) {
      const table = formatYamlAsTable(dynamicYaml);
      stream.markdown(
        `**Detected:** Dynamic Custom Architecture\n\nSuggested L1 Tags:\n\n${table}`
      );
      stream.button({
        command: "docuvia.acceptL1Tags",
        title: "Accept & Write to local.db",
        arguments: [dynamicYaml, workspaceRoot],
      });
    } else {
      // Interactive fallback — ask one clarifying question
      stream.markdown(
        "I couldn't detect your project type automatically, and AI dynamic analysis failed.\n\n" +
          "**What best describes your project?**\n" +
          "- `frontend` — React, Vue, Angular, etc.\n" +
          "- `backend` — Express, Django, Rails, etc.\n" +
          "- `fullstack` — Both frontend and backend\n" +
          "- `monorepo` — Multiple packages in one repo\n" +
          "- `library` — An SDK or npm package\n" +
          "- `cli` — A command-line tool\n\n" +
          "Reply with `/explore <type>` (e.g. `/explore backend`) to get tag suggestions."
      );
    }
  }
}

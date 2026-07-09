import * as vscode from "vscode";
import * as path from "path";
import {
  buildRawYaml,
  formatYamlAsTable,
  detectProjectTypes,
  refineTagsWithLM,
  generateTagsDynamically,
} from "../ontology.js";
import { FILE_README, FILE_PACKAGE_JSON, ENCODING_UTF_8 } from "@workspace/core";
import { L1_TEMPLATES } from "../../constants/templates.js";
import {
  CMD_ACCEPT_L1_TAGS,
  MSG_SELECT_WORKSPACE_TO_EXPLORE,
  MSG_NO_WORKSPACE_OPEN,
  TITLE_ACCEPT_L1_TAGS,
  MSG_READING_WORKSPACE_FILES,
  MSG_UNRECOGNIZED_PATTERNS_DYNAMIC_ANALYSIS,
  LABEL_DYNAMIC_CUSTOM_ARCHITECTURE,
  MSG_INTERACTIVE_FALLBACK,
} from "../../constants/index.js";

async function getWorkspaceRoot(): Promise<string | undefined> {
  if (vscode.window.activeTextEditor) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }

  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  if (folders.length > 1) {
    const picked = await vscode.window.showWorkspaceFolderPick({
      placeHolder: MSG_SELECT_WORKSPACE_TO_EXPLORE,
    });
    return picked?.uri.fsPath;
  }

  return undefined;
}

async function readFileSafe(workspaceRoot: string, fileName: string): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(workspaceRoot, fileName))
    );
    return Buffer.from(bytes).toString(ENCODING_UTF_8);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.debug(`[ExploreHandler] ${fileName} not found or unreadable: ${errorMsg}`);
    return "";
  }
}

async function readJsonSafe<T = Record<string, unknown>>(
  workspaceRoot: string,
  fileName: string
): Promise<T> {
  const content = await readFileSafe(workspaceRoot, fileName);
  if (!content) {
    return {} as T;
  }
  try {
    return JSON.parse(content) as T;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.debug(`[ExploreHandler] Failed to parse ${fileName}: ${errorMsg}`);
    return {} as T;
  }
}

function renderTagSuggestions(
  stream: vscode.ChatResponseStream,
  yaml: string,
  workspaceRoot: string,
  label: string,
  prefix: string = "Detected"
): void {
  const table = formatYamlAsTable(yaml);
  stream.markdown(`**${prefix}:** ${label}\n\nSuggested L1 Tags:\n\n${table}`);
  stream.button({
    command: CMD_ACCEPT_L1_TAGS,
    title: TITLE_ACCEPT_L1_TAGS,
    arguments: [yaml, workspaceRoot],
  });
}

export async function handleExplore(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  userPrompt?: string
): Promise<void> {
  const workspaceRoot = await getWorkspaceRoot();

  if (!workspaceRoot) {
    stream.markdown(MSG_NO_WORKSPACE_OPEN);
    return;
  }

  // If user specified a type directly, use the matching template without workspace detection
  if (userPrompt) {
    const promptLower = userPrompt.trim().toLowerCase();
    const matchedToken = L1_TEMPLATES.find((t: any) =>
      promptLower.includes(t.projectType)
    )?.projectType;

    if (matchedToken) {
      const template = L1_TEMPLATES.find(
        (t: any) => t.projectType === matchedToken || t.keywords.includes(matchedToken)
      );
      if (template) {
        stream.progress(`Using ${template.label} template...`);
        const yaml = await buildRawYaml(template);
        renderTagSuggestions(stream, yaml, workspaceRoot, template.label, "Template");
        return;
      }
    }
  }

  stream.progress(MSG_READING_WORKSPACE_FILES);

  const [readmeContent, pkgJson] = await Promise.all([
    readFileSafe(workspaceRoot, FILE_README),
    readJsonSafe(workspaceRoot, FILE_PACKAGE_JSON),
  ]);

  const detectedTypes = detectProjectTypes(readmeContent, pkgJson);

  if (detectedTypes.length > 0) {
    const label = detectedTypes.map((t: any) => t.label).join(" + ");
    stream.progress(`Detected project mix: ${label}`);
    const refinedYaml = await refineTagsWithLM(detectedTypes, readmeContent, request.model, token);
    renderTagSuggestions(stream, refinedYaml, workspaceRoot, label);
    return;
  }

  stream.progress(MSG_UNRECOGNIZED_PATTERNS_DYNAMIC_ANALYSIS);
  const dynamicYaml = await generateTagsDynamically(readmeContent, pkgJson, request.model, token);

  if (dynamicYaml) {
    renderTagSuggestions(stream, dynamicYaml, workspaceRoot, LABEL_DYNAMIC_CUSTOM_ARCHITECTURE);
    return;
  }

  // Interactive fallback — ask one clarifying question
  stream.markdown(MSG_INTERACTIVE_FALLBACK);
}

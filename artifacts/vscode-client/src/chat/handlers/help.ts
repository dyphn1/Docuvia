import * as vscode from "vscode";
import { MSG_HELP_TABLE } from "../../constants/index.js";

export function handleHelp(stream: vscode.ChatResponseStream): void {
  stream.markdown(MSG_HELP_TABLE);
}

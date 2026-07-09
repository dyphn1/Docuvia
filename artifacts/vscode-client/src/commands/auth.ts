import * as vscode from "vscode";
import { CredentialManager } from "../credential-manager.js";
import {
  MSG_AUTH_PROMPT_TITLE,
  MSG_AUTH_TOKEN_SAVED,
  MSG_AUTH_TOKEN_CLEARED,
  MSG_AUTH_PROMPT_TITLE_PLACEHOLDER,
  MSG_AUTH_TOKEN_EMPTY,
} from "../constants/index.js";

export async function setServerTokenCommand(credentialManager: CredentialManager) {
  const token = await vscode.window.showInputBox({
    prompt: MSG_AUTH_PROMPT_TITLE,
    password: true,
    placeHolder: MSG_AUTH_PROMPT_TITLE_PLACEHOLDER,
    validateInput: (v) => (v.trim().length === 0 ? MSG_AUTH_TOKEN_EMPTY : null),
  });
  if (token && token.trim().length > 0) {
    await credentialManager.setToken(token.trim());
    void vscode.window.showInformationMessage(MSG_AUTH_TOKEN_SAVED);
  }
}

export async function clearServerTokenCommand(credentialManager: CredentialManager) {
  await credentialManager.clearToken();
  void vscode.window.showInformationMessage(MSG_AUTH_TOKEN_CLEARED);
}

import * as vscode from "vscode";
import { CredentialManager } from "../credential-manager.js";

export async function setServerTokenCommand(credentialManager: CredentialManager) {
  const token = await vscode.window.showInputBox({
    prompt: "Enter your Docuvia server API token",
    password: true,
    placeHolder: "docuvia_token_...",
    validateInput: (v) => (v.trim().length === 0 ? "Token cannot be empty" : null),
  });
  if (token && token.trim().length > 0) {
    await credentialManager.setToken(token.trim());
    void vscode.window.showInformationMessage("Docuvia: Server token saved.");
  }
}

export async function clearServerTokenCommand(credentialManager: CredentialManager) {
  await credentialManager.clearToken();
  void vscode.window.showInformationMessage("Docuvia: Server token cleared.");
}

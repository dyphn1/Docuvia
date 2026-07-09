import * as vscode from "vscode";
import { SECRET_KEY_SERVER_TOKEN } from "./constants/index.js";

export class CredentialManager {
  constructor(private readonly _secrets: vscode.SecretStorage) {}

  async getToken(): Promise<string | undefined> {
    return this._secrets.get(SECRET_KEY_SERVER_TOKEN);
  }

  async setToken(token: string): Promise<void> {
    await this._secrets.store(SECRET_KEY_SERVER_TOKEN, token);
  }

  async clearToken(): Promise<void> {
    await this._secrets.delete(SECRET_KEY_SERVER_TOKEN);
  }
}

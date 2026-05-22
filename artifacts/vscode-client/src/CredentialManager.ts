import * as vscode from 'vscode';

const SECRET_KEY = 'docuvia.serverToken';

export class CredentialManager {
  constructor(private readonly _secrets: vscode.SecretStorage) {}

  async getToken(): Promise<string | undefined> {
    return this._secrets.get(SECRET_KEY);
  }

  async setToken(token: string): Promise<void> {
    await this._secrets.store(SECRET_KEY, token);
  }

  async clearToken(): Promise<void> {
    await this._secrets.delete(SECRET_KEY);
  }
}

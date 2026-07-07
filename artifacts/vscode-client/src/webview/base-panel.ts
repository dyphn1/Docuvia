import * as vscode from "vscode";

export abstract class BaseWebviewPanel {
  protected readonly _disposables: vscode.Disposable[] = [];

  protected constructor(
    protected readonly _panel: vscode.WebviewPanel,
    protected readonly _context: vscode.ExtensionContext
  ) {
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => this._handleMessage(message),
      null,
      this._disposables
    );
  }

  protected static createPanel(
    context: vscode.ExtensionContext,
    viewType: string,
    title: string,
    column: vscode.ViewColumn
  ): vscode.WebviewPanel {
    return vscode.window.createWebviewPanel(viewType, title, column, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
      retainContextWhenHidden: true,
    });
  }

  protected abstract _handleMessage(message: any): void;
  protected abstract _onDispose(): void;

  public dispose(): void {
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
    this._onDispose();
  }
}

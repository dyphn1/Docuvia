import * as vscode from 'vscode';
export function getModels() {
    vscode.lm.selectChatModels().then(models => {
        console.log(models.map(m => m.family));
    });
}

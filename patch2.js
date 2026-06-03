const fs = require('fs');
const file = 'artifacts/vscode-client/src/TaskRunner.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
  `const models = await vscode.lm.selectChatModels({ vendor: LM_VENDOR, family: LM_FAMILY });`,
  `let models = await vscode.lm.selectChatModels({ vendor: LM_VENDOR, family: LM_FAMILY });
    if (models.length === 0) {
      models = await vscode.lm.selectChatModels({ vendor: LM_VENDOR });
    }
    if (models.length === 0) {
      models = await vscode.lm.selectChatModels();
    }`
);
fs.writeFileSync(file, code);

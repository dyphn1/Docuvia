const fs = require("fs");

const path = "d:/GitHub/miya.daniel/Docuvia/lib/ast-core/src/language-provider.ts";
let content = fs.readFileSync(path, "utf8");

content = content.replace(
  /export interface LanguageProvider \{/,
  "export interface LanguageProvider {\n  buildScopeMap?: (importStatements: Node[]) => Map<string, string>;\n  classifyCall?: (callNode: Node) => { isMethodCall: boolean; methodName: string; objectName?: string };"
);

content = content.replace(
  /export interface LanguageConfig \{/,
  "export interface LanguageConfig {\n  buildScopeMap?: (importStatements: Node[]) => Map<string, string>;\n  classifyCall?: (callNode: Node) => { isMethodCall: boolean; methodName: string; objectName?: string };"
);

content = content.replace(
  /export class DefaultProvider implements LanguageProvider \{/,
  "export class DefaultProvider implements LanguageProvider {\n  buildScopeMap(importStatements: Node[]): Map<string, string> {\n    if (this.config.buildScopeMap) return this.config.buildScopeMap(importStatements);\n    return new Map<string, string>();\n  }\n\n  classifyCall(callNode: Node): { isMethodCall: boolean; methodName: string; objectName?: string } {\n    if (this.config.classifyCall) return this.config.classifyCall(callNode);\n    return { isMethodCall: false, methodName: callNode.text };\n  }\n"
);

fs.writeFileSync(path, content, "utf8");
console.log("Patched");

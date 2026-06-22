const fs = require("fs");
let content = fs.readFileSync("src/parser-core.ts", "utf8");

// replace AstEvent export with import
content = content.replace(
  `export interface AstEvent {
  type: 'file' | 'class' | 'function' | 'call';
  [key: string]: any;
}`,
  `import { AstEvent } from './sink.js';`
);

fs.writeFileSync("src/parser-core.ts", content);

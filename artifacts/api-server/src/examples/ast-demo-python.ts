import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import parseAst from '../lib/ast/ast-worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('Generating dummy Python file to parse...');
  const dummyFile = path.join(__dirname, 'dummy.py');
  await fs.writeFile(
    dummyFile,
    `
import os
from sys import path

class MyTestClass:
    def hello(self):
        print("Hello World")

def my_test_function():
    print("Testing")
`,
    'utf-8'
  );

  console.log(`Parsing file: ${dummyFile}`);
  const result = await parseAst(dummyFile);

  if (result.status === 'done' && result.file) {
    console.log(`AST successfully parsed! Output written to: ${result.file}`);
    const output = await fs.readFile(result.file, 'utf-8');
    console.log('\\n--- Parsed JSON Lines ---');
    console.log(output);
    console.log('---------------------------');
  } else {
    console.error('AST parsing failed:', result.reason);
  }

  // Cleanup
  await fs.rm(dummyFile);
}

run().catch(console.error);

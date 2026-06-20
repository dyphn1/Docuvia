import path from 'path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import parseAst from '../lib/ast/ast-worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('Generating dummy Go file to parse...');
  const dummyFile = path.join(__dirname, 'dummy.go');
  await fs.writeFile(
    dummyFile,
    `package main

import (
  "fmt"
  "net/http"
)

type Server struct {
  port int
}

func (s *Server) Start() error {
  return http.ListenAndServe(fmt.Sprintf(":%d", s.port), nil)
}

func helper() {}

func main() {
  s := Server{port: 8080}
  s.Start()
  fmt.Println("started")
}
`,
    'utf-8'
  );

  console.log(`Parsing file: ${dummyFile}`);
  const result = await parseAst(dummyFile);

  if (result.status === 'done' && result.file) {
    console.log(`AST successfully parsed! Output written to: ${result.file}`);
    const output = await fs.readFile(result.file, 'utf-8');
    console.log('\n--- Parsed JSON Lines ---');
    console.log(output);
    console.log('---------------------------');
  } else {
    console.error('AST parsing failed:', result.reason);
  }

  // Cleanup
  await fs.rm(dummyFile);
}

run().catch(console.error);

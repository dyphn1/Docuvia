import fs from 'node:fs/promises';
import { AstWorkerPool } from './ast-worker-pool.js';

async function main() {
  const pool = new AstWorkerPool();
  const dummyFiles = Array.from({ length: 10 }, (_, i) => `/dummy/path/file-${i}.ts`);

  console.log('Dispatching 10 dummy files to the pool...');
  const results = await pool.dispatch(dummyFiles);

  console.log(`Generated ${results.length} files:`);
  for (const result of results) {
    const content = await fs.readFile(result.file, 'utf-8');
    console.log(`- ${result.file} (contains dummyFunction: ${content.includes('dummyFunction')})`);
  }
}

main().catch(console.error);

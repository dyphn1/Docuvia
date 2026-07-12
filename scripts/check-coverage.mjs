import { spawnSync } from 'child_process';

// Filter files to only include source files (not configs, not tests)
const files = process.argv.slice(2).filter(f => {
  return (f.includes('/src/') || f.includes('\\src\\')) && 
         !f.includes('.test.') && 
         !f.includes('.spec.');
});

if (files.length === 0) process.exit(0);

const args = [
  'vitest',
  'related',
  ...files,
  '--run',
  '--coverage.enabled=true',
  '--passWithNoTests=false'
];

for (const file of files) {
  args.push('--coverage.include', file);
}

const result = spawnSync('npx', args, { stdio: 'inherit', shell: true });
if (result.status !== 0) {
  process.exit(1);
}

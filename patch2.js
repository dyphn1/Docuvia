const fs = require('fs');
const file = 'artifacts/api-server/src/routes/generate.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /res\.json\(\{ decisions \}\);\n\}\);/s,
  `return res.json({ decisions });\n});`
);
fs.writeFileSync(file, code);

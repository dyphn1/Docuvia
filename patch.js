const fs = require('fs');
const file = 'artifacts/api-server/src/routes/generate.ts';
let code = fs.readFileSync(file, 'utf8');

// fix commitHash lookup
code = code.replace(
  /let commitLinkedNodeIds: number\[\] = \[\];\s*if \(commitHash\) \{\s*const links = await db\.select\(\)\.from\(commitL2LinksTable\)\.where\(eq\(commitL2LinksTable\.commitHash, commitHash\)\);\s*commitLinkedNodeIds = links\.map\(\(l: any\) => l\.l2NodeId\);\s*\}/s,
  `let commitLinkedNodeIds: number[] = [];
  if (commitHash) {
    const [commitRecord] = await db.select().from(commitsTable).where(eq(commitsTable.hash, commitHash));
    if (commitRecord) {
      const links = await db.select().from(commitL2LinksTable).where(eq(commitL2LinksTable.commitId, commitRecord.id));
      commitLinkedNodeIds = links.map((l: any) => l.l2NodeId);
    }
  }`
);

// fix return
code = code.replace(
  /res\.json\(\{ decisions \}\);\s*\n\}\);/s,
  `res.json({ decisions });\n});`
);
fs.writeFileSync(file, code);

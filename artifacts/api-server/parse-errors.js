const fs = require("fs");
const path = require("path");
function walk(dir) {
  fs.readdirSync(dir).forEach((f) => {
    let p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      let content = fs.readFileSync(p, "utf8");
      const lines = content.split("\n");
      lines.forEach((l, i) => {
        if (l.includes("throw new Error(") || l.includes("res.status(")) {
          if (!l.includes("API_MESSAGES") && !l.includes("err.message") && l.includes('"')) {
            console.log(p + ":" + (i + 1) + ": " + l.trim());
          }
        }
      });
    }
  });
}
walk("d:/GitHub/miya.daniel/Docuvia/artifacts/api-server/src/routes");

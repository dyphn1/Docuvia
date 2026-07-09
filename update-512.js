const fs = require("fs");
const file = "d:/GitHub/Docuvia/docs/roadmap/roadmap_checklist.md";
let content = fs.readFileSync(file, "utf8");
content = content.replace(
  "|| 5.1.2 | — | — | 🔵 Pending |",
  "|| 5.1.2 | 2026-06-12 | 0096_5.1.2.md | ✅ PASS |"
);
const lines = content.split(/\r?\n/);
let milestones = [];
let currentMilestone = null;
let trackingStart = false;
let trackingLines = [];
for (const line of lines) {
  if (line.startsWith("## Milestone ")) {
    if (currentMilestone) milestones.push(currentMilestone);
    currentMilestone = { title: line.trim(), items: [] };
  } else if (line.startsWith("## Verification Tracking")) {
    trackingStart = true;
    if (currentMilestone) {
      milestones.push(currentMilestone);
      currentMilestone = null;
    }
  } else if (trackingStart) {
    if (line.startsWith("## Summary")) {
      trackingStart = false;
    } else {
      trackingLines.push(line);
    }
  }
  if (currentMilestone && line.trim().startsWith("-")) {
    currentMilestone.items.push(line.trim());
  }
}
const trackingMap = {};
for (const tl of trackingLines) {
  const match = tl.match(/\|\|\s*([0-9.]+)\s*\|/);
  if (match) {
    const id = match[1].trim();
    const parts = tl.split("|").map((p) => p.trim());
    trackingMap[id] = parts[parts.length - 2];
  }
}
let summaryRows = [];
let totalAll = 0,
  doneAll = 0,
  wipAll = 0,
  todoAll = 0,
  pendingAll = 0;
for (const m of milestones) {
  let done = 0,
    wip = 0,
    todo = 0,
    pending = 0;
  for (const item of m.items) {
    const idMatch = item.match(/-\s*\[([ x])\]\s*([0-9.]+)/);
    if (!idMatch) continue;
    const id = idMatch[2];
    if (item.includes("✅")) done++;
    else if (item.includes("⚠️")) wip++;
    else if (item.includes("❌")) todo++;
    if (trackingMap[id] && trackingMap[id].includes("Pending")) pending++;
  }
  const total = m.items.length;
  const mTitle = m.title.replace("## ", "");
  summaryRows.push(
    "| " +
      mTitle +
      " | " +
      total +
      " | " +
      done +
      " | " +
      wip +
      " | " +
      todo +
      " | " +
      pending +
      " |"
  );
  totalAll += total;
  doneAll += done;
  wipAll += wip;
  todoAll += todo;
  pendingAll += pending;
}
summaryRows.push(
  "| **TOTAL** | **" +
    totalAll +
    "** | **" +
    doneAll +
    "** | **" +
    wipAll +
    "** | **" +
    todoAll +
    "** | **" +
    pendingAll +
    "** |"
);
const summaryHeaderIdx = lines.findIndex((l) => l.trim() === "## Summary");
if (summaryHeaderIdx !== -1) {
  const newContent = lines
    .slice(0, summaryHeaderIdx + 1)
    .concat([
      "",
      "| Category | Total | Done | WIP | Todo | Pending Verification |",
      "|----------|-------|------|-----|------|---------------------|",
      ...summaryRows,
    ])
    .join("\n");
  fs.writeFileSync(file, newContent, "utf8");
  console.log("Success!");
} else {
  console.log("Failed!");
}

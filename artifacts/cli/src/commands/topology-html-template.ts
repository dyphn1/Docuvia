import type { TopologyGraph } from "@workspace/core";

/**
 * Renders the topology graph as a fully self-contained interactive HTML page.
 *
 * Deliberately zero external resources (no CDN scripts, fonts, or styles) so the
 * file works offline — the local-first requirement graphify's CDN-based viewer
 * doesn't meet. The embedded renderer is a small canvas force layout with
 * pan/zoom, search, group hulls, and click-to-inspect blast-radius highlighting.
 */
export function renderTopologyHtml(graph: TopologyGraph): string {
  // <-escape guards against `</script>` sequences inside node labels.
  const dataJson = JSON.stringify(graph).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Docuvia Topology — ${escapeHtml(graph.workspaceRoot)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f1420; color: #dbe2ef; font-family: -apple-system, "Segoe UI", sans-serif; display: flex; height: 100vh; overflow: hidden; }
  #graph { flex: 1; cursor: grab; }
  #graph.dragging { cursor: grabbing; }
  #sidebar { width: 360px; background: #161c2c; border-right: 1px solid #263048; display: flex; flex-direction: column; overflow: hidden; }
  .panel { padding: 12px; border-bottom: 1px solid #263048; }
  .panel h3 { font-size: 12px; color: #8b98b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.06em; }
  #search { width: 100%; background: #0f1420; border: 1px solid #33405f; color: #dbe2ef; padding: 7px 10px; border-radius: 6px; font-size: 13px; outline: none; }
  #search:focus { border-color: #5b8def; }
  #search-results { max-height: 130px; overflow-y: auto; margin-top: 6px; }
  .search-item, .neighbor-item { padding: 4px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search-item:hover, .neighbor-item:hover { background: #263048; }
  #info { font-size: 13px; line-height: 1.65; min-height: 120px; }
  #info .muted { color: #5d6a8a; font-style: italic; }
  #info b { color: #f1f4fb; }
  .kind-badge { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 11px; margin-left: 6px; }
  .kind-file { background: #2a4d7a; } .kind-symbol { background: #3a6b4f; } .kind-decision { background: #8a6d1f; }
  #neighbors { max-height: 150px; overflow-y: auto; margin-top: 4px; }
  #legend { flex: 1; overflow-y: auto; padding: 12px; }
  .legend-item { display: flex; align-items: center; gap: 8px; padding: 4px 2px; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .legend-item:hover { background: #263048; }
  .legend-item.off { opacity: 0.3; }
  .legend-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
  .legend-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-count { color: #5d6a8a; font-size: 11px; }
  #stats { padding: 10px 12px; border-top: 1px solid #263048; font-size: 11px; color: #5d6a8a; }
  #controls { position: absolute; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 10; }
  .btn { background: #161c2c; color: #dbe2ef; border: 1px solid #33405f; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; outline: none; }
  .btn:hover { background: #263048; border-color: #5b8def; }
</style>
</head>
<body>
<div id="controls">
  <button class="btn" id="btn-zoom-in" title="Zoom In">+</button>
  <button class="btn" id="btn-zoom-out" title="Zoom Out">−</button>
  <button class="btn" id="btn-fit" title="Fit View" style="font-weight:normal;font-size:12px;">Fit View</button>
</div>
<div id="sidebar">
  <div class="panel">
    <input id="search" type="text" placeholder="Search nodes..." autocomplete="off">
    <div id="search-results"></div>
  </div>
  <div class="panel">
    <h3>Node Info</h3>
    <div id="info"><span class="muted">Click a node to inspect it. Click again to see its blast radius (upstream dependents).</span></div>
    <div id="neighbors"></div>
  </div>
  <div id="legend"><h3 style="font-size:12px;color:#8b98b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.06em;">Groups</h3><div id="legend-items"></div></div>
  <div id="stats"></div>
</div>
<canvas id="graph"></canvas>
<script>
"use strict";
var GRAPH = ${dataJson};

var PALETTE = ["#4E79A7","#F28E2B","#E15759","#76B7B2","#59A14F","#EDC948","#B07AA1","#FF9DA7","#9C755F","#BAB0AC","#5B8DEF","#8CD17D"];
var DECISION_COLOR = "#E8B931";

var canvas = document.getElementById("graph");
var ctx = canvas.getContext("2d");
var nodes = GRAPH.nodes.map(function (n) { return Object.assign({ x: 0, y: 0, vx: 0, vy: 0 }, n); });
var nodeById = {};
nodes.forEach(function (n) { nodeById[n.id] = n; });
var links = GRAPH.links.filter(function (l) { return nodeById[l.source] && nodeById[l.target]; });
var incoming = {}, outgoing = {};
links.forEach(function (l) {
  (incoming[l.target] = incoming[l.target] || []).push(l);
  (outgoing[l.source] = outgoing[l.source] || []).push(l);
});
var maxDeg = 1;
nodes.forEach(function (n) { if (n.degree > maxDeg) maxDeg = n.degree; });

// Seed positions: groups on a ring, members jittered around their group center.
var groupCenters = {};
var R = 160 * Math.sqrt(Math.max(GRAPH.groups.length, 1));
GRAPH.groups.forEach(function (g, i) {
  var a = (2 * Math.PI * i) / Math.max(GRAPH.groups.length, 1);
  groupCenters[g.id] = { x: R * Math.cos(a), y: R * Math.sin(a) };
});
nodes.forEach(function (n, i) {
  var c = groupCenters[n.group] || { x: 0, y: 0 };
  var a = i * 2.399963;
  var r = 20 + 90 * Math.sqrt((i % 97) / 97);
  n.x = c.x + r * Math.cos(a);
  n.y = c.y + r * Math.sin(a);
});

// Force simulation: repulsion + link springs + group gravity, fixed tick budget.
var ticksLeft = 300;
function tick() {
  var i, j, n, m, dx, dy, d2, d, f;
  for (i = 0; i < nodes.length; i++) {
    n = nodes[i];
    for (j = i + 1; j < nodes.length; j++) {
      m = nodes[j];
      dx = n.x - m.x; dy = n.y - m.y;
      d2 = dx * dx + dy * dy;
      if (d2 > 60000 || d2 === 0) continue;
      f = 3000 / d2;
      dx *= f; dy *= f;
      n.vx += dx; n.vy += dy; m.vx -= dx; m.vy -= dy;
    }
  }
  links.forEach(function (l) {
    var a = nodeById[l.source], b = nodeById[l.target];
    var ddx = b.x - a.x, ddy = b.y - a.y;
    var dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    var rest = l.linkType === "contains" || l.linkType === "decision" ? 60 : 140;
    var s = 0.06 * (dist - rest) / dist;
    ddx *= s; ddy *= s;
    a.vx += ddx; a.vy += ddy; b.vx -= ddx; b.vy -= ddy;
  });
  nodes.forEach(function (p) {
    var c = groupCenters[p.group] || { x: 0, y: 0 };
    p.vx += (c.x - p.x) * 0.015 + (0 - p.x) * 0.002;
    p.vy += (c.y - p.y) * 0.015 + (0 - p.y) * 0.002;
    p.vx *= 0.8; p.vy *= 0.8;
    p.x += p.vx; p.y += p.vy;
  });
}

// View transform
var scale = 1, ox = 0, oy = 0;
function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  draw();
}
function fitView() {
  var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  nodes.forEach(function (n) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
  });
  var w = canvas.clientWidth, h = canvas.clientHeight;
  scale = Math.min(w / (maxX - minX + 200), h / (maxY - minY + 200), 2);
  ox = w / 2 - scale * (minX + maxX) / 2;
  oy = h / 2 - scale * (minY + maxY) / 2;
}

var selected = null, hiddenGroups = {}, blast = null;

function computeBlast(id) {
  var seen = {}; seen[id] = 0;
  var frontier = [id], depth = 0;
  while (frontier.length && depth < 3) {
    var next = [];
    frontier.forEach(function (nid) {
      (incoming[nid] || []).forEach(function (l) {
        if (!(l.source in seen)) { seen[l.source] = depth + 1; next.push(l.source); }
      });
    });
    frontier = next; depth++;
  }
  return seen;
}

function nodeRadius(n) {
  var base = n.kind === "decision" ? 6 : 6 + 14 * Math.sqrt(n.degree / maxDeg);
  return base;
}
function nodeColor(n) {
  if (n.kind === "decision") return DECISION_COLOR;
  return PALETTE[n.group % PALETTE.length];
}

function convexHull(pts) {
  if (pts.length < 3) return pts;
  pts = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
  var cross = function (o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); };
  var lower = [], upper = [], k;
  for (k = 0; k < pts.length; k++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[k]) <= 0) lower.pop();
    lower.push(pts[k]);
  }
  for (k = pts.length - 1; k >= 0; k--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[k]) <= 0) upper.pop();
    upper.push(pts[k]);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function draw() {
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.setTransform(devicePixelRatio * scale, 0, 0, devicePixelRatio * scale, devicePixelRatio * ox, devicePixelRatio * oy);

  // Group hulls (layer containers)
  GRAPH.groups.forEach(function (g) {
    if (hiddenGroups[g.id]) return;
    var pts = nodes.filter(function (n) { return n.group === g.id; });
    if (pts.length < 2) return;
    var hull = convexHull(pts);
    var cx = 0, cy = 0;
    hull.forEach(function (p) { cx += p.x; cy += p.y; });
    cx /= hull.length; cy /= hull.length;
    var color = PALETTE[g.id % PALETTE.length];
    ctx.beginPath();
    hull.forEach(function (p, idx) {
      var ex = cx + (p.x - cx) * 1.25, ey = cy + (p.y - cy) * 1.25;
      if (idx === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
    });
    ctx.closePath();
    ctx.globalAlpha = 0.07; ctx.fillStyle = color; ctx.fill();
    ctx.globalAlpha = 0.3; ctx.strokeStyle = color; ctx.lineWidth = 1.5 / scale; ctx.stroke();
    ctx.globalAlpha = 0.75; ctx.fillStyle = color;
    ctx.font = "bold " + (13 / scale) + "px sans-serif";
    ctx.fillText(g.label, cx, cy - (10 / scale));
    ctx.globalAlpha = 1;
  });

  // Edges
  links.forEach(function (l) {
    var a = nodeById[l.source], b = nodeById[l.target];
    if (hiddenGroups[a.group] || hiddenGroups[b.group]) return;
    var inBlast = blast && l.target in blast && l.source in blast;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (blast && !inBlast) { ctx.globalAlpha = 0.04; }
    else if (l.linkType === "contains") { ctx.globalAlpha = 0.10; }
    else if (l.linkType === "decision") { ctx.globalAlpha = 0.5; ctx.setLineDash([4 / scale, 3 / scale]); }
    else { ctx.globalAlpha = inBlast ? 0.9 : 0.35; }
    ctx.strokeStyle = inBlast ? "#ff6b6b" : (l.linkType === "decision" ? DECISION_COLOR : "#8b98b8");
    ctx.lineWidth = (inBlast ? 2 : 1) / scale;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  });

  // Nodes
  nodes.forEach(function (n) {
    if (hiddenGroups[n.group]) return;
    var r = nodeRadius(n);
    var dimmed = blast && !(n.id in blast);
    ctx.globalAlpha = dimmed ? 0.12 : 1;
    ctx.fillStyle = nodeColor(n);
    if (n.kind === "decision") {
      ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx.fill();
      if (n.kind === "file") {
        ctx.strokeStyle = "#f1f4fb"; ctx.lineWidth = 1 / scale;
        ctx.stroke();
      }
    }
    if (selected && n.id === selected.id) {
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5 / scale;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / scale, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  // Labels: high-degree nodes, the selection, and blast members when zoomed in.
  ctx.fillStyle = "#dbe2ef";
  ctx.font = (11 / scale) + "px sans-serif";
  nodes.forEach(function (n) {
    if (hiddenGroups[n.group]) return;
    var show = n.degree >= maxDeg * 0.3 || (selected && n.id === selected.id) || (blast && n.id in blast && scale > 0.7);
    if (!show) return;
    if (blast && !(n.id in blast)) return;
    ctx.fillText(n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label, n.x + nodeRadius(n) + 3 / scale, n.y + 4 / scale);
  });
}

// Interaction: pan / zoom / click
var dragging = false, moved = false, lastX = 0, lastY = 0;
canvas.addEventListener("mousedown", function (e) { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; canvas.classList.add("dragging"); });
window.addEventListener("mousemove", function (e) {
  if (!dragging) return;
  var dx = e.clientX - lastX, dy = e.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
  ox += dx; oy += dy; lastX = e.clientX; lastY = e.clientY;
  draw();
});
window.addEventListener("mouseup", function (e) {
  canvas.classList.remove("dragging");
  if (dragging && !moved) handleClick(e);
  dragging = false;
});
canvas.addEventListener("wheel", function (e) {
  e.preventDefault();
  var f = Math.exp(-e.deltaY * 0.0012);
  var wx = (e.offsetX - ox) / scale, wy = (e.offsetY - oy) / scale;
  scale = Math.min(Math.max(scale * f, 0.03), 10);
  ox = e.offsetX - wx * scale; oy = e.offsetY - wy * scale;
  draw();
}, { passive: false });

document.getElementById("btn-zoom-in").addEventListener("click", function() {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  var wx = (w / 2 - ox) / scale, wy = (h / 2 - oy) / scale;
  scale = Math.min(scale * 1.4, 10);
  ox = w / 2 - wx * scale; oy = h / 2 - wy * scale;
  draw();
});
document.getElementById("btn-zoom-out").addEventListener("click", function() {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  var wx = (w / 2 - ox) / scale, wy = (h / 2 - oy) / scale;
  scale = Math.max(scale / 1.4, 0.03);
  ox = w / 2 - wx * scale; oy = h / 2 - wy * scale;
  draw();
});
document.getElementById("btn-fit").addEventListener("click", function() {
  fitView();
  draw();
});

function handleClick(e) {
  var rect = canvas.getBoundingClientRect();
  var wx = (e.clientX - rect.left - ox) / scale, wy = (e.clientY - rect.top - oy) / scale;
  var best = null, bestD = 12 / scale + 6;
  nodes.forEach(function (n) {
    if (hiddenGroups[n.group]) return;
    var d = Math.hypot(n.x - wx, n.y - wy);
    if (d < bestD + nodeRadius(n)) { best = n; bestD = d; }
  });
  if (!best) { selected = null; blast = null; renderInfo(); draw(); return; }
  if (selected && selected.id === best.id) {
    blast = blast ? null : computeBlast(best.id);
  } else {
    selected = best; blast = null;
  }
  renderInfo();
  draw();
}

function selectNode(id) {
  selected = nodeById[id]; blast = null;
  ox = canvas.clientWidth / 2 - selected.x * scale;
  oy = canvas.clientHeight / 2 - selected.y * scale;
  renderInfo();
  draw();
}

function renderInfo() {
  var info = document.getElementById("info");
  var nb = document.getElementById("neighbors");
  nb.textContent = "";
  if (!selected) {
    info.innerHTML = '<span class="muted">Click a node to inspect it. Click again to see its blast radius (upstream dependents).</span>';
    return;
  }
  var n = selected;
  info.textContent = "";
  var title = document.createElement("div");
  var bold = document.createElement("b"); bold.textContent = n.label;
  var badge = document.createElement("span"); badge.className = "kind-badge kind-" + n.kind; badge.textContent = n.kind;
  title.appendChild(bold); title.appendChild(badge);
  info.appendChild(title);
  var addField = function (k, v) {
    if (!v) return;
    var d = document.createElement("div");
    d.textContent = k + ": " + v;
    info.appendChild(d);
  };
  addField("file", n.filePath);
  addField("group", (GRAPH.groups[n.group] || {}).label);
  addField("degree", String(n.degree));
  addField("tags", (n.tags || []).join(", "));
  if (blast) {
    var count = Object.keys(blast).length - 1;
    var d = document.createElement("div");
    d.innerHTML = "<b>blast radius: " + count + " upstream node" + (count === 1 ? "" : "s") + "</b>";
    info.appendChild(d);
  }
  var neigh = {};
  (incoming[n.id] || []).forEach(function (l) { neigh[l.source] = "in:" + l.linkType; });
  (outgoing[n.id] || []).forEach(function (l) { neigh[l.target] = "out:" + l.linkType; });
  Object.keys(neigh).slice(0, 25).forEach(function (id) {
    var m = nodeById[id];
    var item = document.createElement("div");
    item.className = "neighbor-item";
    item.textContent = neigh[id] + " — " + m.label;
    item.addEventListener("click", function () { selectNode(id); });
    nb.appendChild(item);
  });
}

// Search
var searchInput = document.getElementById("search");
var searchResults = document.getElementById("search-results");
searchInput.addEventListener("input", function () {
  var q = searchInput.value.trim().toLowerCase();
  searchResults.textContent = "";
  if (!q) return;
  nodes.filter(function (n) { return n.label.toLowerCase().indexOf(q) >= 0; })
    .slice(0, 20)
    .forEach(function (n) {
      var item = document.createElement("div");
      item.className = "search-item";
      item.textContent = n.label + " (" + n.kind + ")";
      item.addEventListener("click", function () { selectNode(n.id); });
      searchResults.appendChild(item);
    });
});

// Legend
var legendItems = document.getElementById("legend-items");
GRAPH.groups.forEach(function (g) {
  var item = document.createElement("div");
  item.className = "legend-item";
  var dot = document.createElement("span");
  dot.className = "legend-dot";
  dot.style.background = PALETTE[g.id % PALETTE.length];
  var label = document.createElement("span");
  label.className = "legend-label";
  label.textContent = g.label;
  var count = document.createElement("span");
  count.className = "legend-count";
  count.textContent = String(g.count);
  item.appendChild(dot); item.appendChild(label); item.appendChild(count);
  item.addEventListener("click", function () {
    hiddenGroups[g.id] = !hiddenGroups[g.id];
    item.classList.toggle("off", !!hiddenGroups[g.id]);
    draw();
  });
  legendItems.appendChild(item);
});

document.getElementById("stats").textContent =
  GRAPH.stats.nodeCount + " nodes · " + GRAPH.stats.linkCount + " links · " +
  GRAPH.stats.groupCount + " groups" + (GRAPH.collapsed ? " · collapsed to file level" : "") +
  " · generated " + GRAPH.generatedAt.slice(0, 19).replace("T", " ");

window.addEventListener("resize", resize);
resize();
function loop() {
  if (ticksLeft > 0) {
    for (var i = 0; i < 4 && ticksLeft > 0; i++) { tick(); ticksLeft--; }
    if (ticksLeft === 260) fitView();
    draw();
    requestAnimationFrame(loop);
  } else {
    fitView();
    draw();
  }
}
loop();
</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

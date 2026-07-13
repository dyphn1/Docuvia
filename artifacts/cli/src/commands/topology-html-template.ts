import type { TopologyGraph } from "@workspace/contracts";

/**
 * Renders the topology graph as a self-contained interactive HTML page - ported near-verbatim
 * from old Docuvia's topology-html-template.ts (pure presentation, only consumes the
 * TopologyGraph type). Deliberately zero external resources (no CDN scripts/fonts/styles) so
 * the file works offline. The embedded renderer is a small canvas force layout with pan/zoom,
 * search, group hulls, and click-to-inspect blast-radius highlighting.
 */
export function renderTopologyHtml(graph: TopologyGraph): string {
  const dataJson = JSON.stringify(graph).replace(
    /</g,
    String.fromCharCode(92) + "u003c",
  );
  const NL = String.fromCharCode(10);
  const parts: string[] = [];
  parts.push(renderHead(graph));
  parts.push(renderBody());
  parts.push(renderScript(dataJson));
  parts.push("</body>");
  parts.push("</html>");
  return parts.join(NL) + NL;
}

function renderHead(graph: TopologyGraph): string {
  const lines: string[] = [];
  lines.push("<!DOCTYPE html>");
  lines.push('<html lang="en">');
  lines.push("<head>");
  lines.push('<meta charset="UTF-8">');
  lines.push(
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
  );
  lines.push(
    "<title>Docuvia Topology - " + escapeHtml(graph.workspaceRoot) + "</title>",
  );
  lines.push("<style>");
  lines.push("* { box-sizing: border-box; margin: 0; padding: 0; }");
  lines.push(
    "body { background: #0f1420; color: #dbe2ef; font-family: sans-serif; display: flex; height: 100vh; overflow: hidden; }",
  );
  lines.push("#graph { flex: 1; cursor: grab; }");
  lines.push("#graph.dragging { cursor: grabbing; }");
  lines.push(
    "#sidebar { width: 360px; background: #161c2c; border-right: 1px solid #263048; display: flex; flex-direction: column; overflow: hidden; }",
  );
  lines.push(".panel { padding: 12px; border-bottom: 1px solid #263048; }");
  lines.push(
    ".panel h3 { font-size: 12px; color: #8b98b8; margin-bottom: 8px; text-transform: uppercase; }",
  );
  lines.push(
    "#search { width: 100%; background: #0f1420; border: 1px solid #33405f; color: #dbe2ef; padding: 7px 10px; border-radius: 6px; font-size: 13px; outline: none; }",
  );
  lines.push(
    "#search-results { max-height: 130px; overflow-y: auto; margin-top: 6px; }",
  );
  lines.push(
    ".search-item, .neighbor-item { padding: 4px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  );
  lines.push(
    ".search-item:hover, .neighbor-item:hover { background: #263048; }",
  );
  lines.push(
    "#info { font-size: 13px; line-height: 1.65; min-height: 120px; }",
  );
  lines.push("#info .muted { color: #5d6a8a; font-style: italic; }");
  lines.push("#info b { color: #f1f4fb; }");
  lines.push(
    ".kind-badge { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 11px; margin-left: 6px; }",
  );
  lines.push(
    ".kind-file { background: #2a4d7a; } .kind-symbol { background: #3a6b4f; } .kind-decision { background: #8a6d1f; }",
  );
  lines.push(
    "#neighbors { max-height: 150px; overflow-y: auto; margin-top: 4px; }",
  );
  lines.push("#legend { flex: 1; overflow-y: auto; padding: 12px; }");
  lines.push(
    ".legend-item { display: flex; align-items: center; gap: 8px; padding: 4px 2px; cursor: pointer; border-radius: 4px; font-size: 12px; }",
  );
  lines.push(".legend-item:hover { background: #263048; }");
  lines.push(".legend-item.off { opacity: 0.3; }");
  lines.push(
    ".legend-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }",
  );
  lines.push(
    ".legend-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  );
  lines.push(".legend-count { color: #5d6a8a; font-size: 11px; }");
  lines.push(
    "#stats { padding: 10px 12px; border-top: 1px solid #263048; font-size: 11px; color: #5d6a8a; }",
  );
  lines.push(
    "#controls { position: absolute; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 10; }",
  );
  lines.push(
    ".btn { background: #161c2c; color: #dbe2ef; border: 1px solid #33405f; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; outline: none; }",
  );
  lines.push(".btn:hover { background: #263048; border-color: #5b8def; }");
  lines.push("</style>");
  lines.push("</head>");
  return lines.join(String.fromCharCode(10));
}

function renderBody(): string {
  const lines: string[] = [];
  lines.push("<body>");
  lines.push('<div id="controls">');
  lines.push('<button class="btn" id="btn-zoom-in" title="Zoom In">+</button>');
  lines.push(
    '<button class="btn" id="btn-zoom-out" title="Zoom Out">-</button>',
  );
  lines.push(
    '<button class="btn" id="btn-fit" title="Fit View">Fit View</button>',
  );
  lines.push("</div>");
  lines.push('<div id="sidebar">');
  lines.push('<div class="panel">');
  lines.push(
    '<input id="search" type="text" placeholder="Search nodes..." autocomplete="off">',
  );
  lines.push('<div id="search-results"></div>');
  lines.push("</div>");
  lines.push('<div class="panel">');
  lines.push("<h3>Node Info</h3>");
  lines.push('<div id="info"></div>');
  lines.push('<div id="neighbors"></div>');
  lines.push("</div>");
  lines.push(
    '<div id="legend"><h3>Groups</h3><div id="legend-items"></div></div>',
  );
  lines.push('<div id="stats"></div>');
  lines.push("</div>");
  lines.push('<canvas id="graph"></canvas>');
  return lines.join(String.fromCharCode(10));
}

function renderScript(dataJson: string): string {
  const NL = String.fromCharCode(10);
  return [
    "<script>",
    scriptSetup(dataJson),
    scriptSimulation(),
    scriptDraw(),
    scriptInteraction(),
    scriptPanels(),
    scriptBoot(),
    "</script>",
  ].join(NL);
}

function scriptSetup(dataJson: string): string {
  const lines: string[] = [];
  lines.push('"use strict";');
  lines.push("var GRAPH = " + dataJson + ";");
  lines.push(
    'var PALETTE = ["#4E79A7","#F28E2B","#E15759","#76B7B2","#59A14F","#EDC948","#B07AA1","#FF9DA7","#9C755F","#BAB0AC","#5B8DEF","#8CD17D"];',
  );
  lines.push('var DECISION_COLOR = "#E8B931";');
  lines.push('var canvas = document.getElementById("graph");');
  lines.push('var ctx = canvas.getContext("2d");');
  lines.push(
    "var nodes = GRAPH.nodes.map(function (n) { return Object.assign({ x: 0, y: 0, vx: 0, vy: 0 }, n); });",
  );
  lines.push("var nodeById = {};");
  lines.push("nodes.forEach(function (n) { nodeById[n.id] = n; });");
  lines.push(
    "var links = GRAPH.links.filter(function (l) { return nodeById[l.source] && nodeById[l.target]; });",
  );
  lines.push("var incoming = {}, outgoing = {};");
  lines.push("links.forEach(function (l) {");
  lines.push("  (incoming[l.target] = incoming[l.target] || []).push(l);");
  lines.push("  (outgoing[l.source] = outgoing[l.source] || []).push(l);");
  lines.push("});");
  lines.push("var maxDeg = 1;");
  lines.push(
    "nodes.forEach(function (n) { if (n.degree > maxDeg) maxDeg = n.degree; });",
  );
  lines.push("var groupCenters = {};");
  lines.push("var R = 160 * Math.sqrt(Math.max(GRAPH.groups.length, 1));");
  lines.push("GRAPH.groups.forEach(function (g, i) {");
  lines.push("  var a = (2 * Math.PI * i) / Math.max(GRAPH.groups.length, 1);");
  lines.push(
    "  groupCenters[g.id] = { x: R * Math.cos(a), y: R * Math.sin(a) };",
  );
  lines.push("});");
  lines.push("nodes.forEach(function (n, i) {");
  lines.push("  var c = groupCenters[n.group] || { x: 0, y: 0 };");
  lines.push("  var a = i * 2.399963;");
  lines.push("  var r = 20 + 90 * Math.sqrt((i % 97) / 97);");
  lines.push("  n.x = c.x + r * Math.cos(a);");
  lines.push("  n.y = c.y + r * Math.sin(a);");
  lines.push("});");
  return lines.join(String.fromCharCode(10));
}

function scriptSimulation(): string {
  const lines: string[] = [];
  lines.push("var ticksLeft = 300;");
  lines.push("function tick() {");
  lines.push("  var i, j, n, m, dx, dy, d2, f;");
  lines.push("  for (i = 0; i < nodes.length; i++) {");
  lines.push("    n = nodes[i];");
  lines.push("    for (j = i + 1; j < nodes.length; j++) {");
  lines.push("      m = nodes[j];");
  lines.push("      dx = n.x - m.x; dy = n.y - m.y;");
  lines.push("      d2 = dx * dx + dy * dy;");
  lines.push("      if (d2 > 60000 || d2 === 0) continue;");
  lines.push("      f = 3000 / d2;");
  lines.push("      dx *= f; dy *= f;");
  lines.push("      n.vx += dx; n.vy += dy; m.vx -= dx; m.vy -= dy;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  links.forEach(function (l) {");
  lines.push("    var a = nodeById[l.source], b = nodeById[l.target];");
  lines.push("    var ddx = b.x - a.x, ddy = b.y - a.y;");
  lines.push("    var dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;");
  lines.push(
    '    var rest = l.linkType === "contains" || l.linkType === "decision" ? 60 : 140;',
  );
  lines.push("    var s = 0.06 * (dist - rest) / dist;");
  lines.push("    ddx *= s; ddy *= s;");
  lines.push("    a.vx += ddx; a.vy += ddy; b.vx -= ddx; b.vy -= ddy;");
  lines.push("  });");
  lines.push("  nodes.forEach(function (p) {");
  lines.push("    var c = groupCenters[p.group] || { x: 0, y: 0 };");
  lines.push("    p.vx += (c.x - p.x) * 0.015 + (0 - p.x) * 0.002;");
  lines.push("    p.vy += (c.y - p.y) * 0.015 + (0 - p.y) * 0.002;");
  lines.push("    p.vx *= 0.8; p.vy *= 0.8;");
  lines.push("    p.x += p.vx; p.y += p.vy;");
  lines.push("  });");
  lines.push("}");
  lines.push("var scale = 1, ox = 0, oy = 0;");
  lines.push("function resize() {");
  lines.push("  canvas.width = canvas.clientWidth * devicePixelRatio;");
  lines.push("  canvas.height = canvas.clientHeight * devicePixelRatio;");
  lines.push("  draw();");
  lines.push("}");
  lines.push("function fitView() {");
  lines.push("  var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;");
  lines.push("  nodes.forEach(function (n) {");
  lines.push("    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;");
  lines.push("    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;");
  lines.push("  });");
  lines.push("  var w = canvas.clientWidth, h = canvas.clientHeight;");
  lines.push(
    "  scale = Math.min(w / (maxX - minX + 200), h / (maxY - minY + 200), 2);",
  );
  lines.push("  ox = w / 2 - scale * (minX + maxX) / 2;");
  lines.push("  oy = h / 2 - scale * (minY + maxY) / 2;");
  lines.push("}");
  lines.push("var selected = null, hiddenGroups = {}, blast = null;");
  lines.push("function computeBlast(id) {");
  lines.push("  var seen = {}; seen[id] = 0;");
  lines.push("  var frontier = [id], depth = 0;");
  lines.push("  while (frontier.length && depth < 3) {");
  lines.push("    var next = [];");
  lines.push("    frontier.forEach(function (nid) {");
  lines.push("      (incoming[nid] || []).forEach(function (l) {");
  lines.push(
    "        if (!(l.source in seen)) { seen[l.source] = depth + 1; next.push(l.source); }",
  );
  lines.push("      });");
  lines.push("    });");
  lines.push("    frontier = next; depth++;");
  lines.push("  }");
  lines.push("  return seen;");
  lines.push("}");
  lines.push("function nodeRadius(n) {");
  lines.push(
    '  return n.kind === "decision" ? 6 : 6 + 14 * Math.sqrt(n.degree / maxDeg);',
  );
  lines.push("}");
  lines.push("function nodeColor(n) {");
  lines.push('  if (n.kind === "decision") return DECISION_COLOR;');
  lines.push("  return PALETTE[n.group % PALETTE.length];");
  lines.push("}");
  lines.push("function convexHull(pts) {");
  lines.push("  if (pts.length < 3) return pts;");
  lines.push(
    "  pts = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });",
  );
  lines.push(
    "  var cross = function (o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); };",
  );
  lines.push("  var lower = [], upper = [], k;");
  lines.push("  for (k = 0; k < pts.length; k++) {");
  lines.push(
    "    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[k]) <= 0) lower.pop();",
  );
  lines.push("    lower.push(pts[k]);");
  lines.push("  }");
  lines.push("  for (k = pts.length - 1; k >= 0; k--) {");
  lines.push(
    "    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[k]) <= 0) upper.pop();",
  );
  lines.push("    upper.push(pts[k]);");
  lines.push("  }");
  lines.push("  lower.pop(); upper.pop();");
  lines.push("  return lower.concat(upper);");
  lines.push("}");
  return lines.join(String.fromCharCode(10));
}

function scriptDraw(): string {
  const lines: string[] = [];
  lines.push("function draw() {");
  lines.push(
    "  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);",
  );
  lines.push("  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);");
  lines.push(
    "  ctx.setTransform(devicePixelRatio * scale, 0, 0, devicePixelRatio * scale, devicePixelRatio * ox, devicePixelRatio * oy);",
  );
  lines.push("  GRAPH.groups.forEach(function (g) {");
  lines.push("    if (hiddenGroups[g.id]) return;");
  lines.push(
    "    var pts = nodes.filter(function (n) { return n.group === g.id; });",
  );
  lines.push("    if (pts.length < 2) return;");
  lines.push("    var hull = convexHull(pts);");
  lines.push("    var cx = 0, cy = 0;");
  lines.push("    hull.forEach(function (p) { cx += p.x; cy += p.y; });");
  lines.push("    cx /= hull.length; cy /= hull.length;");
  lines.push("    var color = PALETTE[g.id % PALETTE.length];");
  lines.push("    ctx.beginPath();");
  lines.push("    hull.forEach(function (p, idx) {");
  lines.push(
    "      var ex = cx + (p.x - cx) * 1.25, ey = cy + (p.y - cy) * 1.25;",
  );
  lines.push(
    "      if (idx === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);",
  );
  lines.push("    });");
  lines.push("    ctx.closePath();");
  lines.push("    ctx.globalAlpha = 0.07; ctx.fillStyle = color; ctx.fill();");
  lines.push(
    "    ctx.globalAlpha = 0.3; ctx.strokeStyle = color; ctx.lineWidth = 1.5 / scale; ctx.stroke();",
  );
  lines.push("    ctx.globalAlpha = 0.75; ctx.fillStyle = color;");
  lines.push('    ctx.font = "bold " + (13 / scale) + "px sans-serif";');
  lines.push("    ctx.fillText(g.label, cx, cy - (10 / scale));");
  lines.push("    ctx.globalAlpha = 1;");
  lines.push("  });");
  lines.push("  links.forEach(function (l) {");
  lines.push("    var a = nodeById[l.source], b = nodeById[l.target];");
  lines.push("    if (hiddenGroups[a.group] || hiddenGroups[b.group]) return;");
  lines.push(
    "    var inBlast = blast && l.target in blast && l.source in blast;",
  );
  lines.push("    ctx.beginPath();");
  lines.push("    ctx.moveTo(a.x, a.y);");
  lines.push("    ctx.lineTo(b.x, b.y);");
  lines.push("    if (blast && !inBlast) { ctx.globalAlpha = 0.04; }");
  lines.push(
    '    else if (l.linkType === "contains") { ctx.globalAlpha = 0.10; }',
  );
  lines.push(
    '    else if (l.linkType === "decision") { ctx.globalAlpha = 0.5; ctx.setLineDash([4 / scale, 3 / scale]); }',
  );
  lines.push("    else { ctx.globalAlpha = inBlast ? 0.9 : 0.35; }");
  lines.push(
    '    ctx.strokeStyle = inBlast ? "#ff6b6b" : (l.linkType === "decision" ? DECISION_COLOR : "#8b98b8");',
  );
  lines.push("    ctx.lineWidth = (inBlast ? 2 : 1) / scale;");
  lines.push("    ctx.stroke();");
  lines.push("    ctx.setLineDash([]);");
  lines.push("    ctx.globalAlpha = 1;");
  lines.push("  });");
  lines.push("  nodes.forEach(function (n) {");
  lines.push("    if (hiddenGroups[n.group]) return;");
  lines.push("    var r = nodeRadius(n);");
  lines.push("    var dimmed = blast && !(n.id in blast);");
  lines.push("    ctx.globalAlpha = dimmed ? 0.12 : 1;");
  lines.push("    ctx.fillStyle = nodeColor(n);");
  lines.push('    if (n.kind === "decision") {');
  lines.push("      ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2);");
  lines.push("    } else {");
  lines.push("      ctx.beginPath();");
  lines.push("      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);");
  lines.push("      ctx.fill();");
  lines.push('      if (n.kind === "file") {');
  lines.push('        ctx.strokeStyle = "#f1f4fb"; ctx.lineWidth = 1 / scale;');
  lines.push("        ctx.stroke();");
  lines.push("      }");
  lines.push("    }");
  lines.push("    if (selected && n.id === selected.id) {");
  lines.push('      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5 / scale;');
  lines.push(
    "      ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / scale, 0, 2 * Math.PI); ctx.stroke();",
  );
  lines.push("    }");
  lines.push("    ctx.globalAlpha = 1;");
  lines.push("  });");
  lines.push('  ctx.fillStyle = "#dbe2ef";');
  lines.push('  ctx.font = (11 / scale) + "px sans-serif";');
  lines.push("  nodes.forEach(function (n) {");
  lines.push("    if (hiddenGroups[n.group]) return;");
  lines.push(
    "    var show = n.degree >= maxDeg * 0.3 || (selected && n.id === selected.id) || (blast && n.id in blast && scale > 0.7);",
  );
  lines.push("    if (!show) return;");
  lines.push("    if (blast && !(n.id in blast)) return;");
  lines.push(
    '    ctx.fillText(n.label.length > 34 ? n.label.slice(0, 33) + "..." : n.label, n.x + nodeRadius(n) + 3 / scale, n.y + 4 / scale);',
  );
  lines.push("  });");
  lines.push("}");
  return lines.join(String.fromCharCode(10));
}

function scriptInteraction(): string {
  const lines: string[] = [];
  lines.push("var dragging = false, moved = false, lastX = 0, lastY = 0;");
  lines.push(
    'canvas.addEventListener("mousedown", function (e) { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; canvas.classList.add("dragging"); });',
  );
  lines.push('window.addEventListener("mousemove", function (e) {');
  lines.push("  if (!dragging) return;");
  lines.push("  var dx = e.clientX - lastX, dy = e.clientY - lastY;");
  lines.push("  if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;");
  lines.push("  ox += dx; oy += dy; lastX = e.clientX; lastY = e.clientY;");
  lines.push("  draw();");
  lines.push("});");
  lines.push('window.addEventListener("mouseup", function (e) {');
  lines.push('  canvas.classList.remove("dragging");');
  lines.push("  if (dragging && !moved) handleClick(e);");
  lines.push("  dragging = false;");
  lines.push("});");
  lines.push('canvas.addEventListener("wheel", function (e) {');
  lines.push("  e.preventDefault();");
  lines.push("  var f = Math.exp(-e.deltaY * 0.0012);");
  lines.push(
    "  var wx = (e.offsetX - ox) / scale, wy = (e.offsetY - oy) / scale;",
  );
  lines.push("  scale = Math.min(Math.max(scale * f, 0.03), 10);");
  lines.push("  ox = e.offsetX - wx * scale; oy = e.offsetY - wy * scale;");
  lines.push("  draw();");
  lines.push("}, { passive: false });");
  lines.push(
    'document.getElementById("btn-zoom-in").addEventListener("click", function() {',
  );
  lines.push("  var w = canvas.clientWidth, h = canvas.clientHeight;");
  lines.push("  var wx = (w / 2 - ox) / scale, wy = (h / 2 - oy) / scale;");
  lines.push("  scale = Math.min(scale * 1.4, 10);");
  lines.push("  ox = w / 2 - wx * scale; oy = h / 2 - wy * scale;");
  lines.push("  draw();");
  lines.push("});");
  lines.push(
    'document.getElementById("btn-zoom-out").addEventListener("click", function() {',
  );
  lines.push("  var w = canvas.clientWidth, h = canvas.clientHeight;");
  lines.push("  var wx = (w / 2 - ox) / scale, wy = (h / 2 - oy) / scale;");
  lines.push("  scale = Math.max(scale / 1.4, 0.03);");
  lines.push("  ox = w / 2 - wx * scale; oy = h / 2 - wy * scale;");
  lines.push("  draw();");
  lines.push("});");
  lines.push(
    'document.getElementById("btn-fit").addEventListener("click", function() { fitView(); draw(); });',
  );
  lines.push("function handleClick(e) {");
  lines.push("  var rect = canvas.getBoundingClientRect();");
  lines.push(
    "  var wx = (e.clientX - rect.left - ox) / scale, wy = (e.clientY - rect.top - oy) / scale;",
  );
  lines.push("  var best = null, bestD = 12 / scale + 6;");
  lines.push("  nodes.forEach(function (n) {");
  lines.push("    if (hiddenGroups[n.group]) return;");
  lines.push("    var d = Math.hypot(n.x - wx, n.y - wy);");
  lines.push("    if (d < bestD + nodeRadius(n)) { best = n; bestD = d; }");
  lines.push("  });");
  lines.push(
    "  if (!best) { selected = null; blast = null; renderInfo(); draw(); return; }",
  );
  lines.push("  if (selected && selected.id === best.id) {");
  lines.push("    blast = blast ? null : computeBlast(best.id);");
  lines.push("  } else {");
  lines.push("    selected = best; blast = null;");
  lines.push("  }");
  lines.push("  renderInfo();");
  lines.push("  draw();");
  lines.push("}");
  lines.push("function selectNode(id) {");
  lines.push("  selected = nodeById[id]; blast = null;");
  lines.push("  ox = canvas.clientWidth / 2 - selected.x * scale;");
  lines.push("  oy = canvas.clientHeight / 2 - selected.y * scale;");
  lines.push("  renderInfo();");
  lines.push("  draw();");
  lines.push("}");
  return lines.join(String.fromCharCode(10));
}

function scriptPanels(): string {
  const lines: string[] = [];
  lines.push("function renderInfo() {");
  lines.push('  var info = document.getElementById("info");');
  lines.push('  var nb = document.getElementById("neighbors");');
  lines.push('  nb.textContent = "";');
  lines.push('  info.textContent = "";');
  lines.push("  if (!selected) {");
  lines.push('    var muted = document.createElement("span");');
  lines.push('    muted.className = "muted";');
  lines.push(
    '    muted.textContent = "Click a node to inspect it. Click again to see its blast radius (upstream dependents).";',
  );
  lines.push("    info.appendChild(muted);");
  lines.push("    return;");
  lines.push("  }");
  lines.push("  var n = selected;");
  lines.push('  var title = document.createElement("div");');
  lines.push(
    '  var bold = document.createElement("b"); bold.textContent = n.label;',
  );
  lines.push(
    '  var badge = document.createElement("span"); badge.className = "kind-badge kind-" + n.kind; badge.textContent = n.kind;',
  );
  lines.push("  title.appendChild(bold); title.appendChild(badge);");
  lines.push("  info.appendChild(title);");
  lines.push("  var addField = function (k, v) {");
  lines.push("    if (!v) return;");
  lines.push('    var d = document.createElement("div");');
  lines.push('    d.textContent = k + ": " + v;');
  lines.push("    info.appendChild(d);");
  lines.push("  };");
  lines.push('  addField("file", n.filePath);');
  lines.push('  addField("group", (GRAPH.groups[n.group] || {}).label);');
  lines.push('  addField("degree", String(n.degree));');
  lines.push('  addField("tags", (n.tags || []).join(", "));');
  lines.push("  if (blast) {");
  lines.push("    var count = Object.keys(blast).length - 1;");
  lines.push('    var d = document.createElement("div");');
  lines.push('    var b = document.createElement("b");');
  lines.push(
    '    b.textContent = "blast radius: " + count + " upstream node" + (count === 1 ? "" : "s");',
  );
  lines.push("    d.appendChild(b);");
  lines.push("    info.appendChild(d);");
  lines.push("  }");
  lines.push("  var neigh = {};");
  lines.push(
    '  (incoming[n.id] || []).forEach(function (l) { neigh[l.source] = "in:" + l.linkType; });',
  );
  lines.push(
    '  (outgoing[n.id] || []).forEach(function (l) { neigh[l.target] = "out:" + l.linkType; });',
  );
  lines.push("  Object.keys(neigh).slice(0, 25).forEach(function (id) {");
  lines.push("    var m = nodeById[id];");
  lines.push('    var item = document.createElement("div");');
  lines.push('    item.className = "neighbor-item";');
  lines.push('    item.textContent = neigh[id] + " - " + m.label;');
  lines.push(
    '    item.addEventListener("click", function () { selectNode(id); });',
  );
  lines.push("    nb.appendChild(item);");
  lines.push("  });");
  lines.push("}");
  lines.push('var searchInput = document.getElementById("search");');
  lines.push('var searchResults = document.getElementById("search-results");');
  lines.push('searchInput.addEventListener("input", function () {');
  lines.push("  var q = searchInput.value.trim().toLowerCase();");
  lines.push('  searchResults.textContent = "";');
  lines.push("  if (!q) return;");
  lines.push(
    "  nodes.filter(function (n) { return n.label.toLowerCase().indexOf(q) >= 0; })",
  );
  lines.push("    .slice(0, 20)");
  lines.push("    .forEach(function (n) {");
  lines.push('      var item = document.createElement("div");');
  lines.push('      item.className = "search-item";');
  lines.push('      item.textContent = n.label + " (" + n.kind + ")";');
  lines.push(
    '      item.addEventListener("click", function () { selectNode(n.id); });',
  );
  lines.push("      searchResults.appendChild(item);");
  lines.push("    });");
  lines.push("});");
  lines.push('var legendItems = document.getElementById("legend-items");');
  lines.push("GRAPH.groups.forEach(function (g) {");
  lines.push('  var item = document.createElement("div");');
  lines.push('  item.className = "legend-item";');
  lines.push('  var dot = document.createElement("span");');
  lines.push('  dot.className = "legend-dot";');
  lines.push("  dot.style.background = PALETTE[g.id % PALETTE.length];");
  lines.push('  var label = document.createElement("span");');
  lines.push('  label.className = "legend-label";');
  lines.push("  label.textContent = g.label;");
  lines.push('  var count = document.createElement("span");');
  lines.push('  count.className = "legend-count";');
  lines.push("  count.textContent = String(g.count);");
  lines.push(
    "  item.appendChild(dot); item.appendChild(label); item.appendChild(count);",
  );
  lines.push('  item.addEventListener("click", function () {');
  lines.push("    hiddenGroups[g.id] = !hiddenGroups[g.id];");
  lines.push('    item.classList.toggle("off", !!hiddenGroups[g.id]);');
  lines.push("    draw();");
  lines.push("  });");
  lines.push("  legendItems.appendChild(item);");
  lines.push("});");
  return lines.join(String.fromCharCode(10));
}

function scriptBoot(): string {
  const lines: string[] = [];
  lines.push('document.getElementById("stats").textContent =');
  lines.push(
    '  GRAPH.stats.nodeCount + " nodes, " + GRAPH.stats.linkCount + " links, " +',
  );
  lines.push(
    '  GRAPH.stats.groupCount + " groups" + (GRAPH.collapsed ? " (collapsed to file level)" : "") +',
  );
  lines.push(
    '  " - generated " + GRAPH.generatedAt.slice(0, 19).replace("T", " ");',
  );
  lines.push('window.addEventListener("resize", resize);');
  lines.push("renderInfo();");
  lines.push("resize();");
  lines.push("function loop() {");
  lines.push("  if (ticksLeft > 0) {");
  lines.push(
    "    for (var i = 0; i < 4 && ticksLeft > 0; i++) { tick(); ticksLeft--; }",
  );
  lines.push("    if (ticksLeft === 260) fitView();");
  lines.push("    draw();");
  lines.push("    requestAnimationFrame(loop);");
  lines.push("  } else {");
  lines.push("    fitView();");
  lines.push("    draw();");
  lines.push("  }");
  lines.push("}");
  lines.push("loop();");
  return lines.join(String.fromCharCode(10));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

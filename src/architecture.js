import "./architecture.css";

const SVG_W = 1060;
const SVG_H = 780;
const NODE_W = 154;
const NODE_H = 54;
const CORNER = 12;

const GROUPS = {
  ui:       { label: "UI Layer",                color: "#38bdf8", bg: "rgba(56,189,248,0.06)" },
  comedy:   { label: "Comedy Agent",            color: "#6ee7b7", bg: "rgba(110,231,183,0.06)" },
  judge:    { label: "Judge Agent",             color: "#f59e0b", bg: "rgba(245,158,11,0.06)" },
  infra:    { label: "Shared Infrastructure",   color: "#818cf8", bg: "rgba(129,140,248,0.06)" },
  external: { label: "Browser / External APIs", color: "#f87171", bg: "rgba(248,113,113,0.06)" },
};

// ── Regions (bounding boxes) ──
const REGIONS = [
  { group: "ui",       x: 20,  y: 20,  w: 1020, h: 140 },
  { group: "comedy",   x: 20,  y: 190, w: 500,  h: 290 },
  { group: "judge",    x: 540, y: 190, w: 500,  h: 150 },
  { group: "infra",    x: 20,  y: 510, w: 1020, h: 120 },
  { group: "external", x: 20,  y: 660, w: 1020, h: 100 },
];

// ── Nodes ──
const NODES = [
  // UI row
  { id: "main-ui",      label: "Main UI Loop",       icon: "\u{1F3AC}", x: 60,  y: 55,  group: "ui",       file: "src/main.js",            desc: "startSet() drives the continuous comedy loop. runOneBit() creates a stream speaker, calls the comedy agent, streams tokens to TTS + UI, then triggers the judge evaluation. Manages pause/resume, audience input queue, mood system, emoji bursts, and critic panel." },
  { id: "stage-hud",    label: "Stage HUD",           icon: "\u{1F3A4}", x: 280, y: 55,  group: "ui",       file: "index.html",             desc: "Live show dashboard: stage state indicator, audience mood bar with percentage fill, laugh feedback text, critic card (score/emotion/advice/heckle status), and 5 quick emoji reaction buttons (love/laugh/smile/groan/bomb)." },
  { id: "emoji-system", label: "Emoji Bursts",        icon: "\u{1F389}", x: 500, y: 55,  group: "ui",       file: "src/main.js",            desc: "triggerSpecificEmojiBurst() creates floating emoji particles from the judge's Emojis field. triggerLaughBurst() uses generic laugh emojis as fallback. Emojis float up with CSS animation and self-remove." },
  { id: "composer",     label: "Audience Input",      icon: "\u{1F4AC}", x: 720, y: 55,  group: "ui",       file: "src/main.js",            desc: "Textarea + send button. User input is queued as pendingAudienceInput and consumed by the next iteration of the set loop. analyzeAudienceTextFeedback() parses sentiment from the text." },

  // Comedy agent cluster
  { id: "comedy-agent", label: "Comedy Agent",        icon: "\u{1F3AD}", x: 60,  y: 235, group: "comedy",   file: "src/agent/index.js",     desc: "Orchestrates the comedy set. Exposes opener(), nextBit(), and defendAgainstHeckle(). Routes between interactive riffing (continue/laugh/bomb/crowd-work) and full plan+render pipeline. Runs autonomous web search when it decides a fact would help." },
  { id: "prompting",    label: "Prompt Builder",      icon: "\u{1F4DD}", x: 300, y: 235, group: "comedy",   file: "src/agent/prompting.js", desc: "All comedy and judge prompt templates. Builds Gemma chat format with <start_of_turn> tokens. inferComedyMode() classifies audience input into 10+ modes. parseComedyPlan() extracts Mode/Premise/Angle/Punch/Callback." },
  { id: "memory",       label: "Audience Memory",     icon: "\u{1F9E0}", x: 60,  y: 375, group: "comedy",   file: "src/agent/memory.js",    desc: "Extracts tone, topic, style, and mode preferences from user messages. Persists profile + history to /api/memory endpoints. buildMemoryContext() returns a compact 4-line summary that fits the small 1024-token context window." },
  { id: "tools",        label: "Web Search Tool",     icon: "\u{1F50D}", x: 300, y: 375, group: "comedy",   file: "src/agent/tools.js",     desc: "DynamicStructuredTool for web_search. Before each planned bit, autonomousToolStep() asks the model if a search would help. If the model outputs ACTION: web_search({...}), the tool fetches results via Vite proxy." },

  // Judge agent cluster
  { id: "judge-agent",  label: "Judge Agent",         icon: "\u{2696}\u{FE0F}",  x: 580, y: 235, group: "judge",    file: "src/agent/feedback.js",  desc: "Evaluates each comedy bit after it finishes. Outputs: Score (0-100), Emotion phrase, Emojis (1-3 specific emojis), Verdict, Reaction type (erupting_laugh to bomb), ShouldHeckle flag, Heckle line, and coaching Advice. Emojis drive the floating burst on screen." },
  { id: "judge-output", label: "Evaluation Output",   icon: "\u{1F4CA}", x: 820, y: 235, group: "judge",    file: "src/agent/feedback.js",  desc: "Parsed evaluation object: { score, emotion, emojis[], verdict, reaction, shouldHeckle, heckle, advice }. Reaction maps to fallback emojis if the model doesn't output valid emoji characters. Score <= 45 with shouldHeckle triggers the heckle recovery flow." },

  // Shared infra row
  { id: "gemma-model",  label: "Gemma 4 \u00B7 WebGPU", icon: "\u{1F9E9}", x: 170, y: 545, group: "infra",    file: "src/agent/model.js",     desc: "LangChainGemmaAdapter wraps MediaPipe LlmInference as a LangChain-compatible model. Both agents share the same engine instance. Auto-recovery: retries twice with increasing delay, then recreates the engine. Streaming via onToken callback." },
  { id: "langchain",    label: "LangChain Core",      icon: "\u{1F517}", x: 450, y: 545, group: "infra",    file: "package.json",           desc: "ChatPromptTemplate for prompt formatting. DynamicStructuredTool for tool definitions. AIMessage for model output wrapping. Lazily imported via dynamic import() after model load to avoid competing with WebGPU initialization." },
  { id: "mediapipe",    label: "MediaPipe WASM",      icon: "\u{2699}\u{FE0F}",  x: 730, y: 545, group: "infra",    file: "package.json",           desc: "@mediapipe/tasks-genai runs Gemma inference entirely client-side via WebGPU. FilesetResolver loads the WASM runtime, LlmInference.createFromOptions() initializes the model from a .task file in public/assets/." },

  // External row
  { id: "tts",          label: "Speech Synthesis",    icon: "\u{1F50A}", x: 60,  y: 690, group: "external", file: "src/tts.js",             desc: "Browser speechSynthesis API wrapper. createStreamSpeaker() queues sentences as they complete during token streaming. Each utterance's 'start' event fires onReveal(visibleText) so the displayed text stays synced with what the audience hears." },
  { id: "web-api",      label: "Vite Search Proxy",   icon: "\u{1F310}", x: 310, y: 690, group: "external", file: "vite.config.js",         desc: "Vite dev server middleware. /api/web-search proxies to DuckDuckGo HTML lite (fallback: Wikipedia API). /api/memory/profile and /api/memory/history read/write local JSON files in memory/ directory." },
  { id: "music",        label: "Ambient Music",       icon: "\u{1F3B5}", x: 560, y: 690, group: "external", file: "src/music.js",           desc: "Web Audio API ambient background loop. Generates gentle oscillator tones. Play/pause toggle and volume slider. Runs independently of the agent pipeline." },
  { id: "session",      label: "Session Storage",     icon: "\u{1F4BE}", x: 810, y: 690, group: "external", file: "src/main.js",            desc: "sessionStorage persists conversation, mood score, audience signals, and critic panel state across page refreshes. Restored conversation is capped at 12 messages. Cleared on explicit 'Clear' button click." },
];

// ── Edges (using anchors: t=top, b=bottom, l=left, r=right) ──
const EDGES = [
  // UI -> Comedy Agent
  { from: "main-ui",      to: "comedy-agent", label: "opener / nextBit / defend", color: "#38bdf8" },
  { from: "main-ui",      to: "judge-agent",  label: "evaluateBit()",             color: "#38bdf8" },
  { from: "composer",     to: "main-ui",      label: "pendingInput",              color: "#38bdf8" },

  // UI internal
  { from: "main-ui",      to: "stage-hud",    label: "mood / state",              color: "#38bdf8" },
  { from: "main-ui",      to: "emoji-system", label: "burst trigger",             color: "#38bdf8" },

  // Comedy internals
  { from: "comedy-agent", to: "prompting",    label: "build prompts",             color: "#6ee7b7" },
  { from: "comedy-agent", to: "memory",       label: "load / save",               color: "#6ee7b7" },
  { from: "comedy-agent", to: "tools",        label: "autonomous search",         color: "#6ee7b7" },

  // Judge internals
  { from: "judge-agent",  to: "judge-output", label: "parse labels",              color: "#f59e0b" },
  { from: "judge-agent",  to: "prompting",    label: "judge prompts",             color: "#f59e0b" },

  // Cross-agent flows
  { from: "judge-output", to: "emoji-system", label: "emojis[]",                  color: "#f59e0b", dashed: true },
  { from: "judge-output", to: "comedy-agent", label: "heckle \u2192 defend",      color: "#f59e0b", dashed: true },
  { from: "judge-output", to: "stage-hud",    label: "score / critic",            color: "#f59e0b", dashed: true },

  // Down to infra
  { from: "comedy-agent", to: "gemma-model",  label: "invoke()",                  color: "#6ee7b7" },
  { from: "judge-agent",  to: "gemma-model",  label: "invoke()",                  color: "#f59e0b" },
  { from: "gemma-model",  to: "langchain",    label: "extends",                   color: "#818cf8" },
  { from: "gemma-model",  to: "mediapipe",    label: "LlmInference",              color: "#818cf8" },

  // Down to external
  { from: "tools",        to: "web-api",      label: "fetch proxy",               color: "#6ee7b7" },
  { from: "memory",       to: "web-api",      label: "/api/memory",               color: "#6ee7b7" },
  { from: "main-ui",      to: "tts",          label: "streamSpeaker",             color: "#38bdf8" },
  { from: "main-ui",      to: "music",        label: "play / pause",              color: "#38bdf8" },
  { from: "main-ui",      to: "session",      label: "save / restore",            color: "#38bdf8" },
];

// ── SVG rendering ──

const container = document.getElementById("diagramContainer");
const detailCard = document.getElementById("detailCard");
const ns = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}) {
  const node = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const svg = el("svg", { viewBox: `0 0 ${SVG_W} ${SVG_H}`, class: "arch-svg" });
const defs = el("defs");

// Glow filter
const glow = el("filter", { id: "glow", x: "-30%", y: "-30%", width: "160%", height: "160%" });
const blur = el("feGaussianBlur", { stdDeviation: "4", result: "blur" });
const merge = el("feMerge");
const mn1 = el("feMergeNode", { in: "blur" });
const mn2 = el("feMergeNode", { in: "SourceGraphic" });
merge.append(mn1, mn2);
glow.append(blur, merge);
defs.appendChild(glow);

// Arrow markers per edge
for (let i = 0; i < EDGES.length; i++) {
  const m = el("marker", {
    id: `arr${i}`, viewBox: "0 0 10 10",
    refX: "9", refY: "5",
    markerWidth: "7", markerHeight: "7",
    orient: "auto-start-reverse",
  });
  m.appendChild(el("path", { d: "M0 1 L9 5 L0 9z", fill: EDGES[i].color, opacity: "0.8" }));
  defs.appendChild(m);
}

// Animated dash for pulse effect
const style = document.createElementNS(ns, "style");
style.textContent = `
  @keyframes dash-flow {
    to { stroke-dashoffset: -20; }
  }
  .edge-pulse {
    animation: dash-flow 1.2s linear infinite;
  }
`;
defs.appendChild(style);

svg.appendChild(defs);

// ── Draw regions ──

for (const r of REGIONS) {
  const g = GROUPS[r.group];
  const rect = el("rect", {
    x: r.x, y: r.y, width: r.w, height: r.h,
    rx: "16", fill: g.bg,
    stroke: g.color, "stroke-width": "1", "stroke-opacity": "0.25",
    "stroke-dasharray": "6 3",
  });
  svg.appendChild(rect);

  const label = el("text", {
    x: r.x + 16, y: r.y + 18,
    fill: g.color, "font-size": "11", "font-weight": "600",
    "font-family": "Inter, system-ui, sans-serif", opacity: "0.7",
  });
  label.textContent = g.label;
  svg.appendChild(label);
}

// ── Draw edges ──

const nodeMap = new Map(NODES.map((n) => [n.id, n]));

function nodeCenter(n) {
  return { cx: n.x + NODE_W / 2, cy: n.y + NODE_H / 2 };
}

function edgePoints(from, to) {
  const a = nodeCenter(from);
  const b = nodeCenter(to);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const angle = Math.atan2(dy, dx);

  // Exit from closest edge point
  const hw = NODE_W / 2 + 2;
  const hh = NODE_H / 2 + 2;

  function clampExit(cx, cy, ang) {
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const sx = cos !== 0 ? hw / Math.abs(cos) : Infinity;
    const sy = sin !== 0 ? hh / Math.abs(sin) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + cos * s, y: cy + sin * s };
  }

  const start = clampExit(a.cx, a.cy, angle);
  const end = clampExit(b.cx, b.cy, angle + Math.PI);

  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

for (let i = 0; i < EDGES.length; i++) {
  const edge = EDGES[i];
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  if (!from || !to) continue;

  const { x1, y1, x2, y2 } = edgePoints(from, to);

  // Curved path
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  // Perpendicular offset for curve — subtle
  const curveAmt = Math.min(len * 0.12, 30);
  const nx = -dy / len * curveAmt;
  const ny = dx / len * curveAmt;
  const cpx = mx + nx;
  const cpy = my + ny;

  const d = `M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`;

  // Shadow path
  const shadow = el("path", {
    d, fill: "none",
    stroke: edge.color, "stroke-width": "4", "stroke-opacity": "0.08",
  });
  svg.appendChild(shadow);

  // Main path
  const path = el("path", {
    d, fill: "none",
    stroke: edge.color, "stroke-width": "1.5", "stroke-opacity": "0.5",
    "marker-end": `url(#arr${i})`,
  });
  if (edge.dashed) {
    path.setAttribute("stroke-dasharray", "8 5");
    path.setAttribute("class", "edge-pulse");
    path.setAttribute("stroke-opacity", "0.65");
  }
  svg.appendChild(path);

  // Edge label with background
  const labelX = cpx;
  const labelY = cpy - 6;

  const textEl = el("text", {
    x: labelX, y: labelY,
    "text-anchor": "middle",
    fill: edge.color, "font-size": "8.5", "font-weight": "500",
    "font-family": "Inter, system-ui, sans-serif", opacity: "0.8",
    class: "edge-label",
  });
  textEl.textContent = edge.label;
  svg.appendChild(textEl);
}

// ── Draw nodes ──

for (const node of NODES) {
  const color = GROUPS[node.group].color;
  const g = el("g", { class: `node node-${node.group}`, "data-id": node.id, style: "cursor:pointer" });

  // Drop shadow rect
  g.appendChild(el("rect", {
    x: node.x + 2, y: node.y + 3, width: NODE_W, height: NODE_H,
    rx: CORNER, fill: "rgba(0,0,0,0.3)", "filter": "url(#glow)",
  }));

  // Main rect
  g.appendChild(el("rect", {
    x: node.x, y: node.y, width: NODE_W, height: NODE_H,
    rx: CORNER,
    fill: "rgba(12, 22, 38, 0.92)",
    stroke: color, "stroke-width": "2",
  }));

  // Icon
  const iconEl = el("text", {
    x: node.x + 18, y: node.y + NODE_H / 2 + 5,
    "text-anchor": "middle",
    "font-size": "16",
  });
  iconEl.textContent = node.icon;
  g.appendChild(iconEl);

  // Label
  const labelEl = el("text", {
    x: node.x + 34, y: node.y + NODE_H / 2 + 4,
    fill: "#eaf2ff", "font-size": "11", "font-weight": "600",
    "font-family": "Inter, system-ui, sans-serif",
    class: "node-label",
  });
  labelEl.textContent = node.label;
  g.appendChild(labelEl);

  // Hover highlight
  g.addEventListener("mouseenter", () => {
    g.querySelector("rect:nth-child(2)").setAttribute("stroke-width", "3");
    g.querySelector("rect:nth-child(2)").setAttribute("filter", "url(#glow)");
  });
  g.addEventListener("mouseleave", () => {
    if (!g.classList.contains("active")) {
      g.querySelector("rect:nth-child(2)").setAttribute("stroke-width", "2");
      g.querySelector("rect:nth-child(2)").removeAttribute("filter");
    }
  });

  g.addEventListener("click", () => showDetail(node));
  svg.appendChild(g);
}

container.appendChild(svg);

// ── Detail panel ──

function showDetail(node) {
  const color = GROUPS[node.group].color;
  detailCard.innerHTML = `
    <div class="detail-header">
      <span class="detail-icon">${node.icon}</span>
      <div>
        <h3 style="color:${color}">${node.label}</h3>
        <p class="detail-file"><code>${node.file}</code></p>
      </div>
    </div>
    <p>${node.desc}</p>
  `;

  for (const g of svg.querySelectorAll(".node")) {
    const isActive = g.dataset.id === node.id;
    g.classList.toggle("active", isActive);
    const mainRect = g.querySelector("rect:nth-child(2)");
    mainRect.setAttribute("stroke-width", isActive ? "3" : "2");
    if (isActive) {
      mainRect.setAttribute("filter", "url(#glow)");
    } else {
      mainRect.removeAttribute("filter");
    }
  }
}

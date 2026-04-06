import "./architecture.css";

// ── Node definitions ──

const NODES = [
  // Comedy Agent cluster
  { id: "comedy-agent", label: "Comedy Agent", x: 140, y: 100, group: "comedy", file: "src/agent/index.js", desc: "Orchestrates the comedy set. Exposes opener(), nextBit(), and defendAgainstHeckle(). Manages the plan+render pipeline, interactive riffing, freestyle autoplay, and autonomous tool decisions." },
  { id: "prompting", label: "Prompting", x: 140, y: 210, group: "comedy", file: "src/agent/prompting.js", desc: "All comedy and judge prompts. Builds Gemma chat format with <start_of_turn> tokens. Includes mode inference (inferComedyMode), plan parsing, and control token stripping." },
  { id: "memory", label: "Memory", x: 140, y: 320, group: "comedy", file: "src/agent/memory.js", desc: "Extracts audience tone, topic, and style preferences from messages. Persists profile + history to /api/memory endpoints. buildMemoryContext() returns a compact summary for the small context window." },
  { id: "tools", label: "Web Search Tool", x: 140, y: 430, group: "comedy", file: "src/agent/tools.js", desc: "DynamicStructuredTool for web_search. The agent autonomously decides whether to search via COMEDY_TOOL_DECISION_PROMPT. Results proxy through Vite server to DuckDuckGo / Wikipedia." },

  // Judge Agent cluster
  { id: "judge-agent", label: "Judge Agent", x: 500, y: 100, group: "judge", file: "src/agent/feedback.js", desc: "Evaluates each comedy bit after it finishes. Outputs Score (0-100), Emotion, Emojis (1-3 specific emojis), Verdict, Reaction type, ShouldHeckle flag, Heckle line, and Advice. Emojis drive the floating burst on screen." },

  // Shared infra
  { id: "gemma-model", label: "Gemma 4 (WebGPU)", x: 320, y: 210, group: "infra", file: "src/agent/model.js", desc: "LangChainGemmaAdapter wraps MediaPipe LlmInference as a LangChain-compatible model. Both agents share the same inference engine. Auto-recovery recreates the engine if it reports busy. Streaming via onToken callback." },
  { id: "langchain", label: "LangChain Core", x: 320, y: 320, group: "infra", file: "package.json", desc: "ChatPromptTemplate for prompt formatting. DynamicStructuredTool for tool definitions. AIMessage for model output wrapping. Lazily imported after model load to avoid competing with WebGPU init." },

  // Browser / external
  { id: "tts", label: "Speech Synthesis", x: 620, y: 320, group: "external", file: "src/tts.js", desc: "Browser speechSynthesis API wrapper. createStreamSpeaker() queues sentences as they complete during streaming. onReveal callback fires on each utterance's start event so the UI text stays synced with audio." },
  { id: "web-search-api", label: "Vite Search Proxy", x: 320, y: 430, group: "external", file: "vite.config.js", desc: "Vite dev server middleware. /api/web-search proxies to DuckDuckGo HTML lite (fallback: Wikipedia). /api/memory/profile and /api/memory/history persist agent memory to local JSON files." },
  { id: "music", label: "Ambient Music", x: 620, y: 430, group: "external", file: "src/music.js", desc: "Web Audio API ambient background loop. Gentle generated tones. Play/pause and volume controls. Runs independently of the agents." },

  // UI
  { id: "main-ui", label: "Main UI Loop", x: 500, y: 210, group: "ui", file: "src/main.js", desc: "startSet() drives the continuous comedy loop. runOneBit() creates a stream speaker, calls the agent, streams tokens to TTS + UI, then triggers the judge evaluation. Manages pause/resume, audience input queue, mood system, emoji bursts, and critic panel." },
  { id: "stage-hud", label: "Stage HUD", x: 680, y: 100, group: "ui", file: "index.html", desc: "Live show dashboard: stage state, audience mood bar, laugh feedback text, critic card (score/emotion/advice/heckle), and quick emoji reaction buttons. Updated after each judge evaluation." },
  { id: "emoji-system", label: "Emoji Burst System", x: 680, y: 210, group: "ui", file: "src/main.js", desc: "triggerSpecificEmojiBurst() and triggerLaughBurst() create floating emoji particles. The judge agent's Emojis field drives which specific emojis appear. Fallback mapping: erupting_laugh \u2192 \ud83d\ude02\ud83d\udd25\ud83d\udc4f, bomb \u2192 \ud83d\udc80\ud83d\udca3, etc." },
];

// ── Edge definitions ──

const EDGES = [
  // Comedy agent internals
  { from: "comedy-agent", to: "prompting", label: "builds prompts", color: "#6ee7b7" },
  { from: "comedy-agent", to: "memory", label: "load/save/context", color: "#6ee7b7" },
  { from: "comedy-agent", to: "tools", label: "autonomous search", color: "#6ee7b7" },
  { from: "comedy-agent", to: "gemma-model", label: "invoke()", color: "#6ee7b7" },

  // Judge agent
  { from: "judge-agent", to: "prompting", label: "judge prompts", color: "#f59e0b" },
  { from: "judge-agent", to: "gemma-model", label: "invoke()", color: "#f59e0b" },

  // Shared infra
  { from: "gemma-model", to: "langchain", label: "extends", color: "#818cf8" },
  { from: "tools", to: "web-search-api", label: "fetch proxy", color: "#818cf8" },
  { from: "memory", to: "web-search-api", label: "/api/memory", color: "#818cf8" },

  // UI connections
  { from: "main-ui", to: "comedy-agent", label: "opener / nextBit / defend", color: "#38bdf8" },
  { from: "main-ui", to: "judge-agent", label: "evaluateBit()", color: "#38bdf8" },
  { from: "main-ui", to: "tts", label: "streamSpeaker", color: "#38bdf8" },
  { from: "main-ui", to: "stage-hud", label: "mood / critic", color: "#38bdf8" },
  { from: "main-ui", to: "emoji-system", label: "judge emojis", color: "#38bdf8" },
  { from: "main-ui", to: "music", label: "play/pause", color: "#38bdf8" },

  // Cross-flows
  { from: "judge-agent", to: "emoji-system", label: "emojis[]", color: "#f59e0b", dashed: true },
  { from: "judge-agent", to: "comedy-agent", label: "heckle \u2192 defend", color: "#f59e0b", dashed: true },
];

// ── Detail descriptions for click ──

const GROUP_COLORS = {
  comedy: "#6ee7b7",
  judge: "#f59e0b",
  infra: "#818cf8",
  external: "#f87171",
  ui: "#38bdf8",
};

const SVG_W = 860;
const SVG_H = 520;
const NODE_W = 140;
const NODE_H = 48;

// ── Build SVG ──

const container = document.getElementById("diagramContainer");
const detailCard = document.getElementById("detailCard");

const ns = "http://www.w3.org/2000/svg";
const svg = document.createElementNS(ns, "svg");
svg.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
svg.setAttribute("class", "arch-svg");

// Arrowhead marker
const defs = document.createElementNS(ns, "defs");

for (const [name, color] of Object.entries(GROUP_COLORS)) {
  const marker = document.createElementNS(ns, "marker");
  marker.setAttribute("id", `arrow-${name}`);
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "10");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("orient", "auto-start-reverse");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  path.setAttribute("fill", color);
  marker.appendChild(path);
  defs.appendChild(marker);
}

// Extra markers for edge colors
for (const edge of EDGES) {
  const id = `arrow-edge-${EDGES.indexOf(edge)}`;
  const marker = document.createElementNS(ns, "marker");
  marker.setAttribute("id", id);
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "10");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("orient", "auto-start-reverse");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  path.setAttribute("fill", edge.color);
  marker.appendChild(path);
  defs.appendChild(marker);
}

svg.appendChild(defs);

// ── Draw edges ──

const nodeMap = new Map(NODES.map((n) => [n.id, n]));

for (let i = 0; i < EDGES.length; i++) {
  const edge = EDGES[i];
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  if (!from || !to) continue;

  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y + NODE_H / 2;

  // Shorten line to stop at node edge
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;
  const sx = x1 + ux * (NODE_H / 2);
  const sy = y1 + uy * (NODE_H / 2);
  const ex = x2 - ux * (NODE_H / 2 + 6);
  const ey = y2 - uy * (NODE_H / 2 + 6);

  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", sx);
  line.setAttribute("y1", sy);
  line.setAttribute("x2", ex);
  line.setAttribute("y2", ey);
  line.setAttribute("stroke", edge.color);
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-opacity", "0.55");
  line.setAttribute("marker-end", `url(#arrow-edge-${i})`);
  if (edge.dashed) {
    line.setAttribute("stroke-dasharray", "6 4");
  }
  svg.appendChild(line);

  // Edge label
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", mx);
  label.setAttribute("y", my - 5);
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("class", "edge-label");
  label.setAttribute("fill", edge.color);
  label.textContent = edge.label;
  svg.appendChild(label);
}

// ── Draw nodes ──

for (const node of NODES) {
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", `node node-${node.group}`);
  g.setAttribute("data-id", node.id);
  g.style.cursor = "pointer";

  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", node.x);
  rect.setAttribute("y", node.y);
  rect.setAttribute("width", NODE_W);
  rect.setAttribute("height", NODE_H);
  rect.setAttribute("rx", 10);
  rect.setAttribute("fill", "rgba(12, 22, 38, 0.9)");
  rect.setAttribute("stroke", GROUP_COLORS[node.group]);
  rect.setAttribute("stroke-width", "2");
  g.appendChild(rect);

  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", node.x + NODE_W / 2);
  text.setAttribute("y", node.y + NODE_H / 2 + 5);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", "#eaf2ff");
  text.setAttribute("class", "node-label");
  text.textContent = node.label;
  g.appendChild(text);

  g.addEventListener("click", () => showDetail(node));

  svg.appendChild(g);
}

container.appendChild(svg);

// ── Detail panel ──

function showDetail(node) {
  const color = GROUP_COLORS[node.group];
  detailCard.innerHTML = `
    <h3 style="color:${color}">${node.label}</h3>
    <p class="detail-file"><code>${node.file}</code></p>
    <p>${node.desc}</p>
  `;

  // Highlight active node
  for (const g of svg.querySelectorAll(".node")) {
    g.classList.toggle("active", g.dataset.id === node.id);
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite";

const MEMORY_DIR = path.resolve(process.cwd(), "memory");
const PROFILE_PATH = path.join(MEMORY_DIR, "profile.json");
const HISTORY_PATH = path.join(MEMORY_DIR, "history.json");

const DEFAULT_PROFILE = {
  audienceProfile: {
    tone: "lighthearted",
    favoriteTopics: [],
    avoidTopics: [],
    styleNotes: ["short paragraph jokes"],
  },
  recentLearnings: [],
  lastUpdated: "",
};

const DEFAULT_HISTORY = {
  entries: [],
  lastUpdated: "",
};

export default defineConfig({
  plugins: [localAgentApiPlugin()],
});

function localAgentApiPlugin() {
  const middleware = createApiMiddleware();

  return {
    name: "local-agent-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function createApiMiddleware() {
  return async (req, res, next) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");

    if (requestUrl.pathname === "/api/memory/profile") {
      await handleMemoryRequest(req, res, PROFILE_PATH, DEFAULT_PROFILE);
      return;
    }

    if (requestUrl.pathname === "/api/memory/history") {
      await handleMemoryRequest(req, res, HISTORY_PATH, DEFAULT_HISTORY);
      return;
    }

    if (requestUrl.pathname === "/api/web-search" && req.method === "GET") {
      await handleWebSearch(requestUrl, res);
      return;
    }

    next();
  };
}

async function handleMemoryRequest(req, res, filePath, fallback) {
  try {
    if (req.method === "GET") {
      const payload = await readJsonFile(filePath, fallback);
      return sendJson(res, 200, payload);
    }

    if (req.method === "POST") {
      const payload = await readJsonBody(req);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return sendJson(res, 400, { error: "Invalid JSON body." });
      }

      await ensureMemoryDir();
      await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleWebSearch(requestUrl, res) {
  try {
    const query = requestUrl.searchParams.get("q")?.trim();
    if (!query) {
      return sendJson(res, 400, { error: "Missing query parameter q." });
    }

    // Try DuckDuckGo HTML lite for real web results
    const ddgResults = await fetchDuckDuckGo(query);
    if (ddgResults.length > 0) {
      return sendJson(res, 200, { results: ddgResults });
    }

    // Fallback to Wikipedia
    const wikiResults = await fetchWikipedia(query);
    return sendJson(res, 200, { results: wikiResults });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function fetchDuckDuckGo(query) {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GemmaAgent/1.0)" },
    });
    if (!response.ok) return [];

    const html = await response.text();
    const results = [];
    const resultRegex = /<a[^>]+class="result__a"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      const title = stripHtml(match[1]).trim();
      const snippet = stripHtml(match[2]).trim();
      if (title && snippet) {
        results.push({ title, snippet });
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function fetchWikipedia(query) {
  const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", query);
  searchUrl.searchParams.set("utf8", "1");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("srlimit", "3");
  searchUrl.searchParams.set("origin", "*");

  const response = await fetch(searchUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  return (payload?.query?.search ?? []).map((entry) => ({
    title: entry.title,
    snippet: stripHtml(entry.snippet),
  }));
}

async function ensureMemoryDir() {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
  }
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

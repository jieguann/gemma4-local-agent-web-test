# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based chat app for local Gemma models using the MediaPipe LLM Inference Web API (`@mediapipe/tasks-genai`). Inference runs entirely client-side via WebGPU — no server-side LLM calls. The model auto-loads on page load from `public/assets/`.

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview production build

No test framework or linter is configured.

## Architecture

Single-page vanilla JS app (no framework).

### Core UI
- `src/main.js` — App entry: model loading, chat UI, streaming display, UI state. LangChain agent modules are **lazily imported** via dynamic `import()` after model load to avoid competing with WebGPU initialization. WASM assets loaded from jsDelivr CDN.
- `src/styles.css` — dark-themed UI with CSS custom properties.
- `index.html` — two-column layout: sidebar (model controls/status) + main chat workspace.

### LangChain Comedy Agent (`src/agent/`)
ReAct-style agent loop running in-browser using `@langchain/core`:
- `index.js` — Agent orchestrator. `createComedyAgent()` runs a scratchpad-based loop (max 3 steps) using `ChatPromptTemplate.fromMessages()`. Parses `ACTION:`/`ANSWER:` text protocol.
- `model.js` — `LangChainGemmaAdapter` wraps MediaPipe's `LlmInference` as a LangChain-compatible model. Handles streaming via `onToken`, auto-recovery when inference engine is busy.
- `prompting.js` — Gemma prompt builder (`buildGemmaPrompt()`), control token stripping, `COMEDY_SYSTEM_PROMPT`, `AGENT_PROTOCOL_PROMPT`.
- `output-parser.js` — Parses raw model output into `{type: "action", toolName, args}` or `{type: "answer"}`.
- `tools.js` — `DynamicStructuredTool` definitions. Currently one tool: `web_search` (proxied through Vite server).
- `memory.js` — File-backed agent memory via `/api/memory/profile` and `/api/memory/history`. Extracts tone/topic/style preferences from user messages.

### Vite Server API (`vite.config.js`)
Custom Vite plugin exposes local API endpoints:
- `GET/POST /api/memory/profile` — audience preference profile (persisted to `memory/profile.json`)
- `GET/POST /api/memory/history` — joke history (persisted to `memory/history.json`)
- `GET /api/web-search?q=...` — Wikipedia search proxy for the agent's `web_search` tool

## Key Patterns

- **Chat prompt format**: Uses Gemma's native `<start_of_turn>user`/`<start_of_turn>model` template. See `buildGemmaPrompt()` in `src/agent/prompting.js`.
- **Control token stripping**: `stripControlTokens()` removes leaked `<start_of_turn>`, `<end_of_turn>`, and variant tokens from model output.
- **Lazy agent imports**: LangChain modules are loaded via dynamic `import()` only after model is ready, to avoid heavy JS parsing competing with WebGPU initialization. Critical for avoiding GPU adapter exhaustion.
- **Streaming updates**: Only the last message's DOM content is updated in-place (`updateLastMessage()`), not the full chat, to avoid flicker.
- **Auto-recovery**: `LangChainGemmaAdapter` recreates the inference engine and retries once if the engine reports it's still busy.
- **Agent text protocol**: The agent uses `ACTION: tool_name({...})` / `ANSWER: ...` text format (not function calling) since MediaPipe models don't support tool-use tokens.
- **Status indicators**: `.facts li` elements use CSS classes (`ok`, `warn`, `error`, `loading`) for colored dot indicators via `setFactStatus()`.

## Model Files

Model files (`.task`, `.litertlm`, `.bin`) live in `public/assets/` and are served at `/assets/` by Vite. These are large binary blobs gitignored via `.gitignore` — they must be downloaded separately (see README). The default model path is `/assets/gemma-4-E2B-it-web.task`.

## Key Constraints

- Requires a Chromium-based browser with WebGPU support.
- ES modules (`"type": "module"` in package.json).
- Generation settings (maxTokens, topK, temperature, seed) are locked while a model is loaded — unload and reload to change them.
- **WebGPU adapter sensitivity**: Never call `navigator.gpu.requestAdapter()` outside MediaPipe's own initialization. Multiple concurrent adapter requests can crash the GPU process. If the adapter fails, a full browser restart (not just page reload) is needed.
- **Small context window**: Gemma E2B has limited context. Keep agent prompts concise — the comedy system prompt + protocol + memory + scratchpad must all fit. Agent history is capped at 2-3 turns.

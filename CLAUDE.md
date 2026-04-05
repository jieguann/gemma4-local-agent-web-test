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
- `src/main.js` — App entry: model loading, chat UI, continuous set loop, TTS integration. LangChain agent modules are **lazily imported** via dynamic `import()` after model load. On startup: TTS preloads → model loads → `startSet()` begins the continuous comedy loop (opener → bit → bit → ...). User can type at any time to steer the next joke. Pause/Resume button controls the set.
- `src/tts.js` — Text-to-speech using the browser's built-in `speechSynthesis` API. Supports streaming speech via `createStreamSpeaker()` which queues sentences as they complete during token streaming.
- `src/styles.css` — dark-themed UI with CSS custom properties.
- `index.html` — two-column layout: sidebar (model controls/status/TTS controls) + main chat workspace.

### LangChain Comedy Agent (`src/agent/`)
Continuous comedy agent running in-browser using `@langchain/core`:
- `index.js` — Agent orchestrator. `createComedyAgent()` exposes `opener()` and `nextBit()`. `nextBit()` is the main autoplay method: if user input is provided it incorporates it (interactive riff or new topic), if not it freestyles. The agent **autonomously decides** whether to web search via `COMEDY_TOOL_DECISION_PROMPT` — it asks the model if a search would help, parses `ACTION: web_search(...)`, executes it, and feeds results into the joke.
- `model.js` — `LangChainGemmaAdapter` wraps MediaPipe's `LlmInference` as a LangChain-compatible model. Handles streaming via `onToken`, auto-recovery when inference engine is busy.
- `prompting.js` — Gemma prompt builder, control token stripping, comedy prompts (`COMEDY_SYSTEM_PROMPT`, `COMEDY_OPENER_PROMPT`, `COMEDY_CONTINUE_PROMPT`, `COMEDY_AUTOPLAY_PROMPT`, `COMEDY_PLANNER_PROMPT`, `COMEDY_RENDER_PROMPT`, `COMEDY_TOOL_DECISION_PROMPT`). `inferComedyMode()` detects interactive modes from audience reactions. All prompts are kept very compact for the small context window.
- `output-parser.js` — Parses raw model output into `{type: "action", toolName, args}` or `{type: "answer"}`.
- `tools.js` — `DynamicStructuredTool` definitions. Currently one tool: `web_search` (proxied through Vite server). The agent calls this autonomously when it decides a fact would improve the bit.
- `memory.js` — File-backed agent memory via `/api/memory/profile` and `/api/memory/history`. Extracts tone/topic/style preferences from user messages. `buildMemoryContext()` returns a compact summary to fit the small context window.

### Vite Server API (`vite.config.js`)
Custom Vite plugin exposes local API endpoints:
- `GET/POST /api/memory/profile` — audience preference profile (persisted to `memory/profile.json`)
- `GET/POST /api/memory/history` — joke history (persisted to `memory/history.json`)
- `GET /api/web-search?q=...` — Wikipedia search proxy for the agent's `web_search` tool

## Key Patterns

- **Chat prompt format**: Uses Gemma's native `<start_of_turn>user`/`<start_of_turn>model` template. See `buildGemmaPrompt()` in `src/agent/prompting.js`.
- **Control token stripping**: `stripControlTokens()` removes leaked `<start_of_turn>`, `<end_of_turn>`, and variant tokens from model output.
- **Lazy agent imports**: LangChain modules are loaded via dynamic `import()` only after model is ready, to avoid heavy JS parsing competing with WebGPU initialization. Critical for avoiding GPU adapter exhaustion.
- **Streaming updates**: Only the last message's DOM content is updated in-place (`updateLastAssistantMessage()`), not the full chat, to avoid flicker.
- **Synced text + TTS**: `createStreamSpeaker()` feeds text to `speechSynthesis` sentence-by-sentence. Text is **not** shown on `onToken` — instead, each sentence is revealed in the UI via `onReveal()` only when its utterance `start` event fires. This keeps the displayed text in sync with what the audience hears (you see the sentence as it's spoken, not before). If TTS is not loaded, text falls back to immediate display.
- **Continuous set loop**: `startSet()` in `main.js` runs opener → nextBit → nextBit → ... in a loop with a 3-second pause between bits. The user can type at any time; their input is queued as `pendingAudienceInput` and consumed by the next iteration. Pause/Resume button controls the loop.
- **Autonomous tool use**: Before each joke, the agent runs `COMEDY_TOOL_DECISION_PROMPT` to decide if a web search would help. If the model outputs `ACTION: web_search(...)`, the tool is executed and results are fed into the joke. No user intervention needed.
- **Interactive comedy modes**: `inferComedyMode()` detects audience reactions (laughs, heckles, short responses, "more") and routes to `COMEDY_CONTINUE_PROMPT` for quick riffing instead of the full plan+render pipeline.
- **Autoplay freestyle**: When no user input is pending, the agent uses `COMEDY_AUTOPLAY_PROMPT` to pick its own topic, transition from the last bit, or build callbacks.
- **Auto-recovery**: `LangChainGemmaAdapter` recreates the inference engine and retries once if the engine reports it's still busy.
- **Status indicators**: `.facts li` elements use CSS classes (`ok`, `warn`, `error`, `loading`) for colored dot indicators via `setFactStatus()`.

## Model Files

Model files (`.task`, `.litertlm`, `.bin`) live in `public/assets/` and are served at `/assets/` by Vite. These are large binary blobs gitignored via `.gitignore` — they must be downloaded separately (see README). The default model path is `/assets/gemma-4-E2B-it-web.task`.

## Key Constraints

- Requires a Chromium-based browser with WebGPU support.
- ES modules (`"type": "module"` in package.json).
- Generation settings (maxTokens, topK, temperature, seed) are locked while a model is loaded — unload and reload to change them.
- **WebGPU adapter sensitivity**: Never call `navigator.gpu.requestAdapter()` outside MediaPipe's own initialization. Multiple concurrent adapter requests can crash the GPU process. If the adapter fails, a full browser restart (not just page reload) is needed.
- **Small context window**: Gemma E2B has limited context. Keep agent prompts concise — the comedy system prompt + protocol + memory + scratchpad must all fit. Agent history is capped at 2-3 turns.

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

Single-page vanilla JS app (no framework). Two source files:

- `src/main.js` — all application logic: model loading, multi-turn chat, streaming inference, UI state management, and markdown-like message formatting. Imports `FilesetResolver` and `LlmInference` from `@mediapipe/tasks-genai`. WASM assets are loaded from the jsDelivr CDN at runtime.
- `src/styles.css` — dark-themed UI with Inter font, CSS custom properties, glassmorphism panels, animated status indicators, and responsive layout.
- `index.html` — two-column layout: left sidebar (model controls/settings/status) and main workspace (chat conversation with composer).

## Key Patterns

- **Chat prompt format**: Uses Gemma's native `<start_of_turn>user`/`<start_of_turn>model` template with `<end_of_turn>` delimiters. See `buildChatPrompt()`.
- **Control token stripping**: `stripControlTokens()` removes leaked `<start_of_turn>`, `<end_of_turn>`, and variant tokens from model output before display.
- **Streaming updates**: During generation, only the last message's DOM content is updated in-place (`updateLastMessage()`), not the full chat via `innerHTML`, to avoid flicker.
- **Message formatting**: `formatMessageText()` converts plain text to structured HTML with paragraphs, headings, bold, and horizontal rules. Applied via `innerHTML` on `.message-body` divs.
- **Auto-recovery**: If the inference engine reports it's still busy from a prior run, the model is automatically recreated and the request retried once (`runInference()` with `allowRecovery`).
- **Status indicators**: `.facts li` elements use CSS classes (`ok`, `warn`, `error`, `loading`) for colored dot indicators. Set via `setFactStatus()`.

## Model Files

Model files (`.task`, `.litertlm`, `.bin`) live in `public/assets/` and are served at `/assets/` by Vite. These are large binary blobs gitignored via `.gitignore` — they must be downloaded separately (see README). The default model path is `/assets/gemma-4-E2B-it-web.task`.

## Key Constraints

- Requires a Chromium-based browser with WebGPU support.
- ES modules (`"type": "module"` in package.json).
- Generation settings (maxTokens, topK, temperature, seed) are locked while a model is loaded — unload and reload to change them.

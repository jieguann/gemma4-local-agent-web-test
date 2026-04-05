# Gemma Comedy Agent

A browser-based interactive comedy agent powered by a local Gemma 4 model. Inference runs entirely client-side via WebGPU using the MediaPipe LLM Inference API — no server-side LLM calls. The agent opens a live comedy set, tells jokes, riffs off audience reactions, and speaks every reply aloud using streaming text-to-speech.

## Quick Start

```bash
npm install
npm run dev
```

Open the printed URL in a Chromium-based browser with WebGPU enabled. The app auto-loads the model, opens a comedy set, and speaks it aloud.

> Model files (`.task`) must be placed in `public/assets/` — they are gitignored. See [Model Files](#model-files) below.

## Agent Framework

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser Tab                           │
│                                                              │
│  ┌─────────┐    ┌──────────────────────────────────────────┐ │
│  │  UI      │    │          Comedy Agent (src/agent/)       │ │
│  │  main.js │───▶│                                          │ │
│  │          │    │  ┌────────┐   ┌──────────┐   ┌────────┐ │ │
│  │          │◀───│  │ Router │──▶│ Planner  │──▶│ Render │ │ │
│  │          │    │  │        │   │(new topic)│   │        │ │ │
│  │          │    │  │infer   │   └──────────┘   └────────┘ │ │
│  │          │    │  │Comedy  │                              │ │
│  │          │    │  │Mode()  │   ┌──────────────────┐      │ │
│  │          │    │  │        │──▶│ Continue (riff)   │      │ │
│  │          │    │  └────────┘   │(interactive modes)│      │ │
│  │          │    │               └──────────────────┘      │ │
│  │          │    │                                          │ │
│  │          │    │  ┌─────────┐  ┌────────┐  ┌──────────┐  │ │
│  │          │    │  │ Memory  │  │ Tools  │  │ Prompting│  │ │
│  │          │    │  │profile +│  │web     │  │Gemma fmt │  │ │
│  │          │    │  │history  │  │search  │  │+ control │  │ │
│  │          │    │  └─────────┘  └────────┘  └──────────┘  │ │
│  │          │    └──────────────────────────────────────────┘ │
│  │          │                                                │
│  │          │    ┌──────────────┐    ┌─────────────────────┐ │
│  │          │───▶│ TTS (tts.js) │    │ MediaPipe LLM       │ │
│  │          │    │ speechSynth  │    │ Inference (WebGPU)   │ │
│  │          │    │ stream speak │    │ gemma-4-E2B-it-web   │ │
│  │          │    └──────────────┘    └─────────────────────┘ │
│  └─────────┘                                                │
└──────────────────────────────────────────────────────────────┘
```

### Lifecycle

1. **Startup** — TTS preloads (browser `speechSynthesis`), then the Gemma model loads via MediaPipe WebGPU.
2. **Auto-opener** — `comedyAgent.opener()` generates an opening bit with no user input. The agent greets the crowd and invites interaction. Speech streams sentence-by-sentence as tokens arrive.
3. **User responds** — `inferComedyMode()` classifies the input:
   - **Interactive mode** (reaction, heckle, "more", short response) → fast `COMEDY_CONTINUE_PROMPT` path, riffs directly off conversation.
   - **New topic** (longer request, specific subject) → full **Plan → Render** pipeline with optional web search.
4. **Speech** — Every reply is spoken aloud via streaming TTS. Completed sentences are queued to `speechSynthesis` immediately while the next tokens are still generating.
5. **Memory** — Audience preferences (tone, topics, callbacks) and joke history are persisted to local JSON files via the Vite dev server API.

### Agent Modules (`src/agent/`)

| File | Role |
|---|---|
| `index.js` | **Orchestrator.** Exposes `opener()` and `run()`. Routes between interactive (riff) and full (plan+render) paths. Manages tool calls and memory saves. |
| `model.js` | **LLM Adapter.** `LangChainGemmaAdapter` wraps MediaPipe's `LlmInference` as a LangChain-compatible model. Streaming via `onToken`, auto-recovery when the engine is busy. |
| `prompting.js` | **Prompt library.** `COMEDY_SYSTEM_PROMPT`, `COMEDY_OPENER_PROMPT`, `COMEDY_CONTINUE_PROMPT`, `COMEDY_PLANNER_PROMPT`, `COMEDY_RENDER_PROMPT`. Also: Gemma `<start_of_turn>` formatting, control token stripping, comedy mode classification, plan parsing. All prompts are kept very compact to fit the small context window. |
| `tools.js` | **Tool definitions.** `web_search` — Wikipedia search proxied through the Vite server. Uses LangChain `DynamicStructuredTool` with Zod schema. |
| `memory.js` | **Audience memory.** Loads/saves profile (tone, energy, edge, favorite topics, avoid topics, callbacks) and joke history to `/api/memory/profile` and `/api/memory/history`. Extracts preferences from natural language. |
| `output-parser.js` | **Action/Answer parser.** Parses `ACTION: tool_name({...})` or `ANSWER: ...` text protocol from model output. Handles malformed JSON gracefully. |

### Comedy Modes

`inferComedyMode()` in `prompting.js` classifies user input into a mode that determines the agent's behavior:

**Interactive modes** (skip plan+render, use `COMEDY_CONTINUE_PROMPT`):

| Mode | Triggers | Behavior |
|---|---|---|
| `continue_bit` | "more", "keep going", "another", "encore" | Continue the current thread with a new angle |
| `build_on_laugh` | "haha", "lol", "that's funny", emojis | Build on what worked — add a tag or callback |
| `recover_from_bomb` | "boo", "not funny", "try again", "meh" | Acknowledge the bomb, pivot playfully |
| `crowd_work` | Questions, short responses (1-4 words) | Riff on what the audience gave you |

**Full pipeline modes** (plan + render):

| Mode | Triggers |
|---|---|
| `observational` | Default for new topics |
| `roast` | "roast", "make fun of" |
| `fake_headline` | "headline", "breaking news" |
| `story_bit` | "story", "anecdote" |
| `one_liner` | "one-liner", "quick joke" |
| `topical_observational` | "today", "trending", "news" |

### Text-to-Speech (`src/tts.js`)

Uses the browser's built-in `speechSynthesis` API — zero download, instant load, fully local.

- **`preload()`** — Enumerates available system voices.
- **`speak(text, options)`** — Speaks a complete text with voice and speed options.
- **`createStreamSpeaker(options)`** — Returns a streaming speaker for use during token generation:
  - `feed(fullText)` — Call on each `onToken`. Detects sentence boundaries (`.`, `!`, `?`) and queues completed sentences immediately.
  - `flush(fullText)` — Call when generation finishes. Speaks any remaining partial sentence.
  - `cancel()` — Stops all queued speech.

### Memory System

The agent maintains two JSON files in `memory/` (gitignored):

**`memory/profile.json`** — Audience preferences learned from conversation:
```json
{
  "audienceProfile": {
    "tone": "lighthearted",
    "energy": "medium",
    "edge": "playful",
    "favoriteTopics": ["programming", "cats"],
    "avoidTopics": ["politics"],
    "styleNotes": ["short paragraph jokes"],
    "preferredModes": ["observational"]
  },
  "recentLearnings": [],
  "callbackBank": ["the punchline about the banana"]
}
```

**`memory/history.json`** — Recent joke history (capped at 10 entries):
```json
{
  "entries": [
    {
      "timestamp": "2026-04-05T12:00:00.000Z",
      "userPrompt": "tell me a joke about JavaScript",
      "assistantReply": "JavaScript walks into a bar..."
    }
  ]
}
```

Preferences are extracted automatically from natural language (e.g. "I like dry humor" updates tone to "dry and deadpan"). The callback bank stores memorable snippets for use in future bits.

### Prompt Architecture

All prompts are aggressively compressed to fit the Gemma E2B context window (1024 tokens total for input + output).

**New topic pipeline** (two LLM calls):
```
Call 1 — Plan:  SYSTEM_PROMPT + PLANNER_PROMPT + topic + mode + memory + facts
                → outputs: Mode / Premise / Angle / Punch / Callback

Call 2 — Render: SYSTEM_PROMPT + RENDER_PROMPT + topic + blueprint + facts
                → outputs: one short paragraph comedy bit
```

**Interactive pipeline** (one LLM call):
```
SYSTEM_PROMPT + CONTINUE_PROMPT + memory + recent conversation + audience input + vibe
→ outputs: one short paragraph riff
```

**Opener** (one LLM call):
```
SYSTEM_PROMPT + OPENER_PROMPT + memory
→ outputs: 2-3 sentence opening bit with audience hook
```

## Model Files

Place Gemma 4 Web `.task` files in `public/assets/`:

| Model | File | Link |
|-------|------|------|
| Gemma 4 E2B | `gemma-4-E2B-it-web.task` | [Hugging Face](https://huggingface.co/litert-community/gemma-4-E2B-it-web) |
| Gemma 4 E4B | `gemma-4-E4B-it-web.task` | [Hugging Face](https://huggingface.co/litert-community/gemma-4-E4B-it-web) |

Place the downloaded file so the path is:

```
public/assets/gemma-4-E2B-it-web.task
```

The app loads this path by default. You can also use the file picker or bundled model dropdown in the UI to load a different model.

## Commands

```bash
npm run dev       # Start Vite dev server
npm run build     # Production build to dist/
npm run preview   # Preview production build
```

## Tech Stack

- **LLM Inference**: [MediaPipe LLM Inference Web API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js) via WebGPU
- **Agent Framework**: [LangChain Core](https://js.langchain.com/) (`ChatPromptTemplate`, `DynamicStructuredTool`)
- **TTS**: Browser `speechSynthesis` API with streaming sentence queue
- **Build**: [Vite](https://vite.dev/) with custom API plugin for memory persistence and web search proxy
- **Schema**: [Zod](https://zod.dev/) for tool input validation

## Constraints

- Requires a **Chromium-based browser** with WebGPU enabled.
- **Text-only** — the bundled `.task` files do not support image input in the current MediaPipe web setup.
- **Small context window** — Gemma E2B has 1024 max tokens (input + output combined). All prompts are kept compact. Conversation history is capped at 4 messages.
- **WebGPU adapter sensitivity** — Never call `navigator.gpu.requestAdapter()` outside MediaPipe's initialization. Multiple concurrent adapter requests can crash the GPU process.
- Generation settings are locked while a model is loaded — unload and reload to change.
- All inference and TTS runs locally in the browser — nothing is sent to an external API (except Wikipedia search for the `web_search` tool).

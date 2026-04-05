# Gemma Comedy Agent

Browser-based comedy booth powered by a local Gemma 4 model. The app runs the set in-browser with MediaPipe WebGPU, keeps lightweight audience memory on disk, and can read bits aloud with browser speech synthesis.

## Quick Start

```bash
npm install
npm run dev
```

Open the local Vite URL in a Chromium-based browser with WebGPU enabled.

Place a Gemma Web model in `public/assets/`:

| Model | File |
|---|---|
| Gemma 4 E2B | `public/assets/gemma-4-E2B-it-web.task` |
| Gemma 4 E4B | `public/assets/gemma-4-E4B-it-web.task` |

## What It Does

- Loads a local Gemma model in the browser with `@mediapipe/tasks-genai`
- Starts an automatic comedy set and lets the audience interrupt with new topics
- Stores audience profile + joke history in local `memory/*.json`
- Uses web search when a bit needs current context
- Speaks finished bits through browser `speechSynthesis`
- Plays a built-in ambient background track with pause and volume controls
- Shows stage feedback in the UI:
  - stage state
  - audience mood meter
  - laugh feedback text
  - floating reaction burst when a punchline lands
  - quick emoji reaction buttons for audience feedback
  - mood shifts based on audience text like "that was funny", "meh", or "more like that"
  - recent audience reactions are passed into the next bit so the comic can react

## Main Files

| File | Role |
|---|---|
| `src/main.js` | Main UI loop, autoplay set flow, laugh feedback, TTS playback, message rendering |
| `src/agent/index.js` | Comedy agent orchestration, bit generation flow, and audience signal injection |
| `src/agent/prompting.js` | Comedy prompts, routing, and Gemma chat formatting |
| `src/agent/memory.js` | Audience preference extraction and memory persistence helpers |
| `src/agent/tools.js` | Tool definitions such as web search |
| `src/tts.js` | Browser speech synthesis wrapper and streaming reveal behavior |
| `vite.config.js` | Local API for memory persistence and search proxy |

## TTS

The current TTS path uses the browser's built-in `speechSynthesis` API.

- `Load TTS` initializes available local/system voices
- `Speak last reply` replays the latest bit
- `Auto-speak each finished bit` reads each completed bit aloud

## Ambient Music

The app includes a built-in Web Audio ambient layer.

- `Play music` starts a gentle generated background loop
- `Pause music` stops it immediately
- the volume slider adjusts the room ambience without affecting speech controls

## Audience Feedback

Audience mood is no longer based only on the assistant's last bit.

- Quick reaction buttons let the user mark a moment as a big laugh, laugh, smile, groan, or bomb.
- Audience text is parsed for positive and negative cues, so messages like `lol`, `that was great`, `meh`, `too dark`, or `more like that` affect the room energy.
- The mood meter, laugh feedback line, and reaction burst all update from that combined signal.
- Recent emoji reactions and text feedback are converted into compact audience signals and injected into the next agent prompt.

## Memory

The app writes local runtime memory into:

- `memory/profile.json`
- `memory/history.json`

That folder is gitignored because it is user-specific runtime state.

## Commands

```bash
npm run dev
npm run build
npm run preview
```

## Constraints

- Chromium-based browser with WebGPU support required
- Text-only Gemma flow in the current MediaPipe web setup
- Small context window, so prompts and history stay compact
- No server-side LLM inference

# LangChain Comedy Agent Plan

## Goal

Build a LangChain-based agent around the current local Gemma browser model so it can:

- act as a comedy artist
- create short paragraph jokes
- use online tools when useful
- remember audience preferences with file-backed memory

## Constraints

- MediaPipe `LlmInference` must keep running in the browser because it depends on WebGPU.
- The browser app cannot directly write arbitrary files into the repo.
- File-backed memory therefore needs a tiny local Node/Vite-side API for reading and writing `memory/*.json`.
- The current project is a small Vite app with most logic in `src/main.js`.

## Architecture

### Runtime split

- Browser:
  - load and run the local Gemma model
  - run the LangChain-style agent loop
  - call online tools with `fetch`
  - render streamed output in the existing UI
- Local Vite/Node layer:
  - expose a tiny API for reading and writing memory files
  - store durable memory in a gitignored `memory/` folder

### Core flow

1. User sends a prompt from the existing chat UI.
2. The browser agent loads saved memory from the local memory API.
3. The agent builds context from:
   - system instructions
   - saved audience memory
   - recent conversation
4. The local Gemma model generates either:
   - an `ACTION:` tool call, or
   - an `ANSWER:` final joke
5. If a tool is requested, the browser executes it and feeds the result back into the loop.
6. The agent returns one short paragraph joke.
7. Distilled memory is written to files in `memory/`.

## Planned Files

### New files

- `plan/langchain-comedy-agent.md`
- `vite.config.js` or `vite.config.mjs`
- `src/agent/model.js`
- `src/agent/tools.js`
- `src/agent/output-parser.js`
- `src/agent/memory.js`
- `src/agent/index.js`

### Updated files

- `.gitignore`
- `package.json`
- `src/main.js`

### Runtime-created files

- `memory/profile.json`
- `memory/history.json`

## Implementation Details

### 1. Memory folder and gitignore

- Add `memory/` to `.gitignore`.
- Keep memory local and untracked because it is user-specific runtime state.
- Use JSON so the saved state is easy to inspect and debug.

### 2. Local memory API

Add a small Vite-side API with endpoints like:

- `GET /api/memory/profile`
- `POST /api/memory/profile`
- `GET /api/memory/history`
- `POST /api/memory/history`

Responsibilities:

- create the `memory/` folder if it does not exist
- return default empty memory when files do not exist yet
- validate JSON payload shape before writing
- write formatted JSON for readability

### 3. Shared inference helpers

Refactor reusable logic from `src/main.js` into shared helpers or keep it centrally reusable for:

- prompt building
- control token stripping
- inference serialization
- engine recovery handling

This keeps the current chat UI and the new agent behavior aligned.

### 4. LangChain model wrapper

Add `src/agent/model.js` to wrap the existing MediaPipe `LlmInference` instance.

Responsibilities:

- accept LangChain-style messages
- convert them to Gemma turn format
- call the local model
- stream partial output
- clean leaked control tokens from output

### 5. Tooling layer

Add `src/agent/tools.js` with browser-safe online tools.

Initial tool set:

- a web lookup tool for pulling short factual context from public pages or APIs
- optionally a headline/trending lookup tool if needed later

Guidelines:

- tools must not require secrets
- tool output should be compact so it fits within the local model context window
- tool usage should be optional, not mandatory on every turn

### 6. Output parser and agent loop

Because the current Gemma setup does not provide robust native function calling, use a ReAct-style text protocol.

Expected model patterns:

```text
ACTION: tool_name({"query":"latest dad joke trends"})
```

or

```text
ANSWER: A short joke paragraph here.
```

`src/agent/output-parser.js` should:

- detect `ACTION:` requests
- parse tool name and JSON arguments
- detect `ANSWER:` final output
- fall back safely if the output is malformed

### 7. File-backed memory logic

Add `src/agent/memory.js`.

Responsibilities:

- load memory from the local API
- build a concise memory block for the model prompt
- extract durable preferences from recent conversation
- save distilled memory back to files after each completed turn

Planned schema:

```json
{
  "audienceProfile": {
    "tone": "lighthearted",
    "favoriteTopics": [],
    "avoidTopics": [],
    "styleNotes": [
      "short paragraph jokes"
    ]
  },
  "recentLearnings": [],
  "lastUpdated": ""
}
```

### 8. Agent definition

Add `src/agent/index.js`.

Responsibilities:

- define the comedy persona
- inject memory and tool instructions
- enforce the final response format
- serialize model calls through one shared inference instance

Core behavior rules:

- role is comedy artist
- goal is to make the audience happy
- final response is always one short paragraph
- avoid insulting or harmful jokes
- remember audience preferences when generating future jokes

### 9. UI integration

Update `src/main.js` so the existing chat app:

- loads and unloads the model exactly as it does now
- routes chat generation through the agent instead of direct single-turn generation
- continues to show streaming output
- preserves cancel behavior where possible
- updates status text for tool use and memory loading/saving

## Suggested Work Order

1. Add `memory/` to `.gitignore`.
2. Add the local memory API in Vite config.
3. Add LangChain dependencies.
4. Create agent modules under `src/agent/`.
5. Refactor `src/main.js` to use the new agent flow.
6. Validate memory read/write behavior.
7. Validate tool calling.
8. Run `npm run build`.

## Risks

- MediaPipe inference is browser-only, so the model cannot be moved into Node.
- ReAct-style tool parsing is less reliable than native function calling.
- Multi-step agent loops may increase busy-state errors from the inference engine.
- LangChain adds bundle/runtime complexity to a currently simple app.
- Online tools must stay secret-free and browser-safe.

## Validation Checklist

- The app still loads the bundled local Gemma model successfully.
- The assistant returns a short paragraph joke for normal prompts.
- The agent can use an online tool when the prompt benefits from current info.
- The app writes durable memory into `memory/profile.json` and `memory/history.json`.
- Saved memory changes later jokes after refresh.
- `memory/` remains untracked by git.
- `npm run build` succeeds.

## Nice-to-Haves Later

- add a UI button to clear saved memory
- show visible tool activity in the chat stream
- split durable memory from short-term session summaries more cleanly
- add per-audience memory files if multiple personas are needed later

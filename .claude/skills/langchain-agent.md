---
description: Scaffold and implement LangChain agents powered by the local in-browser Gemma model (MediaPipe LlmInference + WebGPU)
user_invocable: true
---

# LangChain Agent — Browser-Local Gemma

When the user invokes this skill, help them design, scaffold, or implement a LangChain agent that uses the local Gemma model running in the browser via MediaPipe `LlmInference`.

## Context

This project runs Gemma 4 locally in the browser using `@mediapipe/tasks-genai` with WebGPU. The agent must run entirely in-browser — no remote backend.

## Architecture

Use an in-browser LangGraph agent. LangChain JS works in browser environments.

```
UI (vanilla JS or React/Vue)
  |
LangGraph Agent (in-browser)
  |
ChatGemmaLocal (custom BaseChatModel)
  |
MediaPipe LlmInference (WebGPU, local .task file)
```

## When scaffolding the custom ChatModel

Extend `BaseChatModel` from `@langchain/core/language_models/chat_models`. The wrapper must:

1. Accept a `LlmInference` instance from MediaPipe
2. Format LangChain messages into Gemma's turn template:
   - `SystemMessage` / `HumanMessage` -> `<start_of_turn>user\n{content}<end_of_turn>\n`
   - `AIMessage` -> `<start_of_turn>model\n{content}<end_of_turn>\n`
   - End with `<start_of_turn>model\n`
3. Strip control tokens (`<start_of_turn>`, `<end_of_turn>`, Hindi variants) from output
4. Implement `_generate()` for single responses and `_streamResponseChunks()` for streaming

Example skeleton:

```ts
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatResult } from "@langchain/core/outputs";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { AIMessageChunk } from "@langchain/core/messages";
import { LlmInference } from "@mediapipe/tasks-genai";

class ChatGemmaLocal extends BaseChatModel {
  private llm: LlmInference;

  constructor(llmInference: LlmInference) {
    super({});
    this.llm = llmInference;
  }

  _llmType() { return "gemma-local"; }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const prompt = this.formatPrompt(messages);
    const raw = await this.llm.generateResponse(prompt);
    const text = stripControlTokens(raw);
    return { generations: [{ text, message: new AIMessage(text) }] };
  }

  async *_streamResponseChunks(messages: BaseMessage[]) {
    const prompt = this.formatPrompt(messages);
    let resolve: (v: string | null) => void;
    let pending = new Promise<string | null>((r) => (resolve = r));

    const done$ = this.llm.generateResponse(prompt, (partial, done) => {
      resolve(done ? null : partial);
      if (!done) pending = new Promise<string | null>((r) => (resolve = r));
    });

    while (true) {
      const chunk = await pending;
      if (chunk === null) break;
      const cleaned = stripControlTokens(chunk);
      yield new ChatGenerationChunk({ text: cleaned, message: new AIMessageChunk(cleaned) });
    }
    await done$;
  }

  private formatPrompt(messages: BaseMessage[]): string {
    let prompt = "";
    for (const msg of messages) {
      if (msg instanceof SystemMessage || msg instanceof HumanMessage) {
        prompt += `<start_of_turn>user\n${msg.content}<end_of_turn>\n`;
      } else if (msg instanceof AIMessage) {
        prompt += `<start_of_turn>model\n${msg.content}<end_of_turn>\n`;
      }
    }
    return prompt + "<start_of_turn>model\n";
  }
}
```

## When adding tools

Gemma doesn't produce native LangChain tool-call JSON. Use ReAct-style text parsing:

1. Define tools with `tool()` from `@langchain/core/tools` and `zod` schemas
2. Inject tool descriptions into the system prompt with this format:
   ```
   You have access to the following tools:
   - tool_name(param: type): description

   When you need to use a tool, respond EXACTLY with:
   ACTION: tool_name({"param": "value"})

   When you have the final answer, respond with:
   ANSWER: your response here
   ```
3. Implement a custom output parser to extract `ACTION:` lines and route to tools
4. Use `createReactAgent` from `@langchain/langgraph/prebuilt` if the model reliably follows the format, otherwise implement a manual agent loop

## When integrating with the UI

Since the agent runs in-browser, call it directly — don't use `useStream` (that requires an HTTP server):

```ts
const stream = await agent.stream({ messages });
for await (const event of stream) {
  // render each chunk/tool call to the DOM
}
```

If the user specifically wants `useStream`, bridge it with a Service Worker that implements the LangGraph SSE streaming protocol.

## Dependencies to install

```bash
npm install @langchain/core @langchain/langgraph zod
```

## Constraints to keep in mind

- `MemorySaver` only (in-memory) — no persistent checkpointer in the browser
- Single-threaded inference — agent loop blocks during generation
- Gemma 4 E2B web has a limited context window — long tool chains may exceed it
- MediaPipe WebGPU is browser-only, cannot run in Node.js
- The existing `LlmInference` instance in `src/main.js` should be shared, not duplicated

## File structure convention

```
src/
  agent/
    model.ts          # ChatGemmaLocal
    tools.ts          # Tool definitions
    agent.ts          # Agent setup (createReactAgent or manual loop)
    output-parser.ts  # ACTION:/ANSWER: text parser
  main.js             # Existing entry, shares LlmInference instance
```

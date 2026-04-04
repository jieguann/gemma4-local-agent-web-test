import { ChatPromptTemplate } from "@langchain/core/prompts";
import { loadAgentMemory, saveAgentMemory, buildMemoryContext, updateMemoryFromTurn } from "./memory.js";
import { parseAgentOutput } from "./output-parser.js";
import {
  AGENT_PROTOCOL_PROMPT,
  COMEDY_SYSTEM_PROMPT,
  coerceShortParagraph,
  formatRecentConversation,
  normalizeMessageContent,
} from "./prompting.js";
import { buildToolMap, createAgentTools, describeTools } from "./tools.js";

const MAX_AGENT_STEPS = 3;

export function createComedyAgent({ model, onStatus }) {
  const tools = createAgentTools();
  const toolMap = buildToolMap(tools);

  return {
    async run(input, { conversation = [], onToken, onToolUse } = {}) {
      const memory = await loadAgentMemory();
      const recentConversation = formatRecentConversation(conversation);
      const toolsDescription = describeTools(tools);
      let scratchpad = "";
      let finalAnswer = "";
      const usedTools = [];

      onStatus?.("Memory loaded. Building the comedy routine...");

      // Auto-search for prompts that likely need current info
      if (needsWebSearch(input)) {
        onStatus?.("Searching for context...");
        onToolUse?.({ tool: "web_search", query: input, status: "searching" });
        const searchTool = toolMap.get("web_search");
        if (searchTool) {
          try {
            const searchResult = await searchTool.invoke({ query: input });
            usedTools.push("web_search");
            onToolUse?.({ tool: "web_search", query: input, status: "done", result: searchResult });
            // Trim search results to avoid blowing the context window
            const trimmedResults = searchResult.split("\n").slice(0, 3).map(l => l.slice(0, 150)).join("\n");
            scratchpad += `Web facts:\n${trimmedResults}\n\nYou MUST use these facts in your joke. Reply with ANSWER: your joke.\n`;
          } catch {
            scratchpad += "Thought 0: Web search failed. Write a joke without it.\n";
          }
        }
      }

      for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
        const prompt = await ChatPromptTemplate.fromMessages([
          ["system", `${COMEDY_SYSTEM_PROMPT}\n\n${AGENT_PROTOCOL_PROMPT}\n\nTools:\n{toolsDescription}\n\nMemory:\n{memoryContext}`],
          ["human", "Topic: {input}\n\n{scratchpad}\n\nWrite a funny joke about the topic. If web facts are provided, use them."],
        ]).formatMessages({
          memoryContext: buildMemoryContext(memory),
          toolsDescription,
          input,
          scratchpad: scratchpad || "None yet.",
        });

        const result = await model.invoke(prompt, {
          onToken: step === 0 ? onToken : undefined,
        });

        const raw = normalizeMessageContent(result.content);
        const parsed = parseAgentOutput(raw);

        if (parsed.type === "answer") {
          finalAnswer = coerceShortParagraph(parsed.answer);
          break;
        }

        const tool = toolMap.get(parsed.toolName);
        if (!tool) {
          finalAnswer = coerceShortParagraph(raw);
          break;
        }

        onStatus?.(`Using tool: ${parsed.toolName}`);
        // Ensure args has a query string — small models sometimes produce unexpected arg shapes
        let toolArgs = parsed.args;
        if (parsed.toolName === "web_search" && typeof toolArgs?.query !== "string") {
          const fallbackQuery = typeof toolArgs === "string" ? toolArgs : Object.values(toolArgs ?? {}).find(v => typeof v === "string") ?? input;
          toolArgs = { query: fallbackQuery };
        }
        onToolUse?.({ tool: parsed.toolName, query: toolArgs?.query ?? "", status: "searching" });
        const toolResult = await tool.invoke(toolArgs);
        usedTools.push(parsed.toolName);
        onToolUse?.({ tool: parsed.toolName, query: toolArgs?.query ?? "", status: "done", result: toolResult });
        scratchpad += [
          `Thought ${step + 1}: I used ${parsed.toolName}.`,
          `Tool input: ${JSON.stringify(parsed.args)}`,
          `Tool result: ${toolResult}`,
        ].join("\n");
        scratchpad += "\n\nNow decide whether to call another tool or provide ANSWER.\n";
      }

      if (!finalAnswer) {
        finalAnswer = "The punchline took a coffee break, but it says it will be back with a one-paragraph joke in spirit.";
      }

      const nextMemory = updateMemoryFromTurn(memory, input, finalAnswer);
      await saveAgentMemory(nextMemory);
      onStatus?.(
        usedTools.length
          ? `Joke ready. Memory saved after using ${usedTools.join(", ")}.`
          : "Joke ready. Memory saved.",
      );

      return {
        output: finalAnswer,
        usedTools,
      };
    },
    cancel() {
      model.cancel();
    },
  };
}

function needsWebSearch(input) {
  const lowered = input.toLowerCase();
  return /(trending|today|latest|recent|current|news|happening now|this week|this month|what's new|update)/i.test(lowered);
}

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { loadAgentMemory, saveAgentMemory, buildMemoryContext, updateMemoryFromTurn } from "./memory.js";
import {
  COMEDY_CONTINUE_PROMPT,
  COMEDY_OPENER_PROMPT,
  COMEDY_PLANNER_PROMPT,
  COMEDY_RENDER_PROMPT,
  COMEDY_SYSTEM_PROMPT,
  coerceShortParagraph,
  formatComedyPlan,
  formatRecentConversation,
  inferComedyMode,
  isInteractiveMode,
  normalizeMessageContent,
  parseComedyPlan,
} from "./prompting.js";
import { buildToolMap, createAgentTools } from "./tools.js";

export function createComedyAgent({ model, onStatus }) {
  const tools = createAgentTools();
  const toolMap = buildToolMap(tools);

  return {
    /**
     * Generate an opening bit — called automatically when the model loads.
     * No user input needed; the comedian opens the set.
     */
    async opener({ onToken } = {}) {
      const memory = await loadAgentMemory();
      onStatus?.("Opening the set...");

      const openerPrompt = await ChatPromptTemplate.fromMessages([
        ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_OPENER_PROMPT}`],
        ["human", "Audience: {memoryContext}\n\nOpen the set."],
      ]).formatMessages({
        memoryContext: buildMemoryContext(memory),
      });

      const result = await model.invoke(openerPrompt, { onToken });
      const output = coerceShortParagraph(normalizeMessageContent(result.content))
        || "Hey hey! Welcome to the show! So... what's on your mind? Give me a topic and I'll make it funny.";

      const nextMemory = updateMemoryFromTurn(memory, "(show opened)", output);
      await saveAgentMemory(nextMemory);
      onStatus?.("The set is live. Talk back!");

      return { output, usedTools: [] };
    },

    async run(input, { conversation = [], onToken, onToolUse } = {}) {
      const memory = await loadAgentMemory();
      const recentConversation = formatRecentConversation(conversation);
      const routedMode = inferComedyMode(input, conversation);
      const usedTools = [];
      let searchContext = "No external facts gathered.";
      let finalAnswer = "";

      onStatus?.(`Memory loaded. Building a ${routedMode.replace(/_/g, " ")} bit...`);

      // ── Interactive / continuation path ──
      // For reactions, continuations, crowd work — skip the full plan+render
      // pipeline and just riff directly off the conversation.
      if (isInteractiveMode(routedMode)) {
        onStatus?.("Riffing off the crowd...");
        const continuePrompt = await ChatPromptTemplate.fromMessages([
          ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_CONTINUE_PROMPT}`],
          ["human", "Audience: {memoryContext}\nRecent:\n{recentConversation}\n\nAudience says: {input}\nVibe: {routedMode}\nReact in one short paragraph."],
        ]).formatMessages({
          input,
          routedMode: routedMode.replace(/_/g, " "),
          memoryContext: buildMemoryContext(memory),
          recentConversation,
        });

        const result = await model.invoke(continuePrompt, { onToken });
        finalAnswer = coerceShortParagraph(normalizeMessageContent(result.content));

        if (!finalAnswer) {
          finalAnswer = "I had a callback lined up but it ghosted me. Hit me with another topic!";
        }

        const nextMemory = updateMemoryFromTurn(memory, input, finalAnswer);
        await saveAgentMemory(nextMemory);
        onStatus?.("Bit delivered. Keep it going!");

        return { output: finalAnswer, usedTools };
      }

      // ── Full plan + render path (new topic) ──
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
            searchContext = searchResult
              .split("\n")
              .slice(0, 3)
              .map((line) => line.slice(0, 160))
              .join("\n");
          } catch {
            searchContext = "Web search failed. Use evergreen material only.";
          }
        }
      }

      onStatus?.("Shaping the premise and punchline...");
      const planPrompt = await ChatPromptTemplate.fromMessages([
        ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_PLANNER_PROMPT}`],
        ["human", "Topic: {input}\nMode: {routedMode}\nAudience: {memoryContext}\nFacts: {searchContext}"],
      ]).formatMessages({
        input,
        routedMode,
        memoryContext: buildMemoryContext(memory),
        searchContext,
      });

      const planResult = await model.invoke(planPrompt);
      const comedyPlan = parseComedyPlan(normalizeMessageContent(planResult.content));

      onStatus?.("Performing the final bit...");
      const renderPrompt = await ChatPromptTemplate.fromMessages([
        ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_RENDER_PROMPT}`],
        ["human", "Topic: {input}\nBlueprint:\n{comedyPlan}\nFacts: {searchContext}\n\nOne short paragraph. End with a question or tease to keep the show going."],
      ]).formatMessages({
        input,
        comedyPlan: formatComedyPlan(comedyPlan),
        searchContext,
      });

      const finalResult = await model.invoke(renderPrompt, { onToken });
      finalAnswer = coerceShortParagraph(normalizeMessageContent(finalResult.content));

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

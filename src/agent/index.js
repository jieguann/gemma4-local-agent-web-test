import { ChatPromptTemplate } from "@langchain/core/prompts";
import { loadAgentMemory, saveAgentMemory, buildMemoryContext, updateMemoryFromTurn } from "./memory.js";
import {
  COMEDY_AUTOPLAY_PROMPT,
  COMEDY_CONTINUE_PROMPT,
  COMEDY_OPENER_PROMPT,
  COMEDY_PLANNER_PROMPT,
  COMEDY_RENDER_PROMPT,
  COMEDY_SYSTEM_PROMPT,
  COMEDY_TOOL_DECISION_PROMPT,
  coerceShortParagraph,
  formatComedyPlan,
  formatRecentConversation,
  inferComedyMode,
  isInteractiveMode,
  normalizeMessageContent,
  parseComedyPlan,
  stripControlTokens,
} from "./prompting.js";
import { buildToolMap, createAgentTools } from "./tools.js";

export function createComedyAgent({ model, onStatus }) {
  const tools = createAgentTools();
  const toolMap = buildToolMap(tools);

  function formatAudienceSignals(signals = []) {
    if (!Array.isArray(signals) || signals.length === 0) {
      return "No fresh audience reaction signals.";
    }

    return signals
      .slice(-4)
      .map((signal) => `- ${String(signal).trim()}`)
      .join("\n");
  }

  /**
   * Autonomously decide whether to search, execute the tool if so,
   * and return the search context string.
   */
  async function autonomousToolStep({ topic, memoryContext, onToolUse }) {
    const usedTools = [];
    let searchContext = "No external facts gathered.";

    try {
      onStatus?.("Deciding if I need to look something up...");
      const decisionPrompt = await ChatPromptTemplate.fromMessages([
        ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_TOOL_DECISION_PROMPT}`],
        ["human", "Next topic/context: {topic}\nAudience: {memoryContext}\n\nDo you need to search?"],
      ]).formatMessages({ topic, memoryContext });

      const decisionResult = await model.invoke(decisionPrompt);
      const decision = stripControlTokens(normalizeMessageContent(decisionResult.content));

      const actionMatch = decision.match(/^ACTION:\s*web_search\(\s*\{[\s\S]*?"query"\s*:\s*"([^"]+)"[\s\S]*?\}\s*\)/m);
      if (actionMatch) {
        const query = actionMatch[1];
        onStatus?.(`Searching: "${query}"...`);
        onToolUse?.({ tool: "web_search", query, status: "searching" });

        const searchTool = toolMap.get("web_search");
        if (searchTool) {
          const searchResult = await searchTool.invoke({ query });
          usedTools.push("web_search");
          onToolUse?.({ tool: "web_search", query, status: "done", result: searchResult });
          searchContext = searchResult
            .split("\n")
            .slice(0, 3)
            .map((line) => line.slice(0, 160))
            .join("\n");
        }
      }
    } catch {
      searchContext = "Search skipped.";
    }

    return { searchContext, usedTools };
  }

  /**
   * Plan + render a joke on a given topic.
   */
  async function planAndRender({ topic, mode, memoryContext, searchContext, onToken }) {
    onStatus?.("Shaping the premise and punchline...");
    const planPrompt = await ChatPromptTemplate.fromMessages([
      ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_PLANNER_PROMPT}`],
      ["human", "Topic: {topic}\nMode: {mode}\nAudience: {memoryContext}\nFacts: {searchContext}"],
    ]).formatMessages({ topic, mode, memoryContext, searchContext });

    const planResult = await model.invoke(planPrompt);
    const comedyPlan = parseComedyPlan(normalizeMessageContent(planResult.content));

    onStatus?.("Performing the bit...");
    const renderPrompt = await ChatPromptTemplate.fromMessages([
      ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_RENDER_PROMPT}`],
      ["human", "Topic: {topic}\nBlueprint:\n{comedyPlan}\nFacts: {searchContext}\n\nOne short paragraph. End with a question or tease to keep the show going."],
    ]).formatMessages({
      topic,
      comedyPlan: formatComedyPlan(comedyPlan),
      searchContext,
    });

    const finalResult = await model.invoke(renderPrompt, { onToken });
    return coerceShortParagraph(normalizeMessageContent(finalResult.content));
  }

  return {
    /**
     * Open the set — called once when the model loads.
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
      onStatus?.("The set is live!");

      return { output, usedTools: [] };
    },

    /**
     * Generate the next bit in the set. This is the main autoplay method.
     *
     * - If `userInput` is provided, the agent incorporates the audience's input.
     * - If `userInput` is empty/null, the agent freestyles its own next topic.
     * - The agent autonomously decides whether to web search for material.
     */
    async nextBit({ userInput, audienceSignals = [], conversation = [], onToken, onToolUse } = {}) {
      const memory = await loadAgentMemory();
      const memoryContext = buildMemoryContext(memory);
      const recentConversation = formatRecentConversation(conversation);
      const audienceSignalContext = formatAudienceSignals(audienceSignals);
      const hasAudienceInput = Boolean(userInput?.trim());
      let finalAnswer = "";
      let usedTools = [];

      // ── If user said something, check if it's a reaction or a new topic ──
      if (hasAudienceInput) {
        const routedMode = inferComedyMode(userInput, conversation);

        // Quick interactive riff for reactions
        if (isInteractiveMode(routedMode)) {
          onStatus?.("Riffing off the crowd...");
          const continuePrompt = await ChatPromptTemplate.fromMessages([
            ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_CONTINUE_PROMPT}`],
            ["human", "Audience: {memoryContext}\nRecent:\n{recentConversation}\nAudience signals:\n{audienceSignalContext}\n\nAudience says: {input}\nVibe: {routedMode}\nReact in one short paragraph, then keep the set going."],
          ]).formatMessages({
            input: userInput,
            routedMode: routedMode.replace(/_/g, " "),
            memoryContext,
            recentConversation,
            audienceSignalContext,
          });

          const result = await model.invoke(continuePrompt, { onToken });
          finalAnswer = coerceShortParagraph(normalizeMessageContent(result.content));
        } else {
          // New topic from audience — autonomous tool step + plan+render
          const toolResult = await autonomousToolStep({
            topic: userInput,
            memoryContext,
            onToolUse,
          });
          usedTools = toolResult.usedTools;

          finalAnswer = await planAndRender({
            topic: userInput,
            mode: routedMode,
            memoryContext,
            searchContext: toolResult.searchContext,
            onToken,
          });
        }
      } else {
        // ── Freestyle — agent picks its own next topic ──
        // Autonomous tool step: agent decides if it wants to search for material
        const toolResult = await autonomousToolStep({
          topic: `freestyle continuation. Recent set:\n${recentConversation}`,
          memoryContext,
          onToolUse,
        });
        usedTools = toolResult.usedTools;

        onStatus?.("Cooking up the next bit...");
        const autoPrompt = await ChatPromptTemplate.fromMessages([
          ["system", `${COMEDY_SYSTEM_PROMPT}\n${COMEDY_AUTOPLAY_PROMPT}`],
          ["human", "Audience: {memoryContext}\nRecent set:\n{recentConversation}\nAudience signals:\n{audienceSignalContext}\nFacts: {searchContext}\n\nDeliver your next bit. One short paragraph."],
        ]).formatMessages({
          memoryContext,
          recentConversation,
          audienceSignalContext,
          searchContext: toolResult.searchContext,
        });

        const result = await model.invoke(autoPrompt, { onToken });
        finalAnswer = coerceShortParagraph(normalizeMessageContent(result.content));
      }

      if (!finalAnswer) {
        finalAnswer = "I had a callback lined up but it ghosted me. Let me try another angle...";
      }

      const promptLabel = hasAudienceInput ? userInput : "(autoplay)";
      const nextMemory = updateMemoryFromTurn(memory, promptLabel, finalAnswer);
      await saveAgentMemory(nextMemory);
      onStatus?.(usedTools.length
        ? `Bit delivered (used ${usedTools.join(", ")}). The set continues...`
        : "Bit delivered. The set continues...");

      return { output: finalAnswer, usedTools };
    },

    cancel() {
      model.cancel();
    },
  };
}

export const COMEDY_SYSTEM_PROMPT = [
  "You are a comedy artist. Write one short, funny paragraph about the EXACT topic the user asks for.",
  "Always base your joke on the user's topic. Never ignore it. Never default to cats or generic jokes.",
  "Keep it playful and concise. No hateful or cruel content.",
].join(" ");

export const AGENT_PROTOCOL_PROMPT = [
  "You may either call a tool or provide the final joke.",
  "If you need a tool, reply with exactly one line in this format:",
  'ACTION: tool_name({{"arg":"value"}})',
  "If you are ready to answer, reply with exactly one line in this format:",
  "ANSWER: your short paragraph joke",
  "Do not output both ACTION and ANSWER in the same response.",
].join("\n");

export function stripControlTokens(text) {
  return String(text ?? "")
    .replace(/<start_of_turn>(?:user|model)\n?/g, "")
    .replace(/<end_of_turn>/g, "")
    .replace(/<[^>]*अंत[^>]*>/g, "")
    .trim();
}

export function normalizeMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && part.type === "text") {
          return part.text ?? "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return String(content ?? "");
}

export function getLangChainRole(message) {
  if (typeof message?.getType === "function") {
    return message.getType();
  }

  if (typeof message?._getType === "function") {
    return message._getType();
  }

  return "human";
}

export function buildGemmaPrompt(messages) {
  let prompt = "";

  for (const message of messages) {
    const role = getLangChainRole(message);
    const content = normalizeMessageContent(message.content).trim();
    if (!content) {
      continue;
    }

    const gemmaRole = role === "ai" ? "model" : "user";
    prompt += `<start_of_turn>${gemmaRole}\n${content}<end_of_turn>\n`;
  }

  prompt += "<start_of_turn>model\n";
  return prompt;
}

export function formatRecentConversation(conversation) {
  if (!Array.isArray(conversation) || conversation.length === 0) {
    return "No prior conversation yet.";
  }

  const recentTurns = conversation.slice(-8);
  return recentTurns
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      const text = String(message.text ?? "").trim() || "(empty)";
      return `${role}: ${text}`;
    })
    .join("\n");
}

export function coerceShortParagraph(text) {
  const cleaned = stripControlTokens(text)
    .replace(/^ANSWER:\s*/i, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "I tried to write a joke, but my punchline slipped on a banana peel before it reached the stage.";
  }

  return cleaned;
}

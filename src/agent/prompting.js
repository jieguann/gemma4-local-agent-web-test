export const COMEDY_SYSTEM_PROMPT =
  "You are a live stand-up comic doing an interactive set. Sharp setup-payoff structure, specific observations, one clear punch. Riff on the audience's topic and taste. Stay playful and safe.";

export const AGENT_PROTOCOL_PROMPT = [
  "You may either call a tool or provide the final joke.",
  "If you need a tool, reply with exactly one line in this format:",
  'ACTION: tool_name({{"arg":"value"}})',
  "If you are ready to answer, reply with exactly one line in this format:",
  "ANSWER: your short paragraph joke",
  "Do not output both ACTION and ANSWER in the same response.",
].join("\n");

export const COMEDY_OPENER_PROMPT =
  "Open your set: 2-3 sentences. Greet the crowd with a quick joke, then invite interaction (ask them something or tease a topic). No generic hellos — perform.";

export const COMEDY_CONTINUE_PROMPT =
  "React to the audience like a comic mid-set. Build on laughs, recover from bombs, riff on heckles, do crowd work. Use callbacks to earlier bits. One short paragraph, end with something that keeps the show going.";

export const COMEDY_AUTOPLAY_PROMPT =
  "You are mid-set doing a live comedy show. Keep the set going — pick your own next topic or transition from the last bit. You can callback to earlier material, switch angles, do crowd work, or escalate. Surprise the audience. Do not repeat the previous opening line, setup wording, or premise too closely. One short paragraph, natural comedian voice.";

export const COMEDY_TOOL_DECISION_PROMPT =
  "You are planning your next comedy bit. If you need a current fact, trending topic, or real-world detail to make the joke land, reply with exactly:\nACTION: web_search({\"query\": \"your search\"})\nIf you have enough material already, reply with exactly:\nSKIP\nOnly search when a real fact would make the bit better. Do not search for generic topics.";

export const COMEDY_PLANNER_PROMPT =
  "Plan a comedy bit. Return these labels on separate lines:\nMode:\nPremise:\nAngle:\nPunch:\nCallback:";

export const COMEDY_RENDER_PROMPT =
  "Perform the bit from the blueprint. One short paragraph, natural comedian voice. Setup then payoff. Stay on topic.";

export const COMEDY_DEFENSE_PROMPT =
  "A crowd heckle just hit after a weak joke. Answer like a seasoned comic: quick defense, playful pivot, no sulking, no explaining the joke for too long. One short paragraph that regains momentum.";

export const FEEDBACK_SYSTEM_PROMPT =
  "You are the audience feedback agent for a live stand-up set. Judge how the joke landed, describe the room's emotional reaction, and decide whether the crowd heckles back. Be blunt, specific, and useful to the comedian.";

export const FEEDBACK_EVALUATION_PROMPT = [
  "Evaluate the bit and return exactly these labels on separate lines:",
  "Score: 0-100",
  "Emotion: short crowd emotion phrase",
  "Emojis: 1-3 emojis that capture the crowd's feeling (e.g. 😂🔥 for a killer bit, 😬💀 for a bomb, 🤣👏 for strong laugh, 😐🦗 for silence)",
  "Verdict: one short sentence",
  "Reaction: one of erupting_laugh, strong_laugh, chuckle, mixed, groan, silence, bomb",
  "ShouldHeckle: yes or no",
  "Heckle: short heckle line or 'none'",
  "Advice: one short coaching note for the next response",
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

export function formatRecentConversation(conversation, { excludeRoles = [], maxCharsPerEntry = 200 } = {}) {
  if (!Array.isArray(conversation) || conversation.length === 0) {
    return "No prior conversation yet.";
  }

  const filtered = excludeRoles.length > 0
    ? conversation.filter((m) => !excludeRoles.includes(m.role))
    : conversation;

  const recentTurns = filtered.slice(-4);
  return recentTurns
    .map((message) => {
      const role =
        message.role === "assistant" ? "Assistant" :
        message.role === "crowd" ? "Crowd" :
        message.role === "critic" ? "Critic" :
        "User";
      const text = String(message.text ?? "").trim() || "(empty)";
      return `${role}: ${text.slice(0, maxCharsPerEntry)}`;
    })
    .join("\n");
}

export function formatRecentAssistantBits(conversation, limit = 3) {
  if (!Array.isArray(conversation) || conversation.length === 0) {
    return "No earlier bits yet.";
  }

  const bits = conversation
    .filter((message) => message?.role === "assistant")
    .slice(-Math.max(1, limit))
    .map((message, index) => {
      const text = String(message.text ?? "").trim();
      return text ? `Bit ${index + 1}: ${text.slice(0, 180)}` : "";
    })
    .filter(Boolean);

  return bits.length ? bits.join("\n") : "No earlier bits yet.";
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

export function inferComedyMode(input, conversation = []) {
  const prompt = String(input ?? "").toLowerCase();
  const recentText = Array.isArray(conversation)
    ? conversation.slice(-4).map((entry) => String(entry?.text ?? "").toLowerCase()).join(" ")
    : "";
  const combined = `${prompt} ${recentText}`;
  const hasHistory = Array.isArray(conversation) && conversation.some((m) => m.role === "assistant");

  // Interactive/continuation modes — detected when there's prior conversation
  if (hasHistory) {
    if (/(more|keep going|continue|another|go on|encore|next|and then)/.test(prompt)) {
      return "continue_bit";
    }
    if (/(haha|lol|lmao|rofl|😂|🤣|that's? (funny|good|great|hilarious)|loved? (it|that))/.test(prompt)) {
      return "build_on_laugh";
    }
    if (/(no|bad|terrible|awful|boo|not funny|cringe|meh|weak|try again)/.test(prompt)) {
      return "recover_from_bomb";
    }
    if (/\?$/.test(prompt.trim())) {
      return "crowd_work";
    }
    // Short responses (1-4 words) are likely audience reactions — do crowd work
    if (prompt.split(/\s+/).length <= 4 && !/joke about|tell me about/i.test(prompt)) {
      return "crowd_work";
    }
  }

  if (/(roast|make fun of|insult)/.test(combined)) {
    return "roast";
  }

  if (/(headline|breaking news|anchor|news desk)/.test(combined)) {
    return "fake_headline";
  }

  if (/(story|anecdote|once|let me tell you)/.test(combined)) {
    return "story_bit";
  }

  if (/(crowd|audience|room|people here|you folks)/.test(combined)) {
    return "crowd_work";
  }

  if (/(one-liner|one liner|short joke|quick joke)/.test(combined)) {
    return "one_liner";
  }

  if (/(today|latest|current|news|trending|this week|this month)/.test(combined)) {
    return "topical_observational";
  }

  return "observational";
}

/**
 * Returns true if the mode is an interactive/continuation mode
 * (i.e. should use the continue prompt rather than the full plan+render pipeline).
 */
export function isInteractiveMode(mode) {
  return ["continue_bit", "build_on_laugh", "recover_from_bomb", "crowd_work"].includes(mode);
}

export function parseComedyPlan(text) {
  const labels = ["Mode", "Premise", "Angle", "Punch", "Callback"];
  const source = stripControlTokens(text);
  const plan = {};

  for (const label of labels) {
    const match = source.match(new RegExp(`^${label}:\\s*(.*)$`, "im"));
    plan[label.toLowerCase()] = match?.[1]?.trim() || "";
  }

  return {
    mode: plan.mode || "observational",
    premise: plan.premise || "the topic has comic potential",
    angle: plan.angle || "playful twist",
    punch: plan.punch || "one clear punchline",
    callback: plan.callback || "",
  };
}

export function formatComedyPlan(plan) {
  const lines = [
    `Mode: ${plan.mode}`,
    `Premise: ${plan.premise}`,
    `Angle: ${plan.angle}`,
    `Punch: ${plan.punch}`,
  ];
  if (plan.callback) lines.push(`Callback: ${plan.callback}`);
  return lines.join("\n");
}

import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  FEEDBACK_EVALUATION_PROMPT,
  FEEDBACK_SYSTEM_PROMPT,
  formatRecentConversation,
  normalizeMessageContent,
  stripControlTokens,
} from "./prompting.js";

const REACTION_TO_SCORE = {
  erupting_laugh: 92,
  strong_laugh: 76,
  chuckle: 60,
  mixed: 48,
  groan: 34,
  silence: 22,
  bomb: 12,
};

const REACTION_FALLBACK_EMOJIS = {
  erupting_laugh: ["😂", "🔥", "👏"],
  strong_laugh: ["🤣", "👏"],
  chuckle: ["😄", "👍"],
  mixed: ["😐", "🤷"],
  groan: ["😬", "🙄"],
  silence: ["😶", "🦗"],
  bomb: ["💀", "💣"],
};

export function createFeedbackAgent({ model, onStatus }) {
  return {
    async evaluateBit({ joke, audienceSignals = [], conversation = [] } = {}) {
      onStatus?.("The crowd judge is scoring the bit...");

      const prompt = await ChatPromptTemplate.fromMessages([
        ["system", `${FEEDBACK_SYSTEM_PROMPT}\n${FEEDBACK_EVALUATION_PROMPT}`],
        ["human", "Recent set:\n{recentConversation}\nAudience signals:\n{audienceSignals}\n\nBit to judge:\n{joke}"],
      ]).formatMessages({
        joke: String(joke ?? "").slice(0, 300).trim() || "(empty bit)",
        recentConversation: formatRecentConversation(conversation, { excludeRoles: ["critic"], maxCharsPerEntry: 150 }),
        audienceSignals: formatAudienceSignals(audienceSignals),
      });

      const result = await model.invoke(prompt);
      return parseFeedback(normalizeMessageContent(result.content));
    },
  };
}

function formatAudienceSignals(signals) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return "No explicit audience signals yet.";
  }

  return signals
    .slice(-5)
    .map((signal) => `- ${String(signal).trim()}`)
    .join("\n");
}

function parseFeedback(text) {
  const source = stripControlTokens(text);
  const scoreValue = readLabel(source, "Score");
  const reaction = normalizeReaction(readLabel(source, "Reaction"));
  const fallbackScore = REACTION_TO_SCORE[reaction] ?? 40;
  const parsedScore = clampScore(Number.parseInt(scoreValue, 10));

  const shouldHeckleValue = readLabel(source, "ShouldHeckle").toLowerCase();
  const heckle = cleanField(readLabel(source, "Heckle"));
  const emojisRaw = cleanField(readLabel(source, "Emojis"));
  const emojis = extractEmojis(emojisRaw, reaction);

  return {
    score: Number.isFinite(parsedScore) ? parsedScore : fallbackScore,
    emotion: cleanField(readLabel(source, "Emotion")) || "uncertain room",
    emojis,
    verdict: cleanField(readLabel(source, "Verdict")) || "The bit got a mixed room.",
    reaction,
    shouldHeckle: shouldHeckleValue === "yes" && heckle !== "none",
    heckle: heckle === "none" ? "" : heckle,
    advice: cleanField(readLabel(source, "Advice")) || "Sharpen the setup and hit a clearer payoff.",
  };
}

function readLabel(source, label) {
  const match = source.match(new RegExp(`^${label}:\\s*(.*)$`, "im"));
  return match?.[1]?.trim() || "";
}

function normalizeReaction(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return REACTION_TO_SCORE[normalized] ? normalized : "mixed";
}

function cleanField(value) {
  return String(value ?? "").trim();
}

function extractEmojis(raw, reaction) {
  // Pull actual emoji characters from the model output
  const emojiRegex = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
  const found = raw.match(emojiRegex) ?? [];
  if (found.length > 0) {
    return found.slice(0, 3);
  }
  // Fallback to reaction-based emojis
  return REACTION_FALLBACK_EMOJIS[reaction] ?? ["😐"];
}

function clampScore(value) {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

import { coerceShortParagraph } from "./prompting.js";

/**
 * Try to parse tool arguments from the model's ACTION output.
 * Handles: {"query":"cats"}, {query:"cats"}, "cats", cats
 */
function tryParseArgs(toolName, raw) {
  // 1. Valid JSON object
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch { /* continue */ }

  // 2. Unquoted keys like {query: "cats"} — add quotes around keys
  try {
    const fixed = raw.replace(/(\w+)\s*:/g, '"$1":');
    const parsed = JSON.parse(fixed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch { /* continue */ }

  // 3. Bare string like "cats" or cats — assume it's the first arg (query for web_search)
  const unquoted = raw.replace(/^["']|["']$/g, "").trim();
  if (unquoted) {
    return { query: unquoted };
  }

  return null;
}

export function parseAgentOutput(text) {
  const trimmed = String(text ?? "").trim();

  // Match ACTION: tool_name(...) — capture tool name and everything inside parens
  const actionMatch = trimmed.match(/^ACTION:\s*([a-zA-Z0-9_-]+)\(([\s\S]*)\)\s*$/m);
  if (actionMatch) {
    const toolName = actionMatch[1];
    const rawArgs = actionMatch[2].trim();

    // Try parsing as JSON object
    const args = tryParseArgs(toolName, rawArgs);
    if (args) {
      return { type: "action", toolName, args };
    }

    // If we can't parse args, treat the whole thing as an answer
    return {
      type: "answer",
      answer: coerceShortParagraph(trimmed),
    };
  }

  const answerMatch = trimmed.match(/ANSWER:\s*([\s\S]*)$/i);
  if (answerMatch) {
    return {
      type: "answer",
      answer: coerceShortParagraph(answerMatch[1]),
    };
  }

  return {
    type: "answer",
    answer: coerceShortParagraph(trimmed),
  };
}

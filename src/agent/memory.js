const DEFAULT_PROFILE = {
  audienceProfile: {
    tone: "lighthearted",
    favoriteTopics: [],
    avoidTopics: [],
    styleNotes: ["short paragraph jokes"],
  },
  recentLearnings: [],
  lastUpdated: "",
};

const DEFAULT_HISTORY = {
  entries: [],
  lastUpdated: "",
};

export async function loadAgentMemory() {
  const [profile, history] = await Promise.all([
    fetchJson("/api/memory/profile", DEFAULT_PROFILE),
    fetchJson("/api/memory/history", DEFAULT_HISTORY),
  ]);

  return {
    profile: mergeProfile(profile),
    history: mergeHistory(history),
  };
}

export async function saveAgentMemory(memory) {
  await Promise.all([
    postJson("/api/memory/profile", mergeProfile(memory.profile)),
    postJson("/api/memory/history", mergeHistory(memory.history)),
  ]);
}

export function buildMemoryContext(memory) {
  const profile = mergeProfile(memory?.profile);
  const history = mergeHistory(memory?.history);

  const favoriteTopics = profile.audienceProfile.favoriteTopics.length
    ? profile.audienceProfile.favoriteTopics.join(", ")
    : "none saved";
  const avoidTopics = profile.audienceProfile.avoidTopics.length
    ? profile.audienceProfile.avoidTopics.join(", ")
    : "none saved";
  const styleNotes = profile.audienceProfile.styleNotes.length
    ? profile.audienceProfile.styleNotes.join(", ")
    : "short paragraph jokes";
  const recentLearnings = profile.recentLearnings.length
    ? profile.recentLearnings.join(" | ")
    : "none saved";
  const recentHistory = history.entries.length
    ? history.entries
        .slice(-3)
        .map((entry) => `User asked: ${entry.userPrompt} | You answered: ${entry.assistantReply}`)
        .join("\n")
    : "No recent joke history saved.";

  return [
    `Preferred tone: ${profile.audienceProfile.tone}`,
    `Favorite topics: ${favoriteTopics}`,
    `Avoid topics: ${avoidTopics}`,
    `Style notes: ${styleNotes}`,
    `Recent learnings: ${recentLearnings}`,
    `Recent joke history:\n${recentHistory}`,
  ].join("\n");
}

export function updateMemoryFromTurn(memory, userPrompt, assistantReply) {
  const nextProfile = mergeProfile(memory?.profile);
  const nextHistory = mergeHistory(memory?.history);
  const trimmedPrompt = String(userPrompt ?? "").trim();
  const trimmedReply = String(assistantReply ?? "").trim();
  const now = new Date().toISOString();

  applyTonePreference(nextProfile, trimmedPrompt);
  applyTopicPreferences(nextProfile, trimmedPrompt);
  applyStylePreferences(nextProfile, trimmedPrompt);
  applyRecentLearnings(nextProfile, trimmedPrompt);

  if (trimmedPrompt || trimmedReply) {
    nextHistory.entries.push({
      timestamp: now,
      userPrompt: trimmedPrompt,
      assistantReply: trimmedReply,
    });
    nextHistory.entries = nextHistory.entries.slice(-10);
  }

  nextProfile.lastUpdated = now;
  nextHistory.lastUpdated = now;

  return {
    profile: nextProfile,
    history: nextHistory,
  };
}

function applyTonePreference(profile, prompt) {
  const lowered = prompt.toLowerCase();

  if (/(clean|family friendly|wholesome)/.test(lowered)) {
    profile.audienceProfile.tone = "clean and wholesome";
  } else if (/(dry|deadpan)/.test(lowered)) {
    profile.audienceProfile.tone = "dry and deadpan";
  } else if (/(silly|goofy)/.test(lowered)) {
    profile.audienceProfile.tone = "silly and playful";
  }
}

function applyTopicPreferences(profile, prompt) {
  const favoriteMatch = prompt.match(/(?:i like|i love|my favorite topics? (?:are|is)|joke about) ([^.!,\n]+)/i);
  if (favoriteMatch) {
    addCommaSeparatedValues(profile.audienceProfile.favoriteTopics, favoriteMatch[1]);
  }

  const avoidMatch = prompt.match(/(?:avoid|don't joke about|do not joke about|no jokes about) ([^.!,\n]+)/i);
  if (avoidMatch) {
    addCommaSeparatedValues(profile.audienceProfile.avoidTopics, avoidMatch[1]);
  }
}

function applyStylePreferences(profile, prompt) {
  const lowered = prompt.toLowerCase();

  if (lowered.includes("short paragraph")) {
    pushUnique(profile.audienceProfile.styleNotes, "short paragraph jokes");
  }

  if (lowered.includes("one paragraph")) {
    pushUnique(profile.audienceProfile.styleNotes, "one paragraph format");
  }
}

function applyRecentLearnings(profile, prompt) {
  const lowered = prompt.toLowerCase();

  if (/(audience|crowd|people)/.test(lowered) && prompt.trim()) {
    pushUnique(profile.recentLearnings, prompt.trim().slice(0, 180));
    profile.recentLearnings = profile.recentLearnings.slice(-6);
  }
}

function addCommaSeparatedValues(list, value) {
  for (const entry of value.split(/,| and /i)) {
    const cleaned = entry.trim().toLowerCase();
    if (cleaned) {
      pushUnique(list, cleaned);
    }
  }
}

function pushUnique(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

async function fetchJson(url, fallback) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return structuredClone(fallback);
    }

    return await response.json();
  } catch {
    return structuredClone(fallback);
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to save memory at ${url}`);
  }
}

function mergeProfile(profile) {
  return {
    ...structuredClone(DEFAULT_PROFILE),
    ...(profile ?? {}),
    audienceProfile: {
      ...DEFAULT_PROFILE.audienceProfile,
      ...(profile?.audienceProfile ?? {}),
      favoriteTopics: Array.isArray(profile?.audienceProfile?.favoriteTopics)
        ? [...profile.audienceProfile.favoriteTopics]
        : [...DEFAULT_PROFILE.audienceProfile.favoriteTopics],
      avoidTopics: Array.isArray(profile?.audienceProfile?.avoidTopics)
        ? [...profile.audienceProfile.avoidTopics]
        : [...DEFAULT_PROFILE.audienceProfile.avoidTopics],
      styleNotes: Array.isArray(profile?.audienceProfile?.styleNotes)
        ? [...profile.audienceProfile.styleNotes]
        : [...DEFAULT_PROFILE.audienceProfile.styleNotes],
    },
    recentLearnings: Array.isArray(profile?.recentLearnings) ? [...profile.recentLearnings] : [],
  };
}

function mergeHistory(history) {
  return {
    ...structuredClone(DEFAULT_HISTORY),
    ...(history ?? {}),
    entries: Array.isArray(history?.entries) ? [...history.entries] : [],
  };
}

const DEFAULT_PROFILE = {
  audienceProfile: {
    tone: "lighthearted",
    energy: "medium",
    edge: "playful",
    favoriteTopics: [],
    avoidTopics: [],
    styleNotes: ["short paragraph jokes"],
    preferredModes: [],
  },
  recentLearnings: [],
  callbackBank: [],
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
  const ap = profile.audienceProfile;

  const parts = [`Tone: ${ap.tone}/${ap.energy}/${ap.edge}`];

  if (ap.favoriteTopics.length) parts.push(`Likes: ${ap.favoriteTopics.slice(-3).join(", ")}`);
  if (ap.avoidTopics.length) parts.push(`Avoid: ${ap.avoidTopics.join(", ")}`);
  if (profile.callbackBank.length) parts.push(`Callbacks: ${profile.callbackBank.slice(-2).join(" | ")}`);

  const lastEntry = history.entries.at(-1);
  if (lastEntry) parts.push(`Last bit: "${lastEntry.assistantReply.slice(0, 80)}"`);

  return parts.join("\n");
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
  applyModePreferences(nextProfile, trimmedPrompt);
  applyRecentLearnings(nextProfile, trimmedPrompt);
  applyCallbackMemory(nextProfile, trimmedPrompt, trimmedReply);

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
    profile.audienceProfile.edge = "gentle";
  } else if (/(dry|deadpan)/.test(lowered)) {
    profile.audienceProfile.tone = "dry and deadpan";
    profile.audienceProfile.energy = "low";
  } else if (/(silly|goofy)/.test(lowered)) {
    profile.audienceProfile.tone = "silly and playful";
    profile.audienceProfile.energy = "high";
  } else if (/(sarcastic|snarky|edgy)/.test(lowered)) {
    profile.audienceProfile.tone = "sharp and sarcastic";
    profile.audienceProfile.edge = "spiky";
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

  if (/(short|quick|brief)/.test(lowered)) {
    pushUnique(profile.audienceProfile.styleNotes, "tight setup and payoff");
  }
}

function applyModePreferences(profile, prompt) {
  const lowered = prompt.toLowerCase();

  if (/(roast|make fun of)/.test(lowered)) {
    pushUnique(profile.audienceProfile.preferredModes, "roast");
  }

  if (/(headline|news desk|breaking news)/.test(lowered)) {
    pushUnique(profile.audienceProfile.preferredModes, "fake_headline");
  }

  if (/(story|anecdote)/.test(lowered)) {
    pushUnique(profile.audienceProfile.preferredModes, "story_bit");
  }

  if (/(one-liner|one liner)/.test(lowered)) {
    pushUnique(profile.audienceProfile.preferredModes, "one_liner");
  }

  if (/(observational|relatable)/.test(lowered)) {
    pushUnique(profile.audienceProfile.preferredModes, "observational");
  }
}

function applyRecentLearnings(profile, prompt) {
  const lowered = prompt.toLowerCase();

  if (/(audience|crowd|people|likes|prefers|hates|wants)/.test(lowered) && prompt.trim()) {
    pushUnique(profile.recentLearnings, prompt.trim().slice(0, 180));
    profile.recentLearnings = profile.recentLearnings.slice(-6);
  }
}

function applyCallbackMemory(profile, prompt, reply) {
  const callbackSource = [prompt, reply].filter(Boolean).join(" ");
  const lowered = callbackSource.toLowerCase();

  if (/(banana peel|coffee break|punchline|stage|crowd|trend|news desk)/.test(lowered)) {
    const snippet = callbackSource.trim().replace(/\s+/g, " ").slice(0, 100);
    if (snippet) {
      pushUnique(profile.callbackBank, snippet);
      profile.callbackBank = profile.callbackBank.slice(-6);
    }
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
    let errText = response.statusText;
    try {
      const errPayload = await response.json();
      if (errPayload.error) errText = errPayload.error;
    } catch {}
    throw new Error(`[${response.status}] ${errText}`);
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
      preferredModes: Array.isArray(profile?.audienceProfile?.preferredModes)
        ? [...profile.audienceProfile.preferredModes]
        : [...DEFAULT_PROFILE.audienceProfile.preferredModes],
    },
    recentLearnings: Array.isArray(profile?.recentLearnings) ? [...profile.recentLearnings] : [],
    callbackBank: Array.isArray(profile?.callbackBank) ? [...profile.callbackBank] : [],
  };
}

function mergeHistory(history) {
  return {
    ...structuredClone(DEFAULT_HISTORY),
    ...(history ?? {}),
    entries: Array.isArray(history?.entries) ? [...history.entries] : [],
  };
}

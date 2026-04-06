import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";
import "./styles.css";
import { createSpeechSynthesizer, DEFAULT_TTS_VOICE } from "./tts.js";
import { createAmbientMusic } from "./music.js";
import { COMEDY_SYSTEM_PROMPT } from "./agent/prompting.js";

// LangChain agent modules are loaded lazily after the model is ready
// to avoid the heavy bundle competing with WebGPU initialization.
let _agentModules = null;
async function getAgentModules() {
  if (!_agentModules) {
    const [agentMod, feedbackMod, modelMod] = await Promise.all([
      import("./agent/index.js"),
      import("./agent/feedback.js"),
      import("./agent/model.js"),
    ]);
    _agentModules = {
      createComedyAgent: agentMod.createComedyAgent,
      createFeedbackAgent: feedbackMod.createFeedbackAgent,
      LangChainGemmaAdapter: modelMod.LangChainGemmaAdapter,
    };
  }
  return _agentModules;
}

const modelFileInput = document.querySelector("#modelFile");
const maxTokensInput = document.querySelector("#maxTokens");
const topKInput = document.querySelector("#topK");
const temperatureInput = document.querySelector("#temperature");
const randomSeedInput = document.querySelector("#randomSeed");
const bundledModelSelect = document.querySelector("#bundledModelSelect");
const promptInput = document.querySelector("#promptInput");
const statusText = document.querySelector("#statusText");
const webgpuStatus = document.querySelector("#webgpuStatus");
const modelStatus = document.querySelector("#modelStatus");
const tokenStatus = document.querySelector("#tokenStatus");
const loadModelButton = document.querySelector("#loadModelButton");
const unloadModelButton = document.querySelector("#unloadModelButton");
const runButton = document.querySelector("#runButton");
const cancelButton = document.querySelector("#cancelButton");
const clearChatButton = document.querySelector("#clearChatButton");
const loadTtsButton = document.querySelector("#loadTtsButton");
const stopTtsButton = document.querySelector("#stopTtsButton");
const speakLastButton = document.querySelector("#speakLastButton");
const ttsVoiceSelect = document.querySelector("#ttsVoiceSelect");
const ttsSpeedInput = document.querySelector("#ttsSpeed");
const autoSpeakCheckbox = document.querySelector("#autoSpeak");
const toggleMusicButton = document.querySelector("#toggleMusicButton");
const musicVolumeInput = document.querySelector("#musicVolume");
const chatMessages = document.querySelector("#chatMessages");
const generatingIndicator = document.querySelector("#generatingIndicator");
const attachImageButton = document.querySelector("#attachImageButton");
const imagePreview = document.querySelector("#imagePreview");
const ttsStatus = document.querySelector("#ttsStatus");
const stageStateText = document.querySelector("#stageStateText");
const audienceMoodLabel = document.querySelector("#audienceMoodLabel");
const audienceMoodFill = document.querySelector("#audienceMoodFill");
const laughFeedbackText = document.querySelector("#laughFeedbackText");
const criticScoreText = document.querySelector("#criticScoreText");
const criticEmotionText = document.querySelector("#criticEmotionText");
const criticAdviceText = document.querySelector("#criticAdviceText");
const heckleStatusText = document.querySelector("#heckleStatusText");
const emojiReactions = document.querySelector("#emojiReactions");
const reactionButtons = [...document.querySelectorAll(".reaction-btn")];

const DEFAULT_MODEL_PATH = "/assets/gemma-4-E2B-it-web.task";
const SESSION_STATE_KEY = "gemma-comedy-session";
const BUNDLED_MODEL_LABELS = {
  "/assets/gemma-4-E2B-it-web.task": "Gemma 4 E2B Web",
  "/assets/gemma-4-E4B-it-web.task": "Gemma 4 E4B Web",
};

let llmInference;
let comedyAgent;
let feedbackAgent;
let isGenerating = false;
let activeModelSource;
let conversation = [];
let lastAssistantReply = "";
let setRunning = false;
let pendingAudienceInput = null;
let currentMoodScore = 18;
let recentAudienceSignals = [];
let wantsAmbientMusic = true;
let recreateInferencePromise = null;
let nextMessageId = 1;
let inferenceCooldownUntil = 0;
let latestCriticSnapshot = {
  score: 18,
  emotion: "warming up",
  advice: "Load the model and let the room react.",
  heckle: "No heckle yet.",
};

const PAUSE_BETWEEN_BITS_MS = 3000;
const INFERENCE_COOLDOWN_MS = 650;
const LAUGH_EMOJIS = ["😂", "🤣", "😄", "👏", "🎤"];

const speechSynthesizer = createSpeechSynthesizer({
  onStatus: setStatus,
});
const ambientMusic = createAmbientMusic({
  onStatus: setStatus,
});

speechSynthesis.cancel();
setWebGpuStatus();
restoreSessionState();
renderConversation();
syncUi();
syncMusicUi();
hideImageUi();
autoSpeakCheckbox.checked = true;
attemptAutoStartMusic();
preloadTts().then(() => loadModel());

loadModelButton.addEventListener("click", loadModel);
unloadModelButton.addEventListener("click", unloadModel);
runButton.addEventListener("click", submitAudienceInput);
cancelButton.addEventListener("click", toggleSet);
clearChatButton.addEventListener("click", clearChat);
loadTtsButton.addEventListener("click", preloadTts);
stopTtsButton.addEventListener("click", stopTtsPlayback);
speakLastButton.addEventListener("click", speakLastReply);
toggleMusicButton.addEventListener("click", toggleMusic);
musicVolumeInput.addEventListener("input", handleMusicVolumeChange);
for (const button of reactionButtons) {
  button.addEventListener("click", () => applyEmojiReaction(button.dataset.reaction, button.dataset.emoji));
}
promptInput.addEventListener("input", updatePromptTokens);
promptInput.addEventListener("input", autoResizeTextarea);
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitAudienceInput();
  }
});

function hideImageUi() {
  imagePreview.classList.add("hidden");
  imagePreview.innerHTML = "";
  attachImageButton.disabled = true;
  attachImageButton.title = "Agent mode is text-only";
}

function getTtsOptions() {
  return {
    voice: ttsVoiceSelect.value || DEFAULT_TTS_VOICE,
    speed: readFloat(ttsSpeedInput, 1),
  };
}

function autoResizeTextarea() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
}

function syncMusicUi() {
  toggleMusicButton.textContent = ambientMusic.playing ? "Pause music" : "Play music";
}

function installAutoplayRetry() {
  const retry = async () => {
    if (!wantsAmbientMusic || ambientMusic.playing) {
      return;
    }

    try {
      await ambientMusic.play();
    } catch {
      return;
    } finally {
      syncMusicUi();
    }

    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("keydown", retry);
  };

  window.addEventListener("pointerdown", retry, { once: true });
  window.addEventListener("keydown", retry, { once: true });
}

async function attemptAutoStartMusic() {
  if (!wantsAmbientMusic) {
    return;
  }

  try {
    await ambientMusic.play();
  } catch {
    setStatus("Ambient music is ready. Press Play music or interact once to start it.");
    installAutoplayRetry();
  } finally {
    syncMusicUi();
  }
}

function setWebGpuStatus() {
  // Only check if the API exists — don't call requestAdapter() here
  // because MediaPipe will request its own adapter during model load,
  // and multiple concurrent adapter requests can exhaust the GPU process.
  if (!("gpu" in navigator)) {
    setFactStatus(webgpuStatus, "error", "WebGPU: unavailable");
    setStatus("WebGPU is not available. Use a Chromium-based browser with WebGPU enabled.");
    return;
  }
  setFactStatus(webgpuStatus, "ok", "WebGPU: detected");
  setFactStatus(ttsStatus, "", "TTS: not loaded");
}

function setFactStatus(element, level, text) {
  element.className = level;
  element.textContent = text;
}

async function toggleMusic() {
  try {
    if (ambientMusic.playing) {
      wantsAmbientMusic = false;
      ambientMusic.pause();
    } else {
      wantsAmbientMusic = true;
      await ambientMusic.play();
    }
  } catch (error) {
    setStatus(`Music failed: ${getErrorMessage(error)}`);
  } finally {
    syncMusicUi();
  }
}

function handleMusicVolumeChange() {
  ambientMusic.setVolume(readFloat(musicVolumeInput, 0.18));
}

function setStageState(text) {
  stageStateText.textContent = text;
  saveSessionState();
}

function setAudienceMood(score, label, feedback) {
  const normalized = Math.max(8, Math.min(100, Math.round(score)));
  currentMoodScore = normalized;
  audienceMoodFill.style.width = `${normalized}%`;
  audienceMoodLabel.textContent = label;
  laughFeedbackText.textContent = feedback;
  saveSessionState();
}

function setCriticPanel({ score, emotion, advice, heckle }) {
  criticScoreText.textContent = `${Math.max(0, Math.min(100, Math.round(score ?? 0)))}/100`;
  criticEmotionText.textContent = emotion || "reading the room";
  criticAdviceText.textContent = advice || "The evaluator is waiting for a bit to score.";
  heckleStatusText.textContent = heckle || "No heckle. The crowd is letting it slide.";
  latestCriticSnapshot = {
    score: Math.max(0, Math.min(100, Math.round(score ?? 0))),
    emotion: emotion || "reading the room",
    advice: advice || "The evaluator is waiting for a bit to score.",
    heckle: heckle || "No heckle. The crowd is letting it slide.",
  };
  saveSessionState();
}

function setActiveReaction(reaction) {
  for (const button of reactionButtons) {
    button.classList.toggle("active", button.dataset.reaction === reaction);
  }
}

function pushAudienceSignal(signal) {
  const trimmed = String(signal ?? "").trim();
  if (!trimmed) {
    return;
  }

  recentAudienceSignals.push(trimmed);
  recentAudienceSignals = recentAudienceSignals.slice(-6);
  saveSessionState();
}

function triggerLaughBurst(count) {
  if (!emojiReactions) {
    return;
  }

  const safeCount = Math.max(1, Math.min(8, count));
  for (let i = 0; i < safeCount; i += 1) {
    const particle = document.createElement("span");
    particle.className = "emoji-particle";
    particle.textContent = LAUGH_EMOJIS[(Math.random() * LAUGH_EMOJIS.length) | 0];
    particle.style.left = `${Math.round((Math.random() - 0.5) * 180)}px`;
    particle.style.animationDelay = `${(Math.random() * 0.25).toFixed(2)}s`;
    emojiReactions.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove(), { once: true });
  }
}

function triggerSpecificEmojiBurst(emoji, count = 3) {
  if (!emojiReactions || !emoji) {
    return;
  }

  const safeCount = Math.max(1, Math.min(6, count));
  for (let i = 0; i < safeCount; i += 1) {
    const particle = document.createElement("span");
    particle.className = "emoji-particle";
    particle.textContent = emoji;
    particle.style.left = `${Math.round((Math.random() - 0.5) * 150)}px`;
    particle.style.animationDelay = `${(Math.random() * 0.18).toFixed(2)}s`;
    emojiReactions.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove(), { once: true });
  }
}

function getMoodPresentation(score, overrideFeedback) {
  return {
    label:
      score >= 78 ? "Audience mood: big laugh" :
      score >= 60 ? "Audience mood: strong chuckle" :
      score >= 42 ? "Audience mood: warm grin" :
      "Audience mood: polite smile",
    feedback:
      overrideFeedback || (
        score >= 78 ? "Big laugh. The room leans in for the next tag." :
        score >= 60 ? "Solid laugh. The bit has momentum." :
        score >= 42 ? "A few chuckles ripple through the room." :
        "The crowd is listening, but the next line needs a sharper punch."
      ),
  };
}

function applyMoodDelta(delta, feedback, reaction, emoji) {
  const nextScore = Math.max(8, Math.min(100, currentMoodScore + delta));
  const presentation = getMoodPresentation(nextScore, feedback);
  setAudienceMood(nextScore, presentation.label, presentation.feedback);
  if (reaction) {
    setActiveReaction(reaction);
  }
  if (emoji) {
    triggerSpecificEmojiBurst(emoji, Math.max(2, Math.round(Math.abs(delta) / 6)));
  }
}

function applyEmojiReaction(reaction, emoji) {
  const reactionMap = {
    love: { delta: 18, feedback: "The room erupts. That one really hit.", signal: "Audience reaction: huge laugh, keep pushing this angle." },
    laugh: { delta: 12, feedback: "Nice laugh. The audience wants another tag.", signal: "Audience reaction: strong laugh, a callback could land." },
    smile: { delta: 6, feedback: "Warm response. The room is with the comic.", signal: "Audience reaction: warm smile, the crowd is with you." },
    groan: { delta: -8, feedback: "A playful groan. The room wants a sharper turn.", signal: "Audience reaction: playful groan, pivot or sharpen the bit." },
    bomb: { delta: -16, feedback: "That one thudded. Time to pivot fast.", signal: "Audience reaction: that bombed, recover quickly with a new angle." },
  };
  const selected = reactionMap[reaction];
  if (!selected) {
    return;
  }

  pushAudienceSignal(selected.signal);
  applyMoodDelta(selected.delta, selected.feedback, reaction, emoji);
}

function analyzeAudienceTextFeedback(text) {
  const source = String(text ?? "").trim();
  const lowered = source.toLowerCase();
  let delta = 0;
  let feedback = "";

  if (!source) {
    return null;
  }

  if (/(love that|so funny|hilarious|amazing|killed|nailed it|that was great|🤣|😂|lmao|lol)/.test(lowered)) {
    delta += 14;
    feedback = "The audience text says the bit landed hard.";
  } else if (/(good one|funny|nice|pretty good|more like that|keep going)/.test(lowered)) {
    delta += 8;
    feedback = "The audience text gives the comic a real push.";
  }

  if (/(meh|not funny|weak|too much|too dark|too mean|bombed|bad joke|cringe)/.test(lowered)) {
    delta -= 14;
    feedback = "The audience text says the bit missed and needs a pivot.";
  } else if (/(okay|fine|hmm|maybe|not sure)/.test(lowered)) {
    delta -= 5;
    feedback = feedback || "The audience sounds unconvinced.";
  }

  if (/(i like|more of|talk about|do one about|joke about)/.test(lowered)) {
    delta += 4;
    feedback = feedback || "The audience is feeding the act with more material.";
  }

  if (!delta) {
    delta = /(thanks|hello|hi)/.test(lowered) ? 2 : 0;
    feedback = feedback || (delta ? "The audience is lightly engaged." : "");
  }

  return delta ? { delta, feedback, signal: `Audience text feedback: ${source.slice(0, 120)}` } : null;
}

function celebrateBitLanding(score) {
  const lastArticle = chatMessages.querySelector(".message.assistant:last-child");
  if (lastArticle) {
    lastArticle.classList.remove("joke-landed");
    void lastArticle.offsetWidth;
    lastArticle.classList.add("joke-landed");
  }

  const burstCount =
    score >= 78 ? 6 :
    score >= 60 ? 4 :
    score >= 42 ? 3 :
    2;
  triggerLaughBurst(burstCount);
}

async function loadModel() {
  const modelFile = modelFileInput.files?.[0];

  if (!("gpu" in navigator)) {
    setStatus("WebGPU is required for MediaPipe Web LLM inference.");
    return;
  }

  try {
    loadModelButton.disabled = true;
    const modelLabel = modelFile ? modelFile.name : bundledModelSelect.value || DEFAULT_MODEL_PATH;
    setStatus(`Loading ${modelLabel}...`);
    setFactStatus(modelStatus, "loading", "Model: loading...");

    unloadModel();

    if (modelFile) {
      activeModelSource = {
        label: modelFile.name,
        type: "buffer",
        value: new Uint8Array(await modelFile.arrayBuffer()),
      };
    } else {
      const selectedBundledModel = bundledModelSelect.value || DEFAULT_MODEL_PATH;
      activeModelSource = {
        label: BUNDLED_MODEL_LABELS[selectedBundledModel] ?? selectedBundledModel,
        type: "path",
        value: selectedBundledModel,
      };
    }

    llmInference = await createInference(activeModelSource);

    setStatus("Loading agent...");
    const { createComedyAgent, createFeedbackAgent, LangChainGemmaAdapter } = await getAgentModules();
    comedyAgent = createComedyAgent({
      model: new LangChainGemmaAdapter({
        getInference: () => llmInference,
        recreateInference,
        onStatus: setStatus,
      }),
      onStatus: setStatus,
    });
    feedbackAgent = createFeedbackAgent({
      model: new LangChainGemmaAdapter({
        getInference: () => llmInference,
        recreateInference,
        onStatus: setStatus,
      }),
      onStatus: setStatus,
    });

    setFactStatus(modelStatus, "ok", `Model: ${activeModelSource.label}`);
    setStatus("Model loaded. The comedian is taking the stage...");
    setStageState("Opening set");
    setAudienceMood(26, "Audience mood: settling in", "The mic is hot and the room is ready.");
    setCriticPanel({
      score: 18,
      emotion: "warming up",
      advice: "The evaluator will score each finished bit.",
      heckle: "No heckle yet.",
    });
    // Give the freshly loaded engine extra settling time
    markInferenceCooldown(INFERENCE_COOLDOWN_MS * 2);
    updatePromptTokens();
    syncUi();

    // Start the continuous comedy set
    startSet();
  } catch (error) {
    setFactStatus(modelStatus, "error", "Model: failed to load");
    setStatus(`Load failed: ${getErrorMessage(error)}`);
    llmInference?.close();
    llmInference = undefined;
    comedyAgent = undefined;
  } finally {
    syncUi();
  }
}

async function recreateInference() {
  if (recreateInferencePromise) {
    return recreateInferencePromise;
  }
  if (!activeModelSource) {
    throw new Error("No active model source to recreate.");
  }

  recreateInferencePromise = (async () => {
    llmInference?.close();
    llmInference = await createInference(activeModelSource);
    const { createComedyAgent, createFeedbackAgent, LangChainGemmaAdapter } = await getAgentModules();
    comedyAgent = createComedyAgent({
      model: new LangChainGemmaAdapter({
        getInference: () => llmInference,
        recreateInference,
        onStatus: setStatus,
      }),
      onStatus: setStatus,
    });
    feedbackAgent = createFeedbackAgent({
      model: new LangChainGemmaAdapter({
        getInference: () => llmInference,
        recreateInference,
        onStatus: setStatus,
      }),
      onStatus: setStatus,
    });
    markInferenceCooldown();
    setFactStatus(modelStatus, "ok", `Model: ${activeModelSource.label}`);
    syncUi();
  })();

  try {
    await recreateInferencePromise;
  } finally {
    recreateInferencePromise = null;
  }
}

function unloadModel() {
  setRunning = false;
  pendingAudienceInput = null;
  speechSynthesizer.stop();
  ambientMusic.pause();

  if (llmInference) {
    llmInference.close();
    llmInference = undefined;
  }

  comedyAgent = undefined;
  feedbackAgent = undefined;
  isGenerating = false;
  activeModelSource = undefined;
  recreateInferencePromise = null;
  inferenceCooldownUntil = 0;
  setCriticPanel({
    score: 18,
    emotion: "offline",
    advice: "Load the model to re-enable the crowd judge.",
    heckle: "No heckle while the stage is dark.",
  });
  setFactStatus(modelStatus, "", "Model: not loaded");
  tokenStatus.className = "";
  tokenStatus.textContent = "Chat tokens: n/a";
  syncUi();
}

async function createInference(modelSource) {
  const wasmFileset = await FilesetResolver.forGenAiTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm",
  );
  const baseOptions =
    modelSource.type === "buffer"
      ? { modelAssetBuffer: modelSource.value, delegate: "GPU" }
      : { modelAssetPath: modelSource.value, delegate: "GPU" };

  return LlmInference.createFromOptions(wasmFileset, {
    baseOptions,
    maxTokens: readNumber(maxTokensInput, 1024),
    topK: readNumber(topKInput, 40),
    temperature: readFloat(temperatureInput, 0.8),
    randomSeed: readNumber(randomSeedInput, 101),
  });
}

// ── Audience input ──
// The user types something and hits send; it gets queued for the next bit.
function submitAudienceInput() {
  const text = promptInput.value.trim();
  if (!text) return;

  pendingAudienceInput = text;
  setStageState("Taking audience suggestion");
  const textReaction = analyzeAudienceTextFeedback(text);
  if (textReaction) {
    pushAudienceSignal(textReaction.signal);
    applyMoodDelta(textReaction.delta, textReaction.feedback, null, textReaction.delta > 0 ? "💬" : "😶");
  } else {
    setAudienceMood(Math.max(currentMoodScore, 55), "Audience mood: engaged", "The crowd tossed in a new angle.");
  }
  conversation.push(createMessage("user", text));
  promptInput.value = "";
  autoResizeTextarea();
  renderConversation();
  saveSessionState();

  // If the set is paused or between bits, kick it off immediately
  if (!setRunning) {
    startSet();
  }
}

// ── Set loop ──
// The comedian keeps going: opener → bit → bit → bit...
// Between bits, checks if the user said something. If so, uses it.
// If not, freestyles the next bit.

async function startSet() {
  if (setRunning || !comedyAgent) return;
  setRunning = true;
  setStageState("Performing");
  syncUi();

  // If no conversation yet, open the set first
  if (!conversation.some((m) => m.role === "assistant")) {
    await runOneBit(async (streamer) => {
      setStageState("Opening set");
      return comedyAgent.opener({
        onToken: (partialText) => {
          streamer.feed(partialText);
        },
      });
    });
  }

  // Main set loop
  while (setRunning && comedyAgent) {
    // Wait between bits (but check for pause)
    await waitBetweenBits();
    if (!setRunning) break;

    // Grab any pending audience input
    const userInput = pendingAudienceInput;
    pendingAudienceInput = null;
    setStageState(userInput ? "Working the crowd" : "Building next bit");

    await runOneBit(async (streamer) => {
      return comedyAgent.nextBit({
        userInput: userInput || null,
        audienceSignals: [...recentAudienceSignals],
        conversation: conversation.filter((message) => message.role !== "critic"),
        onToken: (partialText) => {
          streamer.feed(partialText);
        },
        onToolUse: ({ tool, query, status, result }) => {
          if (status === "searching") {
            currentAssistantMessage.toolInfo = `<div class="tool-sources"><p>🔍 Searching: "${escapeHtml(query)}"...</p></div>`;
          } else if (status === "done") {
            currentAssistantMessage.toolInfo = formatSearchSources(query, result);
          }
          updateLastAssistantMessage(currentAssistantMessage);
        },
      });
    });
  }
}

let currentAssistantMessage = null;

async function runOneBit(agentCall, { evaluateWithCrowd = true } = {}) {
  await waitForInferenceCooldown();

  const assistantMessage = createMessage("assistant", "");
  currentAssistantMessage = assistantMessage;
  conversation.push(assistantMessage);
  renderConversation();
  saveSessionState();

  try {
    isGenerating = true;
    generatingIndicator.classList.add("active");
    syncUi();

    const streamer = speechSynthesizer.createStreamSpeaker({
      ...getTtsOptions(),
      onReveal: (visibleText) => {
        assistantMessage.text = keepLongestText(assistantMessage.text, visibleText);
        updateLastAssistantMessage(assistantMessage);
      },
    });
    const result = await agentCall(streamer);

    lastAssistantReply = result.output;
    streamer.flush(result.output);
    // Ensure full text is visible after all speech finishes
    assistantMessage.text = keepLongestText(assistantMessage.text, result.output);
    let evaluation = null;
    try {
      if (evaluateWithCrowd && feedbackAgent) {
        // Wait for the inference engine to settle after the comedy bit
        markInferenceCooldown();
        await waitForInferenceCooldown();
        evaluation = await evaluateWithRetry({
          joke: result.output,
          audienceSignals: [...recentAudienceSignals],
          conversation: [...conversation],
        });
        markInferenceCooldown();
        conversation.push(createMessage("critic", formatCriticSummary(evaluation)));
        renderConversation();
        applyCrowdEvaluation(evaluation);
      } else {
        setStageState("Punchline landed");
        setAudienceMood(55, "Audience mood: holding", "The room is waiting for the next beat.");
      }
    } catch (feedbackError) {
      setStageState("Punchline landed");
      setAudienceMood(55, "Audience mood: mixed room", "The joke landed, but the crowd judge missed its cue.");
      setCriticPanel({
        score: 55,
        emotion: "judge offline",
        advice: "Evaluator failed. Falling back to live set mode.",
        heckle: "No heckle because the judge missed the beat.",
      });
      setStatus(`Bit delivered, but feedback failed: ${getErrorMessage(feedbackError)}`);
    }

    setStatus(
      result.usedTools?.length
        ? `Bit delivered (used ${result.usedTools.join(", ")}). The set continues...`
        : "The set continues...",
    );
    saveSessionState();

    if (evaluateWithCrowd && shouldTriggerHeckle(evaluation)) {
      await triggerCrowdHeckleRecovery(evaluation);
    }
  } catch (error) {
    if (assistantMessage.text.trim()) {
      // Keep the partial message if it already generated something
      assistantMessage.text += `\n\n*(Bit interrupted: ${getErrorMessage(error)})*`;
      updateLastAssistantMessage(assistantMessage);
    } else {
      // Only pop if it failed before generating any text
      conversation.pop();
    }
    setStatus(`Bit failed: ${getErrorMessage(error)}`);
    saveSessionState();
  } finally {
    isGenerating = false;
    currentAssistantMessage = null;
    generatingIndicator.classList.remove("active");
    renderConversation();
    updatePromptTokens();
    syncUi();
  }
}

function waitBetweenBits() {
  return new Promise((resolve) => {
    // If user already has something queued, skip the wait
    if (pendingAudienceInput) {
      resolve();
      return;
    }
    setTimeout(async () => {
      await waitForSpeechPlayback();
      resolve();
    }, PAUSE_BETWEEN_BITS_MS);
  });
}

function pauseSet() {
  if (isGenerating) {
    comedyAgent?.cancel();
    llmInference?.cancelProcessing();
    markInferenceCooldown();
  }
  setRunning = false;
  speechSynthesizer.stop();
  setStageState("Paused");
  setAudienceMood(22, "Audience mood: paused", "The comic is holding for the next cue.");
  setActiveReaction(null);
  setStatus("Set paused. Type something or click Resume to continue.");
  syncUi();
}

function toggleSet() {
  if (setRunning) {
    pauseSet();
  } else if (comedyAgent) {
    startSet();
  }
}

function clearChat() {
  if (isGenerating) return;

  setRunning = false;
  pendingAudienceInput = null;
  speechSynthesizer.stop();
  ambientMusic.pause();
  conversation = [];
  lastAssistantReply = "";
  recentAudienceSignals = [];
  latestCriticSnapshot = {
    score: 18,
    emotion: "warming up",
    advice: "The evaluator will score each finished bit.",
    heckle: "No heckle yet.",
  };
  setStageState("Resetting set");
  setAudienceMood(20, "Audience mood: resetting", "Fresh crowd, fresh opener.");
  setCriticPanel(latestCriticSnapshot);
  setActiveReaction(null);
  renderConversation();
  updatePromptTokens();
  setStatus("Chat cleared. The comedian will restart the set.");
  syncUi();
  saveSessionState();

  // Restart the set from the opener
  if (comedyAgent) startSet();
}

async function preloadTts() {
  try {
    loadTtsButton.disabled = true;
    setFactStatus(ttsStatus, "loading", "TTS: loading...");
    await speechSynthesizer.preload();
    setFactStatus(ttsStatus, "ok", "TTS: ready");
  } catch (error) {
    setFactStatus(ttsStatus, "error", "TTS: failed");
    setStatus(`TTS load failed: ${getErrorMessage(error)}`);
  } finally {
    syncUi();
  }
}

async function speakText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return;
  }

  try {
    if (!speechSynthesizer.loaded) {
      setFactStatus(ttsStatus, "loading", "TTS: loading...");
    }

    await speechSynthesizer.speak(trimmed, getTtsOptions());
    setFactStatus(ttsStatus, "ok", "TTS: speaking");
  } catch (error) {
    setFactStatus(ttsStatus, "error", "TTS: failed");
    setStatus(`TTS failed: ${getErrorMessage(error)}`);
  } finally {
    syncUi();
  }
}

async function speakLastReply() {
  await speakText(lastAssistantReply);
}

function stopTtsPlayback() {
  speechSynthesizer.stop();
  if (speechSynthesizer.loaded) {
    setFactStatus(ttsStatus, "ok", "TTS: ready");
  } else {
    setFactStatus(ttsStatus, "", "TTS: not loaded");
  }
  syncUi();
}

function renderConversation() {
  if (conversation.length === 0) {
    chatMessages.innerHTML = `
      <article class="message assistant">
        <p class="message-role">Gemma Comedy Agent</p>
        <div class="message-body"><p>Loading the model... the comedian will start a continuous set. Just sit back and enjoy, or type something to steer the next joke!</p></div>
      </article>
    `;
    saveSessionState();
    return;
  }

  chatMessages.innerHTML = conversation
    .map((message, index) => {
      const isLast = index === conversation.length - 1;
      const isStreaming = isLast && message.role === "assistant" && isGenerating;
      const roleLabel =
        message.role === "assistant" ? "Gemma Comedy Agent" :
        message.role === "crowd" ? "Crowd Heckle" :
        message.role === "critic" ? "Crowd Judge" :
        "You";
      const extraClass = isStreaming ? " streaming" : "";

      return `
        <article class="message ${message.role}${extraClass}" data-message-id="${escapeHtml(String(message.id ?? ""))}">
          <p class="message-role">${escapeHtml(roleLabel)}</p>
          <div class="message-body">${formatMessageText(message)}</div>
        </article>
      `;
    })
    .join("");

  chatMessages.scrollTop = chatMessages.scrollHeight;
  saveSessionState();
}

function updateLastAssistantMessage(message) {
  const messageId = message?.id;
  if (messageId == null) {
    return;
  }

  const targetArticle = chatMessages.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
  if (!targetArticle) {
    return;
  }

  const body = targetArticle.querySelector(".message-body");
  if (body) {
    body.innerHTML = formatMessageText(message);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
  saveSessionState();
}

function restoreSessionState() {
  let restored = false;

  try {
    const raw = window.sessionStorage.getItem(SESSION_STATE_KEY);
    if (!raw) {
      throw new Error("No saved session");
    }

    const parsed = JSON.parse(raw);
    conversation = Array.isArray(parsed.conversation)
      ? parsed.conversation
          .filter((message) => message && ["user", "assistant", "crowd", "critic"].includes(message.role))
          .slice(-12)
          .map((message) => ({
            id: Number.isFinite(message.id) ? message.id : nextMessageId++,
            role: message.role,
            text: typeof message.text === "string" ? message.text : "",
            toolInfo: typeof message.toolInfo === "string" ? message.toolInfo : "",
          }))
      : [];
    nextMessageId = conversation.reduce((maxId, message) => Math.max(maxId, Number(message.id) || 0), 0) + 1;
    lastAssistantReply = typeof parsed.lastAssistantReply === "string" ? parsed.lastAssistantReply : "";
    recentAudienceSignals = Array.isArray(parsed.recentAudienceSignals)
      ? parsed.recentAudienceSignals.filter((item) => typeof item === "string").slice(-6)
      : [];
    wantsAmbientMusic = parsed.wantsAmbientMusic !== false;

    const score = Number.isFinite(parsed.currentMoodScore) ? parsed.currentMoodScore : 18;
    const stageText = typeof parsed.stageStateText === "string" && parsed.stageStateText.trim()
      ? parsed.stageStateText
      : "Warming up";
    const moodLabel = typeof parsed.audienceMoodLabel === "string" && parsed.audienceMoodLabel.trim()
      ? parsed.audienceMoodLabel
      : "Audience mood: waiting";
    const moodFeedback = typeof parsed.laughFeedbackText === "string" && parsed.laughFeedbackText.trim()
      ? parsed.laughFeedbackText
      : "The room is settling in.";

    currentMoodScore = score;
    stageStateText.textContent = stageText;
    audienceMoodFill.style.width = `${Math.max(8, Math.min(100, Math.round(score)))}%`;
    audienceMoodLabel.textContent = moodLabel;
    laughFeedbackText.textContent = moodFeedback;
    latestCriticSnapshot = {
      score: Number.isFinite(parsed.criticScore) ? parsed.criticScore : 18,
      emotion: typeof parsed.criticEmotion === "string" && parsed.criticEmotion.trim()
        ? parsed.criticEmotion
        : "warming up",
      advice: typeof parsed.criticAdvice === "string" && parsed.criticAdvice.trim()
        ? parsed.criticAdvice
        : "The evaluator is waiting for a bit to score.",
      heckle: typeof parsed.heckleStatus === "string" && parsed.heckleStatus.trim()
        ? parsed.heckleStatus
        : "No heckle yet.",
    };
    setCriticPanel(latestCriticSnapshot);
    restored = true;
  } catch {
    stageStateText.textContent = "Warming up";
    audienceMoodFill.style.width = "18%";
    audienceMoodLabel.textContent = "Audience mood: waiting";
    laughFeedbackText.textContent = "The room is settling in.";
    setCriticPanel({
      score: 18,
      emotion: "warming up",
      advice: "The evaluator is waiting for a bit to score.",
      heckle: "No heckle yet.",
    });
  }

  return restored;
}

function saveSessionState() {
  try {
    window.sessionStorage.setItem(
      SESSION_STATE_KEY,
      JSON.stringify({
        conversation,
        lastAssistantReply,
        currentMoodScore,
        recentAudienceSignals,
        wantsAmbientMusic,
        stageStateText: stageStateText.textContent,
        audienceMoodLabel: audienceMoodLabel.textContent,
        laughFeedbackText: laughFeedbackText.textContent,
        criticScore: latestCriticSnapshot.score,
        criticEmotion: latestCriticSnapshot.emotion,
        criticAdvice: latestCriticSnapshot.advice,
        heckleStatus: latestCriticSnapshot.heckle,
      }),
    );
  } catch {
    // Ignore storage failures so the live set keeps running.
  }
}

function applyCrowdEvaluation(evaluation) {
  const presentation = getFeedbackPresentation(evaluation);
  const reactionToButton = {
    erupting_laugh: "love",
    strong_laugh: "laugh",
    chuckle: "smile",
    mixed: null,
    groan: "groan",
    silence: "bomb",
    bomb: "bomb",
  };

  setStageState("Punchline judged");
  setAudienceMood(presentation.score, presentation.label, presentation.feedback);
  setActiveReaction(reactionToButton[evaluation.reaction] ?? null);
  setCriticPanel({
    score: evaluation.score,
    emotion: evaluation.emotion,
    advice: evaluation.advice,
    heckle: evaluation.shouldHeckle && evaluation.heckle
      ? `Heckle ready: ${evaluation.heckle}`
      : "No heckle. The crowd lets the joke breathe.",
  });
  pushAudienceSignal(`Crowd judge: ${evaluation.verdict} Emotion: ${evaluation.emotion}. Advice: ${evaluation.advice}`);

  // Trigger the judge's specific emotion emojis instead of generic laughs
  const emojis = Array.isArray(evaluation.emojis) ? evaluation.emojis : [];
  if (emojis.length > 0) {
    for (const emoji of emojis) {
      triggerSpecificEmojiBurst(emoji, presentation.burstCount);
    }
  } else {
    celebrateBitLanding(presentation.score);
  }

  // Glow effect on the last assistant message
  const lastArticle = chatMessages.querySelector(".message.assistant:last-child");
  if (lastArticle) {
    lastArticle.classList.remove("joke-landed");
    void lastArticle.offsetWidth;
    lastArticle.classList.add("joke-landed");
  }
}

function formatCriticSummary(evaluation) {
  const score = Math.max(0, Math.min(100, Math.round(evaluation?.score ?? 0)));
  const verdict = String(evaluation?.verdict ?? "").trim() || "Mixed room.";
  const emotion = String(evaluation?.emotion ?? "").trim() || "uncertain room";
  const advice = String(evaluation?.advice ?? "").trim() || "Tighten the next punch.";
  const heckle = evaluation?.shouldHeckle && evaluation?.heckle
    ? `Heckle: ${evaluation.heckle}`
    : "Heckle: none";
  const emojis = Array.isArray(evaluation?.emojis) ? evaluation.emojis.join("") : "";
  return `${emojis} Crowd score ${score}/100. ${verdict} Emotion: ${emotion}. Advice: ${advice}. ${heckle}`;
}

function shouldTriggerHeckle(evaluation) {
  return Boolean(
    evaluation
    && evaluation.shouldHeckle
    && evaluation.heckle
    && evaluation.score <= 45
    && comedyAgent,
  );
}

async function triggerCrowdHeckleRecovery(evaluation) {
  const heckle = String(evaluation?.heckle ?? "").trim();
  if (!heckle || !comedyAgent) {
    return;
  }

  pushAudienceSignal(`Crowd heckle: ${heckle}`);
  conversation.push(createMessage("crowd", heckle));
  renderConversation();
  saveSessionState();
  setStageState("Crowd heckle");
  // Let the inference engine settle before the comedy agent defends
  markInferenceCooldown();
  await waitForInferenceCooldown();
  setCriticPanel({
    score: evaluation.score,
    emotion: evaluation.emotion,
    advice: evaluation.advice,
    heckle: `Crowd heckle: ${heckle}`,
  });

  await runOneBit(
    (streamer) => comedyAgent.defendAgainstHeckle({
      heckle,
      audienceSignals: [...recentAudienceSignals, `Critic advice: ${evaluation.advice}`],
      conversation: conversation.filter((message) => message.role !== "critic"),
      onToken: (partialText) => {
        streamer.feed(partialText);
      },
    }),
    { evaluateWithCrowd: false },
  );
}

function createMessage(role, text = "") {
  return {
    id: nextMessageId++,
    role,
    text,
  };
}

function getFeedbackPresentation(evaluation) {
  const score = Math.max(0, Math.min(100, Math.round(evaluation?.score ?? 0)));
  const reaction = String(evaluation?.reaction ?? "").trim().toLowerCase();
  const verdict = String(evaluation?.verdict ?? "").trim();
  const emotion = String(evaluation?.emotion ?? "").trim() || "uncertain room";

  const label =
    reaction === "erupting_laugh" || score >= 86 ? "Audience mood: eruption" :
    reaction === "strong_laugh" || score >= 70 ? "Audience mood: strong laugh" :
    reaction === "chuckle" || score >= 56 ? "Audience mood: chuckling" :
    reaction === "mixed" || score >= 42 ? "Audience mood: mixed room" :
    reaction === "groan" || score >= 28 ? "Audience mood: groans" :
    reaction === "silence" ? "Audience mood: tense silence" :
    "Audience mood: bombed";

  const feedback = verdict || `The room feels ${emotion}.`;
  const burstCount =
    reaction === "erupting_laugh" || score >= 86 ? 7 :
    reaction === "strong_laugh" || score >= 70 ? 5 :
    reaction === "chuckle" || score >= 56 ? 4 :
    reaction === "mixed" || score >= 42 ? 3 :
    2;

  return { score, label, feedback, burstCount };
}

function keepLongestText(currentText, nextText) {
  const current = String(currentText ?? "");
  const next = String(nextText ?? "");
  return next.length >= current.length ? next : current;
}

async function evaluateWithRetry(params, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await feedbackAgent.evaluateBit(params);
    } catch (err) {
      if (attempt < retries) {
        setStatus("Judge missed the cue — retrying...");
        await delay(INFERENCE_COOLDOWN_MS * 2);
      } else {
        throw err;
      }
    }
  }
}

function markInferenceCooldown(durationMs = INFERENCE_COOLDOWN_MS) {
  inferenceCooldownUntil = Math.max(inferenceCooldownUntil, Date.now() + durationMs);
}

async function waitForInferenceCooldown() {
  const remainingMs = inferenceCooldownUntil - Date.now();
  if (remainingMs > 0) {
    setStatus("Giving the model a moment to settle before the next bit...");
    await delay(remainingMs);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSpeechPlayback(timeoutMs = 8000) {
  if (!("speechSynthesis" in window)) {
    return;
  }

  const startedAt = Date.now();
  while ((speechSynthesis.speaking || speechSynthesis.pending) && Date.now() - startedAt < timeoutMs) {
    await delay(120);
  }
}

function updatePromptTokens() {
  if (!llmInference) {
    tokenStatus.textContent = "Chat tokens: n/a";
    return;
  }

  if (isGenerating || recreateInferencePromise) {
    tokenStatus.textContent = "Chat tokens: busy";
    return;
  }

  try {
    const pendingPrompt = promptInput.value.trim();
    const draftConversation = pendingPrompt
      ? [...conversation, { role: "user", text: pendingPrompt }]
      : conversation;
    const prompt = buildPromptFromMessages(draftConversation);
    const size = llmInference.sizeInTokens(prompt);
    tokenStatus.textContent = `Chat tokens: ${size ?? "unknown"}`;
  } catch {
    tokenStatus.textContent = "Chat tokens: unavailable";
  }
}

function buildPromptFromMessages(messages) {
  let prompt = `<start_of_turn>user\n${COMEDY_SYSTEM_PROMPT}<end_of_turn>\n`;

  for (const message of messages) {
    if (!message.text?.trim()) {
      continue;
    }

    if (message.role === "critic") {
      continue;
    }

    const role = message.role === "assistant" ? "model" : "user";
    prompt += `<start_of_turn>${role}\n${message.text}<end_of_turn>\n`;
  }

  prompt += "<start_of_turn>model\n";
  return prompt;
}

function syncUi() {
  const modelLoaded = Boolean(llmInference);
  const hasReplyToSpeak = Boolean(lastAssistantReply.trim());

  loadModelButton.disabled = isGenerating || setRunning;
  unloadModelButton.disabled = !modelLoaded || isGenerating;
  // Send button: always enabled when model is loaded (queues input for next bit)
  runButton.disabled = !modelLoaded;
  // Cancel button becomes Pause/Resume
  cancelButton.disabled = !modelLoaded;
  cancelButton.textContent = setRunning ? "Pause" : "Resume";
  clearChatButton.disabled = isGenerating;
  loadTtsButton.disabled = isGenerating;
  stopTtsButton.disabled = !speechSynthesizer.loaded;
  speakLastButton.disabled = isGenerating || !hasReplyToSpeak;
  modelFileInput.disabled = isGenerating || setRunning;
  bundledModelSelect.disabled = isGenerating || setRunning;
  maxTokensInput.disabled = modelLoaded || isGenerating;
  topKInput.disabled = modelLoaded || isGenerating;
  temperatureInput.disabled = modelLoaded || isGenerating;
  randomSeedInput.disabled = modelLoaded || isGenerating;
  // Prompt input: always enabled so user can type while agent is performing
  promptInput.disabled = !modelLoaded;
  ttsVoiceSelect.disabled = isGenerating;
  ttsSpeedInput.disabled = isGenerating;
  autoSpeakCheckbox.disabled = isGenerating;
  toggleMusicButton.disabled = false;
  musicVolumeInput.disabled = false;
  attachImageButton.disabled = true;
  attachImageButton.title = "Agent mode is text-only";
  syncMusicUi();
}

function setStatus(message) {
  statusText.textContent = message;
}

function readNumber(input, fallback) {
  const value = Number.parseInt(input.value, 10);
  return Number.isFinite(value) ? value : fallback;
}

function readFloat(input, fallback) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSearchSources(query, result) {
  if (!result) return "";
  const lines = String(result).split("\n").filter(l => l.trim());
  const sources = lines.map(line => {
    const match = line.match(/^\d+\.\s*(.+?):\s*(.+)$/);
    if (match) return `<li><strong>${decodeAndEscape(match[1])}</strong>: ${decodeAndEscape(match[2].slice(0, 100))}</li>`;
    return `<li>${decodeAndEscape(line.slice(0, 120))}</li>`;
  }).join("");
  return `<div class="tool-sources"><p>🔍 Searched: "${escapeHtml(query)}"</p><ul>${sources}</ul></div>`;
}

function decodeAndEscape(text) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return escapeHtml(textarea.value);
}

function formatMessageText(message) {
  const toolInfo = message.toolInfo || "";
  const text = message.text || (message.role === "assistant" ? "..." : "");
  const normalized = escapeHtml(text).replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim() !== "");

  if (blocks.length === 0) {
    return toolInfo || "<p>...</p>";
  }

  return toolInfo + blocks
    .map((block) => {
      const trimmed = block.trim();

      if (/^\*{3,}$/.test(trimmed)) {
        return '<hr class="message-rule" />';
      }

      if (/^\*\*(.+)\*\*$/.test(trimmed)) {
        const content = trimmed.replace(/^\*\*(.+)\*\*$/, "$1");
        return `<h3>${applyInlineFormatting(content)}</h3>`;
      }

      if (isStandaloneTitle(trimmed)) {
        return `<h4>${applyInlineFormatting(trimmed)}</h4>`;
      }

      return `<p>${applyInlineFormatting(trimmed).replace(/\n/g, "<br />")}</p>`;
    })
    .join("");
}

function applyInlineFormatting(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function isStandaloneTitle(text) {
  if (text.includes("\n") || text.length > 60) {
    return false;
  }

  return /^[A-Z][A-Za-z0-9 !?',".:-]*$/.test(text);
}

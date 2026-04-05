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
    const [agentMod, modelMod] = await Promise.all([
      import("./agent/index.js"),
      import("./agent/model.js"),
    ]);
    _agentModules = {
      createComedyAgent: agentMod.createComedyAgent,
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
const emojiReactions = document.querySelector("#emojiReactions");
const reactionButtons = [...document.querySelectorAll(".reaction-btn")];

const DEFAULT_MODEL_PATH = "/assets/gemma-4-E2B-it-web.task";
const BUNDLED_MODEL_LABELS = {
  "/assets/gemma-4-E2B-it-web.task": "Gemma 4 E2B Web",
  "/assets/gemma-4-E4B-it-web.task": "Gemma 4 E4B Web",
};

let llmInference;
let comedyAgent;
let isGenerating = false;
let activeModelSource;
let conversation = [];
let lastAssistantReply = "";
let setRunning = false;
let pendingAudienceInput = null;
let currentMoodScore = 18;
let recentAudienceSignals = [];
let wantsAmbientMusic = true;

const PAUSE_BETWEEN_BITS_MS = 3000;
const LAUGH_EMOJIS = ["😂", "🤣", "😄", "👏", "🎤"];

const speechSynthesizer = createSpeechSynthesizer({
  onStatus: setStatus,
});
const ambientMusic = createAmbientMusic({
  onStatus: setStatus,
});

speechSynthesis.cancel();
setWebGpuStatus();
setStageState("Warming up");
setAudienceMood(18, "Audience mood: waiting", "The room is settling in.");
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
}

function setAudienceMood(score, label, feedback) {
  const normalized = Math.max(8, Math.min(100, Math.round(score)));
  currentMoodScore = normalized;
  audienceMoodFill.style.width = `${normalized}%`;
  audienceMoodLabel.textContent = label;
  laughFeedbackText.textContent = feedback;
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
}

function evaluateLaughResponse(text) {
  const source = String(text ?? "");
  const lowered = source.toLowerCase();
  let score = 34 + Math.min(18, Math.floor(source.length / 22));

  if (/[!?]{2,}/.test(source)) score += 10;
  if (/callback|crowd|heckle|trend|banana|stage|punchline/.test(lowered)) score += 8;
  if (/why|because|like|basically|imagine|it's like/.test(lowered)) score += 7;
  if (/(absurd|ridiculous|chaos|insane|wild)/.test(lowered)) score += 6;

  const label =
    score >= 78 ? "Audience mood: big laugh" :
    score >= 60 ? "Audience mood: strong chuckle" :
    score >= 42 ? "Audience mood: warm grin" :
    "Audience mood: polite smile";
  const feedback =
    score >= 78 ? "Big laugh. The room leans in for the next tag." :
    score >= 60 ? "Solid laugh. The bit has momentum." :
    score >= 42 ? "A few chuckles ripple through the room." :
    "The crowd is listening, but the next line needs a sharper punch.";

  return {
    score,
    label,
    feedback,
    burstCount: score >= 78 ? 6 : score >= 60 ? 4 : score >= 42 ? 3 : 2,
  };
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
    const { createComedyAgent, LangChainGemmaAdapter } = await getAgentModules();
    comedyAgent = createComedyAgent({
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
  if (!activeModelSource) {
    throw new Error("No active model source to recreate.");
  }

  llmInference?.close();
  llmInference = await createInference(activeModelSource);
  const { createComedyAgent, LangChainGemmaAdapter } = await getAgentModules();
  comedyAgent = createComedyAgent({
    model: new LangChainGemmaAdapter({
      getInference: () => llmInference,
      recreateInference,
      onStatus: setStatus,
    }),
    onStatus: setStatus,
  });
  setFactStatus(modelStatus, "ok", `Model: ${activeModelSource.label}`);
  syncUi();
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
  isGenerating = false;
  activeModelSource = undefined;
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
  conversation.push({ role: "user", text });
  promptInput.value = "";
  autoResizeTextarea();
  renderConversation();

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
        conversation: [...conversation],
        onToken: (partialText) => {
          streamer.feed(partialText);
        },
        onToolUse: ({ tool, query, status, result }) => {
          if (status === "searching") {
            currentAssistantMessage.toolInfo = `<div class="tool-sources"><p>🔍 Searching: "${escapeHtml(query)}"...</p></div>`;
            currentAssistantMessage.text = "";
          } else if (status === "done") {
            currentAssistantMessage.toolInfo = formatSearchSources(query, result);
            currentAssistantMessage.text = "";
          }
          updateLastAssistantMessage(currentAssistantMessage);
        },
      });
    });
  }
}

let currentAssistantMessage = null;

async function runOneBit(agentCall) {
  const assistantMessage = { role: "assistant", text: "" };
  currentAssistantMessage = assistantMessage;
  conversation.push(assistantMessage);
  renderConversation();

  try {
    isGenerating = true;
    generatingIndicator.classList.add("active");
    syncUi();

    const streamer = speechSynthesizer.createStreamSpeaker({
      ...getTtsOptions(),
      onReveal: (visibleText) => {
        assistantMessage.text = visibleText;
        updateLastAssistantMessage(assistantMessage);
      },
    });
    const result = await agentCall(streamer);

    lastAssistantReply = result.output;
    streamer.flush(result.output);
    // Ensure full text is visible after all speech finishes
    assistantMessage.text = result.output;
    const laugh = evaluateLaughResponse(result.output);
    setStageState("Punchline landed");
    setAudienceMood(laugh.score, laugh.label, laugh.feedback);
    celebrateBitLanding(laugh.score);
    setStatus(
      result.usedTools?.length
        ? `Bit delivered (used ${result.usedTools.join(", ")}). The set continues...`
        : "The set continues...",
    );
  } catch (error) {
    conversation.pop();
    setStatus(`Bit failed: ${getErrorMessage(error)}`);
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
    setTimeout(resolve, PAUSE_BETWEEN_BITS_MS);
  });
}

function pauseSet() {
  if (isGenerating) {
    comedyAgent?.cancel();
    llmInference?.cancelProcessing();
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
  setStageState("Resetting set");
  setAudienceMood(20, "Audience mood: resetting", "Fresh crowd, fresh opener.");
  setActiveReaction(null);
  renderConversation();
  updatePromptTokens();
  setStatus("Chat cleared. The comedian will restart the set.");
  syncUi();

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
    return;
  }

  chatMessages.innerHTML = conversation
    .map((message, index) => {
      const isLast = index === conversation.length - 1;
      const isStreaming = isLast && message.role === "assistant" && isGenerating;
      const roleLabel = message.role === "assistant" ? "Gemma Comedy Agent" : "You";
      const extraClass = isStreaming ? " streaming" : "";

      return `
        <article class="message ${message.role}${extraClass}">
          <p class="message-role">${escapeHtml(roleLabel)}</p>
          <div class="message-body">${formatMessageText(message)}</div>
        </article>
      `;
    })
    .join("");

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateLastAssistantMessage(message) {
  const lastArticle = chatMessages.querySelector(".message:last-child");
  if (!lastArticle) {
    return;
  }

  const body = lastArticle.querySelector(".message-body");
  if (body) {
    body.innerHTML = formatMessageText(message);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updatePromptTokens() {
  if (!llmInference) {
    tokenStatus.textContent = "Chat tokens: n/a";
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

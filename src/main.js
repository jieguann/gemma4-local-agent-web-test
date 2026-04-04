import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";
import "./styles.css";

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
const chatMessages = document.querySelector("#chatMessages");
const generatingIndicator = document.querySelector("#generatingIndicator");
const attachImageButton = document.querySelector("#attachImageButton");
const imagePreview = document.querySelector("#imagePreview");

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

setWebGpuStatus();
renderConversation();
syncUi();
hideImageUi();
loadModel();

loadModelButton.addEventListener("click", loadModel);
unloadModelButton.addEventListener("click", unloadModel);
runButton.addEventListener("click", handleSendMessage);
cancelButton.addEventListener("click", cancelGeneration);
clearChatButton.addEventListener("click", clearChat);
promptInput.addEventListener("input", updatePromptTokens);
promptInput.addEventListener("input", autoResizeTextarea);
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSendMessage();
  }
});

function hideImageUi() {
  imagePreview.classList.add("hidden");
  imagePreview.innerHTML = "";
  attachImageButton.disabled = true;
  attachImageButton.title = "Agent mode is text-only";
}

function autoResizeTextarea() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
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
}

function setFactStatus(element, level, text) {
  element.className = level;
  element.textContent = text;
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
    setStatus("Model loaded. Ask for a short joke and the agent will keep local memory in memory/.");
    updatePromptTokens();
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

async function handleSendMessage() {
  if (!llmInference || !comedyAgent || isGenerating) {
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus("Enter a prompt so the comedy agent has something to riff on.");
    return;
  }

  const userMessage = { role: "user", text: prompt };
  const conversationSnapshot = [...conversation, userMessage];
  conversation.push(userMessage);
  promptInput.value = "";
  autoResizeTextarea();

  const assistantMessage = { role: "assistant", text: "" };
  conversation.push(assistantMessage);
  renderConversation();

  try {
    isGenerating = true;
    generatingIndicator.classList.add("active");
    syncUi();
    setStatus("The comedy agent is warming up...");

    const result = await comedyAgent.run(prompt, {
      conversation: conversationSnapshot,
      onToken: (partialText) => {
        assistantMessage.text = partialText;
        updateLastAssistantMessage(assistantMessage);
      },
      onToolUse: ({ tool, query, status, result }) => {
        if (status === "searching") {
          assistantMessage.toolInfo = `<div class="tool-sources"><p>🔍 Searching: "${escapeHtml(query)}"...</p></div>`;
          assistantMessage.text = "";
        } else if (status === "done") {
          assistantMessage.toolInfo = formatSearchSources(query, result);
          assistantMessage.text = "";
        }
        updateLastAssistantMessage(assistantMessage);
      },
    });

    assistantMessage.text = result.output;
    setStatus(
      result.usedTools.length
        ? `Generation finished. Tools used: ${result.usedTools.join(", ")}.`
        : "Generation finished.",
    );
  } catch (error) {
    conversation.pop();
    conversation.pop();
    promptInput.value = prompt;
    autoResizeTextarea();
    setStatus(`Generation failed: ${getErrorMessage(error)}`);
  } finally {
    isGenerating = false;
    generatingIndicator.classList.remove("active");
    renderConversation();
    updatePromptTokens();
    syncUi();
    promptInput.focus();
  }
}

function cancelGeneration() {
  if (!llmInference || !isGenerating) {
    return;
  }

  comedyAgent?.cancel();
  llmInference.cancelProcessing();
  setStatus("Cancel requested. The current generation will stop when the runtime allows it.");
}

function clearChat() {
  if (isGenerating) {
    return;
  }

  conversation = [];
  renderConversation();
  updatePromptTokens();
  setStatus("Chat history cleared. Saved memory files stay on disk until you remove them.");
}

function renderConversation() {
  if (conversation.length === 0) {
    chatMessages.innerHTML = `
      <article class="message assistant">
        <p class="message-role">Gemma Comedy Agent</p>
        <div class="message-body"><p>Load the model, then ask for a short joke. The agent can use online info and save audience memory to local files.</p></div>
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

  loadModelButton.disabled = isGenerating;
  unloadModelButton.disabled = !modelLoaded || isGenerating;
  runButton.disabled = !modelLoaded || isGenerating;
  cancelButton.disabled = !modelLoaded || !isGenerating;
  clearChatButton.disabled = isGenerating;
  modelFileInput.disabled = isGenerating;
  bundledModelSelect.disabled = isGenerating;
  maxTokensInput.disabled = modelLoaded || isGenerating;
  topKInput.disabled = modelLoaded || isGenerating;
  temperatureInput.disabled = modelLoaded || isGenerating;
  randomSeedInput.disabled = modelLoaded || isGenerating;
  promptInput.disabled = !modelLoaded || isGenerating;
  attachImageButton.disabled = true;
  attachImageButton.title = "Agent mode is text-only";
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

import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";
import "./styles.css";

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
const imageInput = document.querySelector("#imageInput");
const attachImageButton = document.querySelector("#attachImageButton");
const imagePreview = document.querySelector("#imagePreview");

const DEFAULT_MODEL_PATH = "/assets/gemma-4-E2B-it-web.task";
const BUNDLED_MODEL_LABELS = {
  "/assets/gemma-4-E2B-it-web.task": "Gemma 4 E2B Web",
  "/assets/gemma-4-E4B-it-web.task": "Gemma 4 E4B Web",
};
const BUNDLED_MODEL_VISION_SUPPORT = {
  "/assets/gemma-4-E2B-it-web.task": false,
  "/assets/gemma-4-E4B-it-web.task": false,
};
const SYSTEM_PROMPT =
  "You are Gemma running locally in a browser chat demo. Answer helpfully and concisely.";

let llmInference;
let isGenerating = false;
let activeModelSource;
let conversation = [];
let pendingImage = null; // { dataUrl: string, element: HTMLImageElement }
let visionSupported = false;

setWebGpuStatus();
renderConversation();
syncUi();
loadModel();

loadModelButton.addEventListener("click", loadModel);
unloadModelButton.addEventListener("click", unloadModel);
runButton.addEventListener("click", handleSendMessage);
cancelButton.addEventListener("click", cancelGeneration);
clearChatButton.addEventListener("click", clearChat);
promptInput.addEventListener("input", updatePromptTokens);
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSendMessage();
  }
});
promptInput.addEventListener("input", autoResizeTextarea);
attachImageButton.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", handleImageAttach);

function autoResizeTextarea() {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + "px";
}

function handleImageAttach() {
  const file = imageInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      pendingImage = { dataUrl: reader.result, element: img };
      renderImagePreview();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  imageInput.value = "";
}

function removePendingImage() {
  pendingImage = null;
  renderImagePreview();
}

function renderImagePreview() {
  if (!pendingImage) {
    imagePreview.classList.add("hidden");
    imagePreview.innerHTML = "";
    return;
  }

  imagePreview.classList.remove("hidden");
  imagePreview.innerHTML = `
    <div class="image-preview-item">
      <img src="${pendingImage.dataUrl}" alt="Attached image" />
      <button class="image-remove-btn" title="Remove image">&times;</button>
    </div>
  `;
  imagePreview.querySelector(".image-remove-btn").addEventListener("click", removePendingImage);
}

async function setWebGpuStatus() {
  if (!("gpu" in navigator)) {
    setFactStatus(webgpuStatus, "error", "WebGPU: unavailable");
    setStatus("WebGPU is not available. Use a compatible Chromium-based browser.");
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      setFactStatus(webgpuStatus, "warn", "WebGPU: no adapter");
      setStatus("WebGPU is exposed, but no GPU adapter is available.");
      return;
    }

    setFactStatus(webgpuStatus, "ok", "WebGPU: available");
  } catch (error) {
    setFactStatus(webgpuStatus, "error", "WebGPU: failed");
    setStatus(`WebGPU adapter check failed: ${getErrorMessage(error)}`);
  }
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
    const modelLabel = modelFile ? modelFile.name : DEFAULT_MODEL_PATH;
    setStatus(`Loading ${modelLabel}...`);
    setFactStatus(modelStatus, "loading", "Model: loading...");

    unloadModel();

    if (modelFile) {
      activeModelSource = {
        label: modelFile.name,
        type: "buffer",
        value: new Uint8Array(await modelFile.arrayBuffer()),
        supportsVision: inferVisionSupportFromFileName(modelFile.name),
      };
    } else {
      const selectedBundledModel = bundledModelSelect.value || DEFAULT_MODEL_PATH;
      activeModelSource = {
        label: BUNDLED_MODEL_LABELS[selectedBundledModel] ?? selectedBundledModel,
        type: "path",
        value: selectedBundledModel,
        supportsVision: BUNDLED_MODEL_VISION_SUPPORT[selectedBundledModel] ?? false,
      };
    }

    llmInference = await createInference(activeModelSource);
    setFactStatus(modelStatus, "ok", `Model: ${activeModelSource.label}`);
    setStatus("Model loaded. You can start chatting.");
    updatePromptTokens();
  } catch (error) {
    setFactStatus(modelStatus, "error", "Model: failed to load");
    setStatus(`Load failed: ${getErrorMessage(error)}`);
    llmInference?.close();
    llmInference = undefined;
  } finally {
    syncUi();
  }
}

function unloadModel() {
  if (llmInference) {
    llmInference.close();
    llmInference = undefined;
  }

  isGenerating = false;
  activeModelSource = undefined;
  visionSupported = false;
  setFactStatus(modelStatus, "", "Model: not loaded");
  tokenStatus.className = "";
  tokenStatus.textContent = "Chat tokens: n/a";
  syncUi();
}

async function handleSendMessage() {
  if (!llmInference || isGenerating) {
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt && !pendingImage) {
    setStatus("Enter a message or attach an image first.");
    return;
  }

  const hasImage = Boolean(pendingImage);
  const draftPrompt = prompt;
  const draftImage = pendingImage;
  const userMessage = {
    role: "user",
    text: prompt || (hasImage ? "(image)" : ""),
    image: hasImage ? { dataUrl: pendingImage.dataUrl, element: pendingImage.element } : null,
  };
  conversation.push(userMessage);
  promptInput.value = "";
  pendingImage = null;
  renderImagePreview();
  autoResizeTextarea();
  const assistantMessage = { role: "assistant", text: "" };
  conversation.push(assistantMessage);
  renderConversation();

  try {
    isGenerating = true;
    generatingIndicator.classList.add("active");
    syncUi();

    if (hasImage) {
        const ok = await ensureVision();
        if (!ok) {
          conversation.pop();
          conversation.pop();
          restoreDraftInput(draftPrompt, draftImage);
          renderConversation();
          return;
        }
      }

    setStatus("Generating...");

    const response = await runInference(buildChatPrompt(), (partialText) => {
      assistantMessage.text = partialText;
      updateLastMessage(partialText);
    });

    assistantMessage.text = response;
    setStatus("Generation finished.");
  } catch (error) {
    if (hasImage && isVisionUnsupportedError(error)) {
      await fallbackToTextOnlyModel();
      conversation.pop();
      conversation.pop();
      restoreDraftInput(draftPrompt, draftImage);
      setStatus("This model can't process images. Use a vision-enabled Gemma .task file, or send the message without an image.");
      return;
    }

    conversation.pop();
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

  llmInference.cancelProcessing();
  setStatus("Cancel requested. The current decode will stop when the runtime allows it.");
}

function clearChat() {
  if (isGenerating) {
    return;
  }

  conversation = [];
  renderConversation();
  updatePromptTokens();
  setStatus("Chat history cleared.");
}

async function runInference(prompt, onPartial, allowRecovery = true) {
  let streamedText = "";

  try {
    const raw = await llmInference.generateResponse(prompt, (partialResult) => {
      streamedText += partialResult;
      onPartial(stripControlTokens(streamedText));
    });
    return stripControlTokens(raw);
  } catch (error) {
    const message = getErrorMessage(error);
    if (allowRecovery && shouldRecreateModel(message) && activeModelSource) {
      setStatus("The inference engine stayed busy after the last run. Recreating the model and retrying.");
      llmInference?.close();
      llmInference = await createInference(activeModelSource, visionSupported);
      setFactStatus(modelStatus, "ok", `Model: ${activeModelSource.label}`);
      syncUi();
      return runInference(prompt, onPartial, false);
    }

    throw error;
  }
}

async function createInference(modelSource, enableVision = false) {
  const wasmFileset = await FilesetResolver.forGenAiTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm",
  );
  const baseOptions =
    modelSource.type === "buffer"
      ? { modelAssetBuffer: modelSource.value, delegate: "GPU" }
      : { modelAssetPath: modelSource.value, delegate: "GPU" };

  const options = {
    baseOptions,
    maxTokens: readNumber(maxTokensInput, 1024),
    topK: readNumber(topKInput, 40),
    temperature: readFloat(temperatureInput, 0.8),
    randomSeed: readNumber(randomSeedInput, 101),
  };

  if (enableVision) {
    options.maxNumImages = 1;
  }

  return LlmInference.createFromOptions(wasmFileset, options);
}

async function ensureVision() {
  if (visionSupported || !activeModelSource) return true;

  if (activeModelSource.supportsVision === false) {
    setStatus("This MediaPipe model can't process images. Use a Gemma 3n multimodal browser model to attach images.");
    return false;
  }

  setStatus("Reloading model with vision support...");
  setFactStatus(modelStatus, "loading", "Model: enabling vision...");
  try {
    llmInference?.close();
    llmInference = await createInference(activeModelSource, true);
    visionSupported = true;
    activeModelSource.supportsVision = true;
    setFactStatus(modelStatus, "ok", `Model: ${activeModelSource.label} (vision)`);
    setStatus("Vision enabled. Generating...");
    return true;
  } catch {
    activeModelSource.supportsVision = false;
    await fallbackToTextOnlyModel();
    setStatus("Image input is not available for this model. MediaPipe browser vision support requires a Gemma 3n multimodal model.");
    return false;
  }
}

async function fallbackToTextOnlyModel() {
  visionSupported = false;

  if (!activeModelSource) {
    return;
  }

  try {
    llmInference?.close();
    llmInference = await createInference(activeModelSource, false);
    setFactStatus(modelStatus, "ok", `Model: ${activeModelSource.label}`);
  } catch (error) {
    llmInference = undefined;
    setFactStatus(modelStatus, "error", "Model: failed to load");
    setStatus(`Load failed: ${getErrorMessage(error)}`);
  }
}

function restoreDraftInput(prompt, image) {
  promptInput.value = prompt;
  pendingImage = image;
  renderImagePreview();
  autoResizeTextarea();
}

function renderConversation() {
  if (conversation.length === 0) {
    chatMessages.innerHTML = `
      <article class="message assistant">
        <p class="message-role">Gemma</p>
        <div class="message-body"><p>Load the model, then send a message to start chatting.</p></div>
      </article>
    `;
    return;
  }

  chatMessages.innerHTML = conversation
    .map((message, i) => {
      const isLast = i === conversation.length - 1;
      const isStreaming = isLast && message.role === "assistant" && isGenerating;
      const roleLabel = message.role === "assistant" ? "Gemma" : "You";
      const extraClass = isStreaming ? " streaming" : "";
      const imageHtml = message.image
        ? `<img class="message-image" src="${message.image.dataUrl}" alt="User image" />`
        : "";
      return `
        <article class="message ${message.role}${extraClass}">
          <p class="message-role">${escapeHtml(roleLabel)}</p>
          ${imageHtml}
          <div class="message-body">${formatMessageText(message)}</div>
        </article>
      `;
    })
    .join("");

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateLastMessage(text) {
  const lastArticle = chatMessages.querySelector(".message:last-child");
  if (!lastArticle) return;

  const body = lastArticle.querySelector(".message-body");
  if (body) {
    body.innerHTML = formatMessageText({ role: "assistant", text });
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function buildChatPrompt() {
  const hasAnyImage = conversation.some((m) => m.image);

  if (!hasAnyImage) {
    let text = `<start_of_turn>user\n${SYSTEM_PROMPT}<end_of_turn>\n`;
    for (const message of conversation) {
      if (!message.text.trim()) continue;
      const role = message.role === "user" ? "user" : "model";
      text += `<start_of_turn>${role}\n${message.text}<end_of_turn>\n`;
    }
    text += "<start_of_turn>model\n";
    return text;
  }

  // Multimodal: build an interleaved array of strings and {imageSource} objects
  const parts = [];
  parts.push(`<start_of_turn>user\n${SYSTEM_PROMPT}<end_of_turn>\n`);

  for (const message of conversation) {
    const role = message.role === "user" ? "user" : "model";
    let turnText = `<start_of_turn>${role}\n`;

    if (message.image) {
      // Interleave: text before image, then image, then rest
      turnText += message.text ? `${message.text}\n` : "Describe this image\n";
      parts.push(turnText);
      parts.push({ imageSource: message.image.element });
      parts.push("<end_of_turn>\n");
    } else if (message.text.trim()) {
      turnText += `${message.text}<end_of_turn>\n`;
      parts.push(turnText);
    }
  }

  parts.push("<start_of_turn>model\n");
  return parts;
}

function updatePromptTokens() {
  if (!llmInference) {
    tokenStatus.textContent = "Chat tokens: n/a";
    return;
  }

  try {
    const pendingPrompt = promptInput.value.trim();
    const draftConversation =
      pendingPrompt === "" ? conversation : [...conversation, { role: "user", text: pendingPrompt }];
    const prompt = buildPromptFromMessages(draftConversation);
    const size = llmInference.sizeInTokens(prompt);
    tokenStatus.textContent = `Chat tokens: ${size ?? "unknown"}`;
  } catch {
    tokenStatus.textContent = "Chat tokens: unavailable";
  }
}

function buildPromptFromMessages(messages) {
  let prompt = `<start_of_turn>user\n${SYSTEM_PROMPT}<end_of_turn>\n`;

  for (const message of messages) {
    if (!message.text.trim()) continue;
    const role = message.role === "user" ? "user" : "model";
    prompt += `<start_of_turn>${role}\n${message.text}<end_of_turn>\n`;
  }

  prompt += "<start_of_turn>model\n";
  return prompt;
}

function syncUi() {
  const modelLoaded = Boolean(llmInference);
  const canAttachImage = modelLoaded && !isGenerating && activeModelSource?.supportsVision !== false;

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
  attachImageButton.disabled = !canAttachImage;
  attachImageButton.title =
    activeModelSource?.supportsVision === false
      ? "This model does not support image input"
      : "Attach image";
}

function setStatus(message) {
  statusText.textContent = message;
}

function shouldRecreateModel(message) {
  return (
    message.includes("Previous invocation or loading is still ongoing") ||
    message.includes("Cannot process because LLM inference engine is currently loading or processing")
  );
}

function isVisionUnsupportedError(error) {
  const message = getErrorMessage(error);
  return (
    message.includes("LlmVisionInferenceCalculator") ||
    message.includes("Image models could not be created")
  );
}

function inferVisionSupportFromFileName(fileName) {
  const normalized = fileName.toLowerCase();

  if (normalized.includes("gemma-3n")) {
    return true;
  }

  if (normalized.includes("-web.task") || normalized.includes("gemma-4")) {
    return false;
  }

  if (normalized.includes("vision") || normalized.includes("image") || normalized.includes("multimodal")) {
    return true;
  }

  return undefined;
}

function readNumber(input, fallback) {
  const value = Number.parseInt(input.value, 10);
  return Number.isFinite(value) ? value : fallback;
}

function readFloat(input, fallback) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function stripControlTokens(text) {
  return text
    .replace(/<start_of_turn>(?:user|model)\n?/g, "")
    .replace(/<end_of_turn>/g, "")
    .replace(/<[^>]*अंत[^>]*>/g, "")
    .trim();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMessageText(message) {
  const text = message.text || (message.role === "assistant" ? "..." : "");
  const normalized = escapeHtml(text).replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim() !== "");

  if (blocks.length === 0) {
    return "<p>...</p>";
  }

  return blocks
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

  return /^[A-Z][A-Za-z0-9 !?,'".:-]*$/.test(text);
}

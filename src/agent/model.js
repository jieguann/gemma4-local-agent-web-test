import { AIMessage } from "@langchain/core/messages";
import { buildGemmaPrompt, stripControlTokens } from "./prompting.js";

export class LangChainGemmaAdapter {
  constructor({ getInference, recreateInference, onStatus }) {
    this.getInference = getInference;
    this.recreateInference = recreateInference;
    this.onStatus = onStatus;
  }

  cancel() {
    const inference = this.getInference?.();
    inference?.cancelProcessing?.();
  }

  async invoke(messages, { onToken, allowRecovery = true } = {}) {
    const inference = this.getInference?.();
    if (!inference) {
      throw new Error("Load the model before starting the comedy agent.");
    }

    const prompt = buildGemmaPrompt(messages);
    let streamedText = "";

    try {
      const raw = await inference.generateResponse(prompt, (partialResult) => {
        streamedText += partialResult;
        onToken?.(stripControlTokens(streamedText));
      });

      const cleaned = stripControlTokens(raw);
      return new AIMessage(cleaned);
    } catch (error) {
      const message = getErrorMessage(error);
      if (allowRecovery && shouldRecreateModel(message) && this.recreateInference) {
        this.onStatus?.("The inference engine stayed busy. Recreating the model and retrying.");
        await this.recreateInference();
        return this.invoke(messages, { onToken, allowRecovery: false });
      }

      throw error;
    }
  }
}

function shouldRecreateModel(message) {
  return (
    message.includes("Previous invocation or loading is still ongoing") ||
    message.includes("Cannot process because LLM inference engine is currently loading or processing")
  );
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

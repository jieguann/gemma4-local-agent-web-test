export const DEFAULT_TTS_VOICE = "";

export const TTS_VOICE_OPTIONS = [];

function getVoices() {
  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length) {
      resolve(voices);
      return;
    }
    speechSynthesis.addEventListener("voiceschanged", () => {
      resolve(speechSynthesis.getVoices());
    }, { once: true });
  });
}

export function createSpeechSynthesizer({ onStatus } = {}) {
  let ready = false;
  let currentUtterance = null;

  return {
    async preload() {
      if (!("speechSynthesis" in window)) {
        throw new Error("Browser speech synthesis not supported.");
      }
      const voices = await getVoices();
      ready = true;

      // Populate the exported voice options so the UI can pick them up
      TTS_VOICE_OPTIONS.length = 0;
      for (const v of voices) {
        TTS_VOICE_OPTIONS.push({ value: v.name, label: `${v.name} (${v.lang})` });
      }

      onStatus?.(`TTS ready — ${voices.length} voices available.`);
    },

    async speak(text, { voice = DEFAULT_TTS_VOICE, speed = 1 } = {}) {
      const trimmed = String(text ?? "").replace(/\([^)]*\)/g, "").trim();
      if (!trimmed) {
        throw new Error("Nothing to speak.");
      }

      if (!ready) await this.preload();

      speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.rate = speed;

      if (voice) {
        const voices = speechSynthesis.getVoices();
        const match = voices.find((v) => v.name === voice);
        if (match) utterance.voice = match;
      }

      currentUtterance = utterance;

      return new Promise((resolve, reject) => {
        utterance.addEventListener("end", () => {
          currentUtterance = null;
          onStatus?.("Speech playback finished.");
          resolve();
        }, { once: true });
        utterance.addEventListener("error", (e) => {
          currentUtterance = null;
          reject(new Error(e.error || "Speech synthesis error"));
        }, { once: true });
        onStatus?.("Speaking...");
        speechSynthesis.speak(utterance);
      });
    },

    /**
     * Returns a stream speaker that queues sentences as text arrives token-by-token.
     * Call `feed(fullTextSoFar)` on each onToken callback, then `flush()` when done.
     *
     * `onReveal(visibleText)` is called when each sentence **starts** being spoken,
     * so the UI can sync displayed text to what the audience is hearing.
     */
    createStreamSpeaker({ voice = DEFAULT_TTS_VOICE, speed = 1, onReveal } = {}) {
      let spokenLength = 0;
      let currentFullText = "";
      const self = this;

      function resolveVoice() {
        if (!voice) return null;
        const voices = speechSynthesis.getVoices();
        return voices.find((v) => v.name === voice) ?? null;
      }

      function enqueue(text, endIndex) {
        if (!text.trim()) return;

        let spokenText = text.replace(/\([^)]*\)/g, "").trim();
        let isSilent = false;

        if (!spokenText) {
          spokenText = " ";
          isSilent = true;
        }

        const utterance = new SpeechSynthesisUtterance(spokenText);
        utterance.rate = speed;
        if (isSilent) utterance.volume = 0;

        const matched = resolveVoice();
        if (matched) utterance.voice = matched;

        utterance.addEventListener("start", () => {
          onReveal?.(currentFullText.slice(0, endIndex));
        }, { once: true });

        speechSynthesis.speak(utterance);
      }

      return {
        /** Call with the full accumulated text on each token. */
        feed(fullText) {
          if (fullText.length < currentFullText.length) {
            // Text length decreased, implying a retry or reset.
            spokenLength = 0;
            speechSynthesis.cancel();
          }
          currentFullText = fullText;
          if (!self.loaded) {
            // If TTS not loaded, reveal text immediately
            onReveal?.(fullText);
            return;
          }
          const fresh = fullText.slice(spokenLength);
          const regex = /(?<=[.!?])\s+/g;
          let match;
          let lastIndex = 0;
          while ((match = regex.exec(fresh)) !== null) {
            const endIndex = match.index + match[0].length;
            const sentence = fresh.slice(lastIndex, match.index);
            const totalSpokenNow = spokenLength + endIndex;
            enqueue(sentence, totalSpokenNow);
            lastIndex = endIndex;
          }
          spokenLength += lastIndex;
        },
        /** Speak any remaining text after generation finishes. */
        flush(fullText) {
          currentFullText = fullText;
          if (!self.loaded) {
            onReveal?.(fullText);
            return;
          }
          const remaining = fullText.slice(spokenLength);
          if (remaining.trim()) enqueue(remaining, fullText.length);
          spokenLength = fullText.length;
        },
        /** Cancel all queued speech. */
        cancel() {
          speechSynthesis.cancel();
          spokenLength = 0;
          currentFullText = "";
        },
      };
    },

    stop() {
      speechSynthesis.cancel();
      currentUtterance = null;
      onStatus?.("Speech playback stopped.");
    },

    unload() {
      speechSynthesis.cancel();
      currentUtterance = null;
      ready = false;
      onStatus?.("TTS unloaded.");
    },

    get loaded() {
      return ready;
    },
  };
}

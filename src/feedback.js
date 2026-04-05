// ── Audience feedback: laugh sounds, rimshot, floating emojis, glow ──

const REACTION_EMOJIS = ["😂", "🤣", "😄", "👏", "🔥", "💀", "😭", "🎤"];
const MILD_EMOJIS = ["😄", "👏", "🙂", "😏"];

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

// ── Sounds ──

/**
 * Rimshot: ba-dum-tss using oscillators + noise.
 */
export function playRimshot() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    // "ba" — low tom
    const ba = ctx.createOscillator();
    ba.type = "sine";
    ba.frequency.setValueAtTime(120, now);
    ba.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    ba.connect(gain);
    ba.start(now);
    ba.stop(now + 0.12);

    // "dum" — mid tom
    const dum = ctx.createOscillator();
    dum.type = "sine";
    dum.frequency.setValueAtTime(100, now + 0.15);
    dum.frequency.exponentialRampToValueAtTime(50, now + 0.27);
    dum.connect(gain);
    dum.start(now + 0.15);
    dum.stop(now + 0.27);

    // "tss" — hi-hat noise
    const bufferSize = ctx.sampleRate * 0.15;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const hipass = ctx.createBiquadFilter();
    hipass.type = "highpass";
    hipass.frequency.value = 7000;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.12, now + 0.32);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    noise.connect(hipass).connect(noiseGain).connect(ctx.destination);
    noise.start(now + 0.32);
    noise.stop(now + 0.55);
  } catch { /* audio not available */ }
}

/**
 * Crowd laugh: filtered noise bursts that sound like a brief audience chuckle.
 */
export function playCrowdLaugh(intensity = 0.5) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const duration = 0.6 + intensity * 1.2;

    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    // Bandpass to sound voice-like
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 800 + intensity * 400;
    bandpass.Q.value = 0.8;

    // Modulate to create "ha ha" rhythm
    const modGain = ctx.createGain();
    const modOsc = ctx.createOscillator();
    modOsc.type = "sine";
    modOsc.frequency.value = 6 + intensity * 4; // faster = more intense
    const modDepth = ctx.createGain();
    modDepth.gain.value = 0.5;
    modOsc.connect(modDepth).connect(modGain.gain);
    modOsc.start(now);
    modOsc.stop(now + duration);

    // Envelope
    const envelope = ctx.createGain();
    const vol = 0.06 + intensity * 0.08;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(vol, now + 0.08);
    envelope.gain.setValueAtTime(vol, now + duration * 0.6);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(bandpass).connect(modGain).connect(envelope).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + duration);
  } catch { /* audio not available */ }
}

// ── Floating emoji reactions ──

let reactionsContainer = null;

function ensureReactionsContainer() {
  if (reactionsContainer) return reactionsContainer;
  reactionsContainer = document.createElement("div");
  reactionsContainer.className = "emoji-reactions";
  document.body.appendChild(reactionsContainer);
  return reactionsContainer;
}

/**
 * Burst floating emojis from the bottom of the screen.
 * @param {number} count — number of emojis (3-8 typical)
 * @param {boolean} intense — use big laugh emojis vs mild ones
 */
export function burstEmojis(count = 5, intense = true) {
  const container = ensureReactionsContainer();
  const pool = intense ? REACTION_EMOJIS : MILD_EMOJIS;

  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = "emoji-particle";
    el.textContent = pool[Math.floor(Math.random() * pool.length)];
    el.style.left = `${(Math.random() - 0.5) * 300}px`;
    el.style.animationDelay = `${Math.random() * 0.5}s`;
    el.style.animationDuration = `${1.8 + Math.random() * 0.8}s`;
    container.appendChild(el);

    // Clean up after animation
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }
}

// ── Message glow ──

/**
 * Add a glow pulse to the last assistant message bubble.
 */
export function glowLastMessage() {
  const lastMsg = document.querySelector(".chat-messages .message.assistant:last-of-type");
  if (!lastMsg) return;
  lastMsg.classList.remove("joke-landed");
  // Force reflow to restart animation
  void lastMsg.offsetWidth;
  lastMsg.classList.add("joke-landed");
}

// ── Combined reaction ──

/**
 * Play a full audience reaction: sound + emojis + glow.
 * Intensity 0-1 controls how big the reaction is.
 */
export function audienceReaction(intensity = 0.5) {
  const emojiCount = Math.round(3 + intensity * 7);
  const intense = intensity > 0.4;

  glowLastMessage();
  burstEmojis(emojiCount, intense);

  if (intensity > 0.6) {
    playRimshot();
    setTimeout(() => playCrowdLaugh(intensity), 600);
  } else if (intensity > 0.3) {
    playCrowdLaugh(intensity);
  }
  // Low intensity: just emojis + glow, no sound
}

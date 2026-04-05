const CHORDS = [
  [220, 277.18, 329.63],
  [196, 246.94, 293.66],
  [174.61, 220, 261.63],
  [196, 233.08, 293.66],
];

export function createAmbientMusic({ onStatus } = {}) {
  let audioContext = null;
  let masterGain = null;
  let noiseGain = null;
  let filterNode = null;
  let noiseSource = null;
  let chordTimer = null;
  let isPlaying = false;
  let volume = 0.18;
  let chordIndex = 0;

  function ensureContext() {
    if (!audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        throw new Error("Web Audio is not supported in this browser.");
      }

      audioContext = new Ctx();
      masterGain = audioContext.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(audioContext.destination);

      filterNode = audioContext.createBiquadFilter();
      filterNode.type = "lowpass";
      filterNode.frequency.value = 900;
      filterNode.Q.value = 0.6;

      noiseGain = audioContext.createGain();
      noiseGain.gain.value = 0.012;
      filterNode.connect(noiseGain);
      noiseGain.connect(masterGain);
    }
  }

  function createNoiseSource() {
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = (Math.random() * 2 - 1) * 0.25;
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(filterNode);
    return source;
  }

  function playChord(now) {
    const frequencies = CHORDS[chordIndex % CHORDS.length];
    chordIndex += 1;

    for (const frequency of frequencies) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.detune.setValueAtTime((Math.random() - 0.5) * 8, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 1.6);
      gain.gain.linearRampToValueAtTime(0.02, now + 5.2);
      gain.gain.linearRampToValueAtTime(0, now + 7.8);

      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.start(now);
      oscillator.stop(now + 8.1);
    }
  }

  function scheduleChords() {
    if (!isPlaying) {
      return;
    }

    playChord(audioContext.currentTime);
    chordTimer = window.setTimeout(scheduleChords, 6200);
  }

  return {
    async play() {
      ensureContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      if (isPlaying) {
        return;
      }

      isPlaying = true;
      noiseSource = createNoiseSource();
      noiseSource.start();
      scheduleChords();
      onStatus?.("Ambient room music on.");
    },
    pause() {
      if (!audioContext || !isPlaying) {
        return;
      }

      isPlaying = false;
      window.clearTimeout(chordTimer);
      chordTimer = null;
      if (noiseSource) {
        try {
          noiseSource.stop();
        } catch {}
        noiseSource.disconnect();
        noiseSource = null;
      }
      onStatus?.("Ambient room music paused.");
    },
    setVolume(nextVolume) {
      volume = Math.max(0, Math.min(0.45, nextVolume));
      if (masterGain && audioContext) {
        masterGain.gain.setTargetAtTime(volume, audioContext.currentTime, 0.08);
      }
    },
    get playing() {
      return isPlaying;
    },
  };
}

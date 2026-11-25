const TARGET_SAMPLE_RATE = 16000;
const SILENCE_THRESHOLD = 0.012;
const PADDING_SECONDS = 0.18;

function downsampleAndMix(
  channels: readonly Float32Array[],
  fromRate: number,
  toRate: number,
): Float32Array {
  const frameCount = channels[0]?.length ?? 0;
  if (frameCount === 0) return new Float32Array(0);

  // Mix channels down to mono
  const mono = new Float32Array(frameCount);
  if (channels.length === 1) {
    mono.set(channels[0] ?? new Float32Array(0));
  } else {
    const chCount = channels.length;
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let c = 0; c < chCount; c++) {
        sum += channels[c]?.[i] ?? 0;
      }
      mono[i] = sum / chCount;
    }
  }

  // Resample to target rate
  if (fromRate <= toRate) return mono;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(frameCount / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = mono[idx] ?? 0;
    const b = mono[Math.min(idx + 1, frameCount - 1)] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Trim leading/trailing silence (keeping generous padding) and normalize quiet speech cleanly. */
export function trimAndNormalizeSpeech(samples: Float32Array, sampleRate: number): {
  pcm: Float32Array;
  peak: number;
} {
  if (samples.length === 0) return { pcm: samples, peak: 0 };

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i] ?? 0);
    if (abs > peak) peak = abs;
  }

  const threshold = Math.max(SILENCE_THRESHOLD, peak * 0.05);
  let start = 0;
  while (start < samples.length && Math.abs(samples[start] ?? 0) < threshold) {
    start++;
  }
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end] ?? 0) < threshold) {
    end--;
  }

  if (start >= end) {
    return { pcm: samples, peak };
  }

  const pad = Math.floor(sampleRate * PADDING_SECONDS);
  const sliced = samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad + 1));

  // Boost quiet voices gently without over-amplifying room hiss
  const gain = peak > 0.015 && peak < 0.7 ? Math.min(4, 0.85 / peak) : 1;
  if (gain === 1) return { pcm: sliced, peak };

  const normalized = new Float32Array(sliced.length);
  for (let i = 0; i < sliced.length; i++) {
    normalized[i] = Math.max(-1, Math.min(1, (sliced[i] ?? 0) * gain));
  }
  return { pcm: normalized, peak };
}

export function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Blob {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return encodeMonoPcmWav(downsampleAndMix([merged], sampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
}

function encodeMonoPcmWav(samples: Float32Array, sampleRate: number): Blob {
  const length = samples.length;
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, sample * (sample < 0 ? 32768 : 32767), true);
    offset += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export type WavRecording = { stop: () => Promise<File>; cancel: () => void; level: () => number };

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "name.m4a";
  if (mime.includes("ogg")) return "name.ogg";
  if (mime.includes("wav")) return "name.wav";
  return "name.webm";
}

function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext;
}

async function transcodeToCleanWav(
  blob: Blob,
  AudioCtx: typeof AudioContext | undefined,
): Promise<{ file: File; peak: number } | null> {
  if (!AudioCtx) return null;
  const ctx = new AudioCtx();
  try {
    const buffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    const channels: Float32Array[] = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }
    const rate = Math.min(audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
    const mono = downsampleAndMix(channels, audioBuffer.sampleRate, rate);
    const { pcm, peak } = trimAndNormalizeSpeech(mono, rate);
    if (pcm.length < rate * 0.25) {
      return { file: new File([encodeMonoPcmWav(mono, rate)], "name.wav", { type: "audio/wav" }), peak };
    }
    const wavBlob = encodeMonoPcmWav(pcm, rate);
    return { file: new File([wavBlob], "name.wav", { type: "audio/wav" }), peak };
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export async function recordWav(): Promise<WavRecording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("المتصفح لا يدعم الوصول إلى الميكروفون");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  let context: AudioContext | undefined;
  let analyser: AnalyserNode | undefined;
  let freqBuf: Uint8Array<ArrayBuffer> | undefined;
  let peakMeter = 0;
  let meterReadings = 0;
  const startedAt = Date.now();

  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

  try {
    const AudioCtx = getAudioContextCtor();
    if (AudioCtx) {
      context = new AudioCtx();
      if (context.state === "suspended") await context.resume();
      const source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }

    const readAnalyserLevel = () => {
      if (!analyser || !freqBuf) return 0;
      analyser.getByteTimeDomainData(freqBuf);
      let sum = 0;
      let maxSample = 0;
      for (let i = 0; i < freqBuf.length; i++) {
        const v = ((freqBuf[i] ?? 128) - 128) / 128;
        const abs = Math.abs(v);
        if (abs > maxSample) maxSample = abs;
        sum += v * v;
      }
      meterReadings++;
      if (maxSample > peakMeter) peakMeter = maxSample;
      return Math.sqrt(sum / freqBuf.length);
    };

    if (typeof MediaRecorder !== "undefined") {
      const mimeType = pickSupportedAudioMime();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.start(200);

      let stopped = false;
      return {
        level: readAnalyserLevel,
        cancel() {
          if (stopped) return;
          stopped = true;
          try {
            if (recorder.state !== "inactive") recorder.stop();
          } catch {
            /* ignore */
          }
          stopTracks();
          void context?.close();
        },
        async stop() {
          if (stopped) throw new Error("Recording already stopped");
          stopped = true;
          readAnalyserLevel();
          await new Promise<void>((resolve) => {
            if (recorder.state === "inactive") {
              resolve();
              return;
            }
            const timer = window.setTimeout(resolve, 1500);
            recorder.onstop = () => {
              window.clearTimeout(timer);
              resolve();
            };
            try {
              recorder.stop();
            } catch {
              window.clearTimeout(timer);
              resolve();
            }
          });
          stopTracks();
          await context?.close().catch(() => undefined);

          const elapsedMs = Date.now() - startedAt;
          if (elapsedMs < 350) {
            throw new Error("التسجيل قصير جداً، اضغط وتكلّم بالاسم كاملاً ثم أوقف التسجيل");
          }

          const finalMime = (recorder.mimeType || mimeType || "audio/webm").split(";")[0] || "audio/webm";
          const normalizedMime = finalMime === "video/webm" ? "audio/webm" : finalMime;
          const blob = new Blob(chunks, { type: normalizedMime });
          if (blob.size < 1024) {
            throw new Error("التسجيل قصير جداً، حاول مرة أخرى");
          }

          const transcoded = await transcodeToCleanWav(blob, AudioCtx);
          if (transcoded) {
            if (transcoded.peak < 0.008) {
              throw new Error("لم نسمع صوتاً واضحاً، قرّب الميكروفون وتكلّم بوضوح");
            }
            return transcoded.file;
          }

          if (meterReadings > 2 && peakMeter < 0.006) {
            throw new Error("لم نسمع صوتاً واضحاً، قرّب الميكروفون وتكلّم بوضوح");
          }
          return new File([blob], extensionForMime(normalizedMime), { type: normalizedMime });
        },
      };
    }

    if (!context) {
      throw new Error("المتصفح لا يدعم تسجيل الصوت");
    }
    const audioContext = context;
    const source = audioContext.createMediaStreamSource(stream);
    const node = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    const chunks: Float32Array[] = [];
    let lastLevel = 0;
    node.onaudioprocess = (event) => {
      const data = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      lastLevel = Math.sqrt(sum / data.length);
    };
    source.connect(node);
    node.connect(silentGain);
    silentGain.connect(audioContext.destination);
    let stopped = false;
    const teardown = () => {
      stopTracks();
      node.disconnect();
      silentGain.disconnect();
      source.disconnect();
      node.onaudioprocess = null;
    };
    return {
      level: () => lastLevel,
      cancel() {
        if (stopped) return;
        stopped = true;
        teardown();
        void audioContext.close();
      },
      async stop() {
        if (stopped) throw new Error("Recording already stopped");
        stopped = true;
        teardown();
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const merged = new Float32Array(total);
        let pos = 0;
        for (const c of chunks) {
          merged.set(c, pos);
          pos += c.length;
        }
        const rate = Math.min(audioContext.sampleRate, TARGET_SAMPLE_RATE);
        const mono = downsampleAndMix([merged], audioContext.sampleRate, rate);
        const { pcm, peak } = trimAndNormalizeSpeech(mono, rate);
        await audioContext.close();
        if (pcm.length < rate * 0.3) {
          throw new Error("التسجيل قصير جداً، حاول مرة أخرى");
        }
        if (peak < 0.008) {
          throw new Error("لم نسمع صوتاً واضحاً، قرّب الميكروفون وتكلّم بوضوح");
        }
        return new File([encodeMonoPcmWav(pcm, rate)], "name.wav", { type: "audio/wav" });
      },
    };
  } catch (error) {
    stopTracks();
    await context?.close().catch(() => undefined);
    throw error;
  }
}

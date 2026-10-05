/** Browser voice path: 48 kHz mono Opus in 20 ms frames via WebCodecs. PCM never leaves this module. */
const RATE = 48_000;
const FRAME = 960;
const OPUS = { codec: "opus", sampleRate: RATE, numberOfChannels: 1 } as const;
/** Startup jitter (~3 packets) and a bound that drops stale backlog. */
const LEAD_S = 0.06;
const MAX_AHEAD_S = 0.25;

// Collect exactly one Opus frame of PCM per message.
const CAPTURE = `registerProcessor("buzz-huddle-capture", class extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(${FRAME}); this.offset = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    for (let i = 0; input && i < input.length; ) {
      const n = Math.min(input.length - i, ${FRAME} - this.offset);
      this.buffer.set(input.subarray(i, i + n), this.offset);
      this.offset += n; i += n;
      if (this.offset === ${FRAME}) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(${FRAME}); this.offset = 0;
      }
    }
    return true;
  }
});`;

export type HuddleAudio = {
  setMuted(muted: boolean): void;
  play(peer: number, opus: Uint8Array): void;
  drop(peer: number): void;
  close(): void;
};

export function huddleAudioSupported() {
  return (
    typeof AudioEncoder === "function" &&
    typeof AudioDecoder === "function" &&
    typeof AudioWorkletNode === "function" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** dBov of one frame, clamped to the wire's -127…0 range. */
export function frameLevel(pcm: Float32Array) {
  let sum = 0;
  for (const sample of pcm) sum += sample * sample;
  const rms = Math.sqrt(sum / (pcm.length || 1));
  return rms > 0 ? Math.max(-127, Math.min(0, 20 * Math.log10(rms))) : -127;
}

/** Opens the microphone first so permission failures happen before any relay write. */
export async function startHuddleAudio(
  send: (opus: Uint8Array, timestamp: number, level: number) => void,
  onLevel: (level: number) => void,
): Promise<HuddleAudio> {
  if (!huddleAudioSupported())
    throw new Error("Huddles need a newer browser or system WebView.");
  const support = await AudioEncoder.isConfigSupported(OPUS);
  if (!support.supported)
    throw new Error("This device cannot encode Opus audio.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const context = new AudioContext({
    sampleRate: RATE,
    latencyHint: "interactive",
  });
  let closed = false;
  let muted = false;
  const levels: number[] = [];
  const peers = new Map<
    number,
    { decoder: AudioDecoder; next: number; timestamp: number }
  >();
  const encoder = new AudioEncoder({
    output(chunk) {
      const opus = new Uint8Array(chunk.byteLength);
      chunk.copyTo(opus);
      const level = levels.shift() ?? -127;
      if (!closed)
        send(opus, Math.round((chunk.timestamp * RATE) / 1e6), level);
    },
    error: () => {},
  });
  const url = URL.createObjectURL(
    new Blob([CAPTURE], { type: "text/javascript" }),
  );
  try {
    encoder.configure({
      ...OPUS,
      bitrate: 32_000,
      opus: { frameDuration: 20_000, application: "voip" },
    } as AudioEncoderConfig);
    await context.audioWorklet.addModule(url);
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, "buzz-huddle-capture");
  // Silent sink keeps the capture node pulled by the render graph.
  const sink = context.createGain();
  sink.gain.value = 0;
  source.connect(capture).connect(sink).connect(context.destination);
  let frames = 0;
  capture.port.onmessage = ({
    data,
  }: MessageEvent<Float32Array<ArrayBuffer>>) => {
    const timestamp = (frames++ * FRAME * 1e6) / RATE;
    if (closed || muted || encoder.state !== "configured") return;
    const level = frameLevel(data);
    onLevel(level);
    levels.push(level);
    const audio = new AudioData({
      format: "f32",
      sampleRate: RATE,
      numberOfFrames: FRAME,
      numberOfChannels: 1,
      timestamp,
      data,
    });
    encoder.encode(audio);
    audio.close();
  };
  void context.resume();

  function peer(index: number) {
    const existing = peers.get(index);
    if (existing && existing.decoder.state === "configured") return existing;
    const state = {
      next: 0,
      timestamp: 0,
      decoder: new AudioDecoder({
        output(data) {
          const pcm = new Float32Array(data.numberOfFrames);
          data.copyTo(pcm, { planeIndex: 0, format: "f32-planar" });
          const buffer = context.createBuffer(1, pcm.length, data.sampleRate);
          data.close();
          buffer.copyToChannel(pcm, 0);
          const node = context.createBufferSource();
          node.buffer = buffer;
          node.connect(context.destination);
          const now = context.currentTime;
          if (state.next < now + 0.01 || state.next > now + MAX_AHEAD_S)
            state.next = now + LEAD_S;
          node.start(state.next);
          state.next += buffer.duration;
        },
        // A corrupt packet closes the decoder; the next frame recreates it.
        error: () => {},
      }),
    };
    state.decoder.configure(OPUS);
    if (existing && existing.decoder.state !== "closed")
      existing.decoder.close();
    peers.set(index, state);
    return state;
  }

  function drop(index: number) {
    const state = peers.get(index);
    if (state && state.decoder.state !== "closed") state.decoder.close();
    peers.delete(index);
  }
  return {
    setMuted(next) {
      muted = next;
      levels.length = 0;
    },
    play(index, opus) {
      if (closed) return;
      const state = peer(index);
      state.timestamp += 20_000;
      state.decoder.decode(
        new EncodedAudioChunk({
          type: "key",
          timestamp: state.timestamp,
          data: opus,
        }),
      );
    },
    drop,
    close() {
      if (closed) return;
      closed = true;
      capture.port.onmessage = null;
      for (const track of stream.getTracks()) track.stop();
      if (encoder.state !== "closed") encoder.close();
      for (const index of [...peers.keys()]) drop(index);
      void context.close();
    },
  };
}

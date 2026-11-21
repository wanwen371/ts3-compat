// Browser audio engine for the TS3-compat P0 voice link.
//
//   capture:  getUserMedia -> AudioWorklet (960 samples @ 48 kHz = 20 ms)
//             -> WebCodecs AudioEncoder('opus', 48000, mono, application=voip)
//             -> one base64 Opus frame per 20 ms -> onFrame() -> WS "voiceFrame"
//
//   playback: WS "voice" event {from, codec, seq, data:base64}
//             -> playFrame() -> WebCodecs AudioDecoder('opus')
//             -> AudioData -> AudioBuffer -> per-client GainNode -> master -> speakers
//
// Encoded-voice parameters come from docs/protocol.md §10 (A-level evidence):
//   * Opus, 48 000 Hz, 960 samples per frame = 20 ms
//   * Opus Voice = mono, application=VOIP, signal=VOICE, bitrate (q+1)*4096 bps
//   * Opus Music = stereo, application=AUDIO,      bitrate (q+1)*7200 bps
// The TS3 *voice payload* (16-bit BE seq, numberVoicePackets, codec byte,
// whisper lists, EAX encryption) is built/parsed on the Node side
// (server/ts3/voice.js); this file only produces/consumes single Opus frames
// and therefore never needs the packet header layout.
//
// Degradation policy (required by the task): if WebCodecs (or the Opus
// encoder/decoder) is unavailable we never throw out of the UI path -- we
// report a structured onError() and keep the rest of the app usable:
//   * no Opus encoder -> capture cannot send; startCapture() resolves with
//     state.supported.encode === false and the client stays "listen only"
//   * no Opus decoder -> incoming voice frames are counted/dropped, playback
//     stays silent (state.supported.decode === false)
//   * no AudioWorklet -> ScriptProcessorNode fallback
//   * AudioContext not running at 48 kHz -> linear resampler to 48 kHz

const TARGET_SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 960; // 20 ms @ 48 kHz
const FRAME_MS = 20;
const CHANNEL_MIX_LOOKAHEAD_S = 0.03; // small jitter buffer before an AudioBuffer is scheduled
const MAX_SCHEDULE_AHEAD_S = 0.5; // resync if the playout queue drifts too far
const DEFAULT_QUALITY = 6; // app.js sends voiceQuality: 6
const CODEC_OPUS_VOICE = 4;
const CODEC_OPUS_MUSIC = 5;
const VAD_DEFAULT_THRESHOLD = 0.02; // RMS on float PCM
const VAD_DEFAULT_HOLD_MS = 350;

/** Inline AudioWorklet: accumulates arbitrary render blocks into 960-sample frames. */
const WORKLET_SOURCE = `
class Ts3CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(${FRAME_SAMPLES});
    this.fill = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, this.frame.length - this.fill);
      this.frame.set(ch.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.frame.length) {
        this.port.postMessage(this.frame.slice());
        this.fill = 0;
      }
    }
    return true;
  }
}
registerProcessor('ts3-capture', Ts3CaptureProcessor);
`;

const WORKLET_NAME = 'ts3-capture';

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toUint8Array(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    // base64 (with or without data: URL prefix)
    const clean = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/** base64 without blowing the call-stack on large-ish frames (voice frames are <300 B). */
function toBase64(bytes) {
  let binary = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Cheap linear resampler for AudioContexts that cannot be created at 48 kHz. */
class LinearResampler {
  constructor(fromRate, toRate) {
    this.step = fromRate / toRate;
    this.pos = 0;
    this.last = 0;
    this.hasLast = false;
  }

  push(input) {
    const out = [];
    let pos = this.pos;
    let last = this.last;
    let hasLast = this.hasLast;
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i];
      if (!hasLast) {
        last = current;
        hasLast = true;
        continue;
      }
      while (pos <= 1) {
        out.push(last + (current - last) * pos);
        pos += this.step;
      }
      pos -= 1;
      last = current;
    }
    this.pos = pos;
    this.last = last;
    this.hasLast = hasLast;
    return Float32Array.from(out);
  }
}

function computeRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------

/**
 * Create the browser audio engine.
 *
 * @param {object} [options]
 * @param {(frame:{codec:number,data:string,seq:number,bytes:number,timestamp:number})=>void} [options.onFrame]
 *        Called once per 20 ms Opus frame with base64 data; the WS bridge sends
 *        it as `{op:"voiceFrame", codec, data}` (docs/api.md).
 * @param {(error:{code:string,message:string})=>void} [options.onError]
 *        Structured, non-throwing error reporting (also used for degradation notices).
 * @param {number} [options.codec=4]   4 = Opus Voice (mono), 5 = Opus Music (stereo)
 * @param {number} [options.quality=6] 0..10 -> bitrate (q+1)*4096 (voice) / *7200 (music)
 * @param {'ptt'|'vad'|'open'} [options.mode='ptt'] initial capture gate
 * @param {number} [options.vadThreshold]
 * @returns {Promise<object>} engine API:
 *   { startCapture, stopCapture, playFrame, setMasterVolume, setClientVolume,
 *     setPTT, getState, setMode, setQuality, setInputMuted, setOutputMuted,
 *     setVad, setClientMuted, clearClient, clearAllClients, close }
 */
export async function createAudioEngine({
  onFrame = null,
  onError = null,
  onLevel = null,
  settings = null,
  codec = CODEC_OPUS_VOICE,
  quality = DEFAULT_QUALITY,
  mode = 'ptt',
  vadThreshold = VAD_DEFAULT_THRESHOLD,
  vadHoldMs = VAD_DEFAULT_HOLD_MS,
  autoCapture = true,
} = {}) {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const hasApis = typeof AudioEncoder === 'function' && typeof AudioData === 'function';
  const hasDecodeApis = typeof AudioDecoder === 'function' && typeof EncodedAudioChunk === 'function';
  const hasAudioContext = typeof AudioContext === 'function' || typeof webkitAudioContext === 'function';

  const state = {
    supported: {
      media: Boolean(nav?.mediaDevices?.getUserMedia),
      audioContext: hasAudioContext,
      // AudioWorkletProcessor only exists inside the worklet scope; the main-thread
      // capability is AudioWorkletNode + AudioContext.audioWorklet (checked at runtime).
      audioWorklet: typeof AudioWorkletNode === 'function',
      encode: hasApis,
      decode: hasDecodeApis,
      /** set after AudioEncoder.isConfigSupported('opus', 48 kHz ...) */
      encodeOpus: null,
      /** set after AudioDecoder.isConfigSupported('opus', 48 kHz ...) */
      decodeOpus: null,
    },
    capturing: false,
    mode,
    pttActive: false,
    inputMuted: false,
    outputMuted: false,
    deafened: false,
    /** true while the local Opus capture stream is actually encoding */
    sending: false,
    /** microphone constraints requested from getUserMedia (mapped from UI settings) */
    constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    /** device selection from the UI settings page (null = browser default) */
    inputDevice: null,
    outputDevice: null,
    masterVolume: 1,
    codec,
    quality: clamp(Math.trunc(quality), 0, 10),
    vadThreshold,
    vadHoldMs,
    clientVolumes: new Map(),
    stats: {
      framesSent: 0,
      bytesSent: 0,
      framesDecoded: 0,
      framesDropped: 0,
      decodeErrors: 0,
      captureStartedAt: null,
      lastFrameBytes: 0,
      averageFrameBytes: 0,
      framesPerSecond: 0,
    },
    clientCount: 0,
    lastError: null,
    closed: false,
  };

  /** @type {AudioContext|null} */
  let ctx = null;
  /** @type {MediaStream|null} */
  let stream = null;
  /** @type {MediaStreamAudioSourceNode|null} */
  let sourceNode = null;
  /** @type {AudioWorkletNode|ScriptProcessorNode|null} */
  let captureNode = null;
  /** @type {AudioEncoder|null} */
  let encoder = null;
  /** @type {GainNode|null} */
  let masterGain = null;

  let captureSink = null; // (Float32Array) => void
  let resampler = null;
  let pending = new Float32Array(FRAME_SAMPLES); // resampled 48 kHz mono input
  let pendingFill = 0;
  let micFrame = new Float32Array(FRAME_SAMPLES);
  let encodeTimestampUs = 0;
  let nextSeq = 0;
  let vadHoldUntil = 0;
  let lastLevel = 0;
  let degradationReported = false;
  let captureStarting = false;
  /** codec actually produced by the capture encoder (always Opus Voice/mono in P0) */
  const CAPTURE_CODEC = CODEC_OPUS_VOICE;

  /** @type {Map<number, {gain:GainNode, decoder:AudioDecoder|null, nextTime:number, channels:number, failed:boolean}>} */
  const players = new Map();

  function report(code, message, extra = null) {
    state.lastError = { code: code, message };
    try {
      onError?.({ code, message, ...(extra ?? {}) });
    } catch {
      /* never let a listener break audio */
    }
  }

  function reportOnce(code, message) {
    if (degradationReported && state.lastError?.code === code) return;
    degradationReported = true;
    report(code, message);
  }

  function ensureContext() {
    if (!state.supported.audioContext) throw Object.assign(new Error('Web Audio API is not available'), { code: 'no_audio_context' });
    if (ctx) return ctx;
    const Ctor = typeof AudioContext === 'function' ? AudioContext : webkitAudioContext;
    try {
      ctx = new Ctor({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' });
    } catch {
      // Some engines refuse the sampleRate option; resample instead.
      ctx = new Ctor();
    }
    masterGain = ctx.createGain();
    masterGain.gain.value = state.outputMuted ? 0 : state.masterVolume;
    masterGain.connect(ctx.destination);
    if (ctx.sampleRate !== TARGET_SAMPLE_RATE) {
      resampler = new LinearResampler(ctx.sampleRate, TARGET_SAMPLE_RATE);
      report(
        'resampling',
        `AudioContext runs at ${ctx.sampleRate} Hz; resampling capture to ${TARGET_SAMPLE_RATE} Hz`,
      );
    }
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    applyOutputDevice();
    return ctx;
  }

  function bitrateFor(q) {
    const base = state.codec === CODEC_OPUS_MUSIC ? 7200 : 4096;
    return (clamp(q, 0, 10) + 1) * base;
  }

  function opusEncoderConfig(q) {
    // P0 captures mono Opus Voice. Opus Music (codec 5) is stereo for *playback*
    // here; stereo capture needs a 2-channel worklet path (P1).
    return {
      codec: 'opus',
      sampleRate: TARGET_SAMPLE_RATE,
      numberOfChannels: 1,
      bitrate: bitrateFor(q),
      opus: {
        application: 'voip',
        signal: 'voice',
        frameDuration: FRAME_MS * 1000, // microseconds
      },
    };
  }

  async function probeEncoderSupport() {
    if (!hasApis) {
      state.supported.encodeOpus = false;
      return false;
    }
    try {
      if (typeof AudioEncoder.isConfigSupported === 'function') {
        const res = await AudioEncoder.isConfigSupported(opusEncoderConfig(state.quality));
        state.supported.encodeOpus = Boolean(res?.supported);
        return state.supported.encodeOpus;
      }
      state.supported.encodeOpus = true;
      return true;
    } catch {
      state.supported.encodeOpus = false;
      return false;
    }
  }

  async function probeDecoderSupport(channels = 1) {
    if (!hasDecodeApis) {
      state.supported.decodeOpus = false;
      return false;
    }
    try {
      if (typeof AudioDecoder.isConfigSupported === 'function') {
        const res = await AudioDecoder.isConfigSupported({
          codec: 'opus',
          sampleRate: TARGET_SAMPLE_RATE,
          numberOfChannels: channels,
        });
        state.supported.decodeOpus = Boolean(res?.supported);
        return state.supported.decodeOpus;
      }
      state.supported.decodeOpus = true;
      return true;
    } catch {
      state.supported.decodeOpus = false;
      return false;
    }
  }

  function captureGateOpen() {
    if (state.inputMuted || state.deafened) return false;
    if (state.mode === 'open') return true;
    if (state.mode === 'vad') return now() < vadHoldUntil;
    // 'ptt': also allow VAD-assisted framing while the key is held
    return state.pttActive;
  }

  function onEncodedChunk(chunk) {
    try {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      // `data` is raw bytes (web/app.js base64-encodes it for the WS frame);
      // `base64` is provided for consumers that talk to the backend directly.
      const frame = {
        codec: CAPTURE_CODEC,
        data: bytes,
        base64: toBase64(bytes),
        seq: nextSeq,
        bytes: bytes.length,
        timestamp: now(),
        durationMs: FRAME_MS,
      };
      nextSeq = (nextSeq + 1) & 0xffff;
      state.stats.framesSent += 1;
      state.stats.bytesSent += bytes.length;
      state.stats.lastFrameBytes = bytes.length;
      state.stats.averageFrameBytes = state.stats.bytesSent / state.stats.framesSent;
      const elapsed = state.stats.captureStartedAt ? (now() - state.stats.captureStartedAt) / 1000 : 0;
      if (elapsed > 0) state.stats.framesPerSecond = state.stats.framesSent / elapsed;
      onFrame?.(frame);
    } catch (error) {
      report('frame_encode_output', `could not emit encoded frame: ${error.message}`);
    }
  }

  function feedEncoder(samples) {
    if (!encoder || encoder.state !== 'configured') return;
    try {
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: TARGET_SAMPLE_RATE,
        numberOfFrames: FRAME_SAMPLES,
        numberOfChannels: 1,
        timestamp: encodeTimestampUs,
        data: samples instanceof Float32Array ? samples : Float32Array.from(samples),
      });
      encodeTimestampUs += FRAME_MS * 1000;
      encoder.encode(audioData);
      audioData.close();
    } catch (error) {
      report('encode_failed', `AudioEncoder.encode() failed: ${error.message}`);
    }
  }

  function handlePcm48(samples) {
    if (!state.capturing) return;
    let off = 0;
    while (off < samples.length) {
      const n = Math.min(samples.length - off, FRAME_SAMPLES - pendingFill);
      pending.set(samples.subarray(off, off + n), pendingFill);
      pendingFill += n;
      off += n;
      if (pendingFill === FRAME_SAMPLES) {
        micFrame.set(pending);
        pendingFill = 0;
        const level = computeRms(micFrame);
        lastLevel = level;
        try {
          onLevel?.(level);
        } catch {
          /* a level listener must never break capture */
        }
        if (level > state.vadThreshold) vadHoldUntil = now() + state.vadHoldMs;
        if (captureGateOpen()) feedEncoder(micFrame);
      }
    }
  }

  function handleRawCapture(chunk) {
    if (!state.capturing) return;
    if (!resampler) return handlePcm48(chunk);
    const converted = resampler.push(chunk);
    if (converted.length > 0) handlePcm48(converted);
  }

  async function setupCaptureGraph() {
    const context = ensureContext();
    if (!stream) throw Object.assign(new Error('microphone stream is not open'), { code: 'no_stream' });
    sourceNode = context.createMediaStreamSource(stream);

    if (state.supported.audioWorklet) {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(context, WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
          channelCountMode: 'explicit',
          processorOptions: { frameSamples: FRAME_SAMPLES },
        });
        node.port.onmessage = (event) => {
          if (event.data && event.data.length) handleRawCapture(new Float32Array(event.data));
        };
        sourceNode.connect(node);
        captureNode = node;
        return;
      } catch (error) {
        report('worklet_failed', `AudioWorklet unavailable (${error.message}); falling back to ScriptProcessorNode`);
      }
    }

    // Fallback: ScriptProcessorNode (deprecated but widely available).
    const bufferSize = 4096;
    const node = context.createScriptProcessor(bufferSize, 1, 1);
    node.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      handleRawCapture(Float32Array.from(input));
    };
    const sink = context.createGain();
    sink.gain.value = 0;
    sourceNode.connect(node);
    node.connect(sink);
    sink.connect(context.destination);
    captureNode = node;
  }

  function teardownCaptureGraph() {
    if (captureNode) {
      try {
        captureNode.port && (captureNode.port.onmessage = null);
      } catch {
        /* ignore */
      }
      try {
        captureNode.onaudioprocess = null;
      } catch {
        /* ignore */
      }
      try {
        captureNode.disconnect();
      } catch {
        /* ignore */
      }
      captureNode = null;
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {
        /* ignore */
      }
      sourceNode = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      stream = null;
    }
    pendingFill = 0;
    micFill = 0;
    resampler = null;
  }

  // -------------------------------------------------------------------------
  // playback
  // -------------------------------------------------------------------------

  function getPlayer(clid) {
    let player = players.get(clid);
    if (player) return player;
    const context = ensureContext();
    const gain = context.createGain();
    gain.gain.value = state.clientVolumes.get(clid) ?? 1;
    gain.connect(masterGain);
    player = { gain, decoder: null, nextTime: 0, channels: state.codec === CODEC_OPUS_MUSIC ? 2 : 1, failed: false };
    players.set(clid, player);
    state.clientCount = players.size;
    return player;
  }

  function destroyPlayer(clid) {
    const player = players.get(clid);
    if (!player) return;
    try {
      player.decoder?.close?.();
    } catch {
      /* ignore */
    }
    try {
      player.gain.disconnect();
    } catch {
      /* ignore */
    }
    players.delete(clid);
    state.clientCount = players.size;
  }

  function audioDataToPlanar(audioData) {
    const frames = audioData.numberOfFrames;
    const channels = audioData.numberOfChannels;
    const out = new Float32Array(frames * channels);
    const format = String(audioData.format ?? 'f32-planar');
    const planar = format.endsWith('-planar');
    if (planar) {
      for (let c = 0; c < channels; c += 1) {
        const dest = out.subarray(c * frames, (c + 1) * frames);
        try {
          audioData.copyTo(dest, { planeIndex: c, format: 'f32-planar' }); // decoder-requested conversion
        } catch {
          // some engines only convert from/to the native format: read natively then scale
          const temp = new Float32Array(frames);
          audioData.copyTo(temp, { planeIndex: c });
          dest.set(temp);
        }
      }
      return { data: out, channels, frames };
    }
    // interleaved -> planar
    const interleaved = new Float32Array(frames * channels);
    try {
      audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32' });
    } catch {
      audioData.copyTo(interleaved, { planeIndex: 0 });
    }
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < channels; c += 1) out[c * frames + i] = interleaved[i * channels + c];
    }
    return { data: out, channels, frames };
  }

  function scheduleAudioData(clid, audioData) {
    const player = getPlayer(clid);
    const context = ensureContext();
    const { data, channels, frames } = audioDataToPlanar(audioData);
    const buffer = context.createBuffer(channels, frames, TARGET_SAMPLE_RATE);
    for (let c = 0; c < channels; c += 1) {
      buffer.copyToChannel(data.subarray(c * frames, (c + 1) * frames), c);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(player.gain);
    const startAt = Math.max(context.currentTime + CHANNEL_MIX_LOOKAHEAD_S, player.nextTime);
    if (startAt > context.currentTime + MAX_SCHEDULE_AHEAD_S) {
      // fell far behind (tab throttled / garbage timestamps): drop the backlog
      player.nextTime = context.currentTime + CHANNEL_MIX_LOOKAHEAD_S;
    }
    try {
      source.start(startAt);
    } catch {
      source.start();
    }
    player.nextTime = startAt + frames / TARGET_SAMPLE_RATE;
    source.onended = () => {
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
    };
    state.stats.framesDecoded += 1;
  }

  function ensureDecoder(clid, channels) {
    const player = getPlayer(clid);
    if (player.decoder && player.channels === channels) return player.decoder;
    try {
      player.decoder?.close?.();
    } catch {
      /* ignore */
    }
    const decoder = new AudioDecoder({
      output: (audioData) => {
        try {
          scheduleAudioData(clid, audioData);
        } catch (error) {
          state.stats.decodeErrors += 1;
          report('playout_failed', `could not schedule decoded audio for client ${clid}: ${error.message}`);
        } finally {
          audioData.close();
        }
      },
      error: (error) => {
        state.stats.decodeErrors += 1;
        player.failed = true;
        report('decode_error', `AudioDecoder error for client ${clid}: ${error.message}`);
      },
    });
    decoder.configure({ codec: 'opus', sampleRate: TARGET_SAMPLE_RATE, numberOfChannels: channels });
    player.decoder = decoder;
    player.channels = channels;
    return decoder;
  }

  // -------------------------------------------------------------------------
  // public API
  // -------------------------------------------------------------------------

  async function startCapture(options = {}) {
    if (state.closed) throw Object.assign(new Error('audio engine is closed'), { code: 'closed' });
    if (state.capturing) return getState();
    if (options.mode) state.mode = options.mode;
    if (options.quality != null) state.quality = clamp(Math.trunc(options.quality), 0, 10);
    if (options.codec != null) state.codec = options.codec;

    if (!state.supported.media) {
      report('no_media', 'getUserMedia is not available in this browser; voice capture stays disabled');
      return getState();
    }
    if (!state.supported.audioContext) {
      report('no_audio_context', 'Web Audio API is not available; voice capture stays disabled');
      return getState();
    }

    const encSupported = await probeEncoderSupport();
    if (!encSupported) {
      reportOnce(
        'webcodecs_unsupported',
        'WebCodecs Opus encoder is unavailable in this browser, so this client is listen-only (voice will not be sent)',
      );
      return getState();
    }
    await probeDecoderSupport(state.codec === CODEC_OPUS_MUSIC ? 2 : 1);
    if (!state.supported.decodeOpus) {
      reportOnce('webcodecs_decoder_unsupported', 'WebCodecs Opus decoder is unavailable; incoming voice will be silent');
    }

    try {
      ensureContext();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') await ctx.resume();
      stream = await nav.mediaDevices.getUserMedia({
        audio: {
          ...(state.inputDevice ? { deviceId: { exact: state.inputDevice } } : {}),
          channelCount: 1,
          echoCancellation: state.constraints.echoCancellation !== false,
          noiseSuppression: state.constraints.noiseSuppression !== false,
          autoGainControl: state.constraints.autoGainControl !== false,
          sampleRate: TARGET_SAMPLE_RATE,
        },
        video: false,
      });
    } catch (error) {
      report('get_user_media_failed', `microphone access failed: ${error.message}`);
      return getState();
    }

    try {
      encoder = new AudioEncoder({
        output: onEncodedChunk,
        error: (error) => report('encoder_error', `AudioEncoder error: ${error.message}`),
      });
      encoder.configure(opusEncoderConfig(state.quality));
      await setupCaptureGraph();
    } catch (error) {
      report('capture_setup_failed', `could not initialise capture: ${error.message}`);
      try {
        encoder?.close?.();
      } catch {
        /* ignore */
      }
      encoder = null;
      teardownCaptureGraph();
      return getState();
    }

    state.capturing = true;
    state.sending = true;
    state.stats.captureStartedAt = now();
    encodeTimestampUs = 0;
    nextSeq = 0;
    pendingFill = 0;
    vadHoldUntil = 0;
    return getState();
  }

  async function stopCapture() {
    if (!state.capturing && !encoder) return getState();
    state.capturing = false;
    state.sending = false;
    try {
      encoder?.state === 'configured' && encoder.flush?.();
    } catch {
      /* ignore */
    }
    try {
      encoder?.close?.();
    } catch {
      /* ignore */
    }
    encoder = null;
    teardownCaptureGraph();
    return getState();
  }

  /**
   * Decode + mix one incoming Opus frame.
   * @param {{from:number, codec?:number, seq?:number, data:string|Uint8Array|ArrayBuffer}} frame
   */
  function playFrame(frame) {
    if (!frame || state.closed) return false;
    if (state.outputMuted || (state.masterVolume ?? 1) === 0) return false;
    if (!state.supported.decode) {
      reportOnce('webcodecs_decoder_unsupported', 'WebCodecs Opus decoder is unavailable; incoming voice is decoded as silence');
      state.stats.framesDropped += 1;
      return false;
    }
    const clid = Number.isFinite(frame.from) ? frame.from : -1;
    const bytes = toUint8Array(frame.data);
    if (!bytes || bytes.length === 0) {
      state.stats.framesDropped += 1;
      return false;
    }
    const channels = frame.codec === CODEC_OPUS_MUSIC ? 2 : 1;
    try {
      const decoder = ensureDecoder(clid, channels);
      if (decoder.decodeQueueSize > 32) {
        state.stats.framesDropped += 1;
        return false;
      }
      const timestamp = Number.isFinite(frame.timestamp) ? frame.timestamp * 1000 : now() * 1000;
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.max(0, Math.round(timestamp)), data: bytes }));
      return true;
    } catch (error) {
      state.stats.decodeErrors += 1;
      state.stats.framesDropped += 1;
      report('decode_failed', `could not decode a voice frame: ${error.message}`);
      return false;
    }
  }

  function setMasterVolume(volume) {
    state.masterVolume = clamp(Number(volume) || 0, 0, 1);
    if (masterGain) masterGain.gain.value = state.outputMuted ? 0 : state.masterVolume;
    return state.masterVolume;
  }

  function setClientVolume(clid, volume) {
    const value = clamp(Number(volume) || 0, 0, 1);
    state.clientVolumes.set(Number(clid), value);
    const player = players.get(Number(clid));
    if (player) player.gain.gain.value = state.outputMuted ? 0 : value;
    return value;
  }

  function setClientMuted(clid, muted = true) {
    return setClientVolume(clid, muted ? 0 : 1);
  }

  function setPTT(active) {
    state.pttActive = Boolean(active);
    // web/app.js calls setPTT() without an explicit startCapture(); the first
    // key press lazily opens the microphone so PTT works out of the box.
    if (state.pttActive && !state.capturing && !captureStarting && !state.closed) {
      captureStarting = true;
      Promise.resolve()
        .then(() => startCapture())
        .catch((error) => report('capture_autostart_failed', error.message))
        .finally(() => {
          captureStarting = false;
        });
    }
    return state.pttActive;
  }

  function setMode(nextMode) {
    if (nextMode === 'ptt' || nextMode === 'vad' || nextMode === 'open') state.mode = nextMode;
    return state.mode;
  }

  function setInputMuted(muted) {
    state.inputMuted = Boolean(muted);
    return state.inputMuted;
  }

  function setOutputMuted(muted) {
    state.outputMuted = Boolean(muted);
    if (masterGain) masterGain.gain.value = state.outputMuted ? 0 : state.masterVolume;
    return state.outputMuted;
  }

  function setQuality(q) {
    state.quality = clamp(Math.trunc(q), 0, 10);
    if (encoder && encoder.state === 'configured') {
      try {
        encoder.configure(opusEncoderConfig(state.quality));
      } catch (error) {
        report('encoder_reconfigure_failed', `could not change encoder quality: ${error.message}`);
      }
    }
    return state.quality;
  }

  function setVad(enabled, threshold) {
    state.mode = enabled ? 'vad' : 'ptt';
    if (threshold != null) state.vadThreshold = clamp(Number(threshold) || 0, 0, 1);
    return { mode: state.mode, threshold: state.vadThreshold };
  }

  function clearClient(clid) {
    destroyPlayer(Number(clid));
    state.clientVolumes.delete(Number(clid));
  }

  function clearAllClients() {
    for (const clid of Array.from(players.keys())) destroyPlayer(clid);
    state.clientVolumes.clear();
  }

  function applyOutputDevice() {
    if (!ctx || !state.outputDevice || typeof ctx.setSinkId !== 'function') return;
    try {
      const result = ctx.setSinkId(state.outputDevice);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => report('output_device_failed', `could not select output device: ${error.message}`));
      }
    } catch (error) {
      report('output_device_failed', `could not select output device: ${error.message}`);
    }
  }

  function setConstraintsFromSettings(settings = {}) {
    const next = {
      echoCancellation: settings.aec !== false,
      noiseSuppression: settings.noiseSuppression !== false,
      autoGainControl: settings.agc !== false,
    };
    const changed =
      next.echoCancellation !== state.constraints.echoCancellation ||
      next.noiseSuppression !== state.constraints.noiseSuppression ||
      next.autoGainControl !== state.constraints.autoGainControl;
    state.constraints = next;
    return changed;
  }

  function applySettings(settings = {}) {
    if (!settings || typeof settings !== 'object') return getState();
    const wasCapturing = state.capturing;
    if (settings.codec != null) state.codec = Number(settings.codec) === CODEC_OPUS_MUSIC ? CODEC_OPUS_MUSIC : CODEC_OPUS_VOICE;
    if (settings.quality != null) setQuality(settings.quality);
    if (settings.masterVolume != null) setMasterVolume(settings.masterVolume);
    if (settings.clientVolumes && typeof settings.clientVolumes === 'object') {
      for (const [clid, volume] of Object.entries(settings.clientVolumes)) {
        setClientVolume(Number(clid), volume);
      }
    }
    if (settings.vad != null) state.mode = settings.vad ? 'vad' : state.mode === 'open' ? 'open' : 'ptt';
    if ('inputDevice' in settings) state.inputDevice = settings.inputDevice || null;
    if ('outputDevice' in settings) {
      state.outputDevice = settings.outputDevice || null;
      applyOutputDevice();
    }
    const constraintsChanged = setConstraintsFromSettings(settings);
    if (wasCapturing && constraintsChanged) {
      // microphone processing can only be changed by re-opening the stream
      Promise.resolve()
        .then(() => stopCapture())
        .then(() => startCapture())
        .catch((error) => report('apply_settings_failed', error.message));
    }
    return getState();
  }

  async function init(settings = {}) {
    applySettings(settings);
    if (autoCapture && !state.capturing) {
      captureStarting = true;
      try {
        await startCapture();
      } catch (error) {
        report('capture_init_failed', error.message);
      } finally {
        captureStarting = false;
      }
    }
    return getState();
  }

  /** Self mute (UI: state.self.muted) — stops sending but keeps the mic warm. */
  function setMuted(muted) {
    return setInputMuted(muted);
  }

  /** Deafen (UI: state.self.deafened) — mutes playback; also blocks sending like TS3. */
  function setDeafened(deafened) {
    state.deafened = Boolean(deafened);
    if (state.deafened) {
      state.outputMuted = true;
      if (masterGain) masterGain.gain.value = 0;
    } else {
      state.outputMuted = false;
      if (masterGain) masterGain.gain.value = state.masterVolume;
    }
    return state.deafened;
  }

  function getState() {
    const stats = { ...state.stats };
    stats.averageFrameBytes = stats.framesSent ? stats.bytesSent / stats.framesSent : 0;
    if (stats.captureStartedAt && state.capturing) {
      const elapsed = (now() - stats.captureStartedAt) / 1000;
      stats.framesPerSecond = elapsed > 0 ? stats.framesSent / elapsed : 0;
    }
    return {
      supported: { ...state.supported },
      capturing: state.capturing,
      mode: state.mode,
      pttActive: state.pttActive,
      inputMuted: state.inputMuted,
      outputMuted: state.outputMuted,
      deafened: state.deafened,
      sending: state.sending,
      constraints: { ...state.constraints },
      inputDevice: state.inputDevice,
      outputDevice: state.outputDevice,
      clientVolumes: Object.fromEntries(state.clientVolumes),
      codec: state.codec,
      quality: state.quality,
      vadThreshold: state.vadThreshold,
      clientCount: players.size,
      lastLevel,
      stats,
      lastError: state.lastError,
      frameSamples: FRAME_SAMPLES,
      frameMs: FRAME_MS,
      sampleRate: TARGET_SAMPLE_RATE,
      /** wire-format reminder for the UI (see server/ts3/voice.js) */
      maxPayloadBytes: 489, // VOICE packet 500 B - 11 B plaintext header
    };
  }

  async function close() {
    state.closed = true;
    await stopCapture();
    for (const clid of Array.from(players.keys())) destroyPlayer(clid);
    try {
      masterGain?.disconnect();
    } catch {
      /* ignore */
    }
    masterGain = null;
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        /* ignore */
      }
      ctx = null;
    }
  }

  if (settings) applySettings(settings);

  // Report capability problems up-front so the UI can disable the PTT button.
  if (!state.supported.media) reportOnce('no_media', 'getUserMedia is not available; microphone capture disabled');
  else if (!state.supported.encode) reportOnce('webcodecs_unsupported', 'WebCodecs AudioEncoder is not available; capture disabled (listen-only)');
  if (!state.supported.decode) reportOnce('webcodecs_decoder_unsupported', 'WebCodecs AudioDecoder is not available; playback disabled');

  return {
    init,
    applySettings,
    setMuted,
    setDeafened,
    startCapture,
    stopCapture,
    playFrame,
    setMasterVolume,
    setClientVolume,
    setClientMuted,
    setPTT,
    setMode,
    setQuality,
    setInputMuted,
    setOutputMuted,
    setVad,
    clearClient,
    clearAllClients,
    getState,
    close,
    /** convenience for UI code that wants to know whether sending is possible */
    canSend: () => Boolean(state.supported.encodeOpus),
    canReceive: () => Boolean(state.supported.decodeOpus),
    constants: {
      SAMPLE_RATE: TARGET_SAMPLE_RATE,
      FRAME_SAMPLES,
      FRAME_MS,
      CODEC_OPUS_VOICE,
      CODEC_OPUS_MUSIC,
    },
  };
}

export default createAudioEngine;

export const AUDIO_CONSTANTS = Object.freeze({
  SAMPLE_RATE: TARGET_SAMPLE_RATE,
  FRAME_SAMPLES,
  FRAME_MS,
  CODEC_OPUS_VOICE,
  CODEC_OPUS_MUSIC,
});
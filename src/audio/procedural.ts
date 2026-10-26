import type { SoundDefinition } from "../data/sounds";

export interface SoundVoice {
  output: AudioNode;
  stop(at?: number): void;
}
export type NoiseColor = "white" | "pink" | "brown";

export function noiseSamples(
  length: number,
  color: NoiseColor,
  random = Math.random,
): Float32Array {
  const data = new Float32Array(length);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0,
    brown = 0;
  for (let i = 0; i < length; i++) {
    const w = random() * 2 - 1;
    if (color === "brown") {
      brown = (brown + 0.02 * w) / 1.02;
      data[i] = brown * 3.5;
    } else if (color === "pink") {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else data[i] = w;
  }
  return data;
}

/** Rotate through an overlap so the wrap continues from the head into the body. */
export function loopSamples(
  input: Float32Array,
  overlap: number,
): Float32Array {
  const n = Math.min(
    Math.max(0, Math.floor(overlap)),
    Math.floor(input.length / 2),
  );
  if (!n) return input.slice();
  const out = input.slice(n);
  for (let i = 0; i < n; i++) {
    const w = n === 1 ? 1 : i / (n - 1);
    out[out.length - n + i] =
      input[input.length - n + i] * (1 - w) + input[i] * w;
  }
  return out;
}

export function seamlessBuffer(
  ctx: BaseAudioContext,
  input: AudioBuffer,
): AudioBuffer {
  const overlap = Math.min(
    Math.floor(ctx.sampleRate * 0.5),
    Math.floor(input.length / 4),
  );
  const out = ctx.createBuffer(
    input.numberOfChannels,
    input.length - overlap,
    input.sampleRate,
  );
  for (let channel = 0; channel < input.numberOfChannels; channel++) {
    out.copyToChannel(
      loopSamples(
        input.getChannelData(channel),
        overlap,
      ) as Float32Array<ArrayBuffer>,
      channel,
    );
  }
  return out;
}

export function bufferVoice(
  ctx: AudioContext,
  buffer: AudioBuffer,
): SoundVoice {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return {
    output: source,
    stop(at = ctx.currentTime) {
      source.stop(at);
      source.onended = () => source.disconnect();
    },
  };
}

const buffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

export type SceneKind = "exam-hall" | "thunderstorm" | "record-static" | "copper-chimes";

/** Quiet events placed away from the seam; audio-clock buffers need no JS timers. */
export function sceneSamples(sampleRate: number, kind: SceneKind, random = Math.random): Float32Array {
  const data = new Float32Array(sampleRate * 32);
  const event = (at: number, duration: number, amplitude: number, hz = 0) => {
    const count = Math.floor(duration * sampleRate), start = Math.floor(at * sampleRate);
    let smooth = 0;
    for (let i = 0; i < count && start + i < data.length; i++) {
      const t = i / sampleRate;
      const envelope = Math.sin(Math.PI * i / count) ** 2;
      // Thunder is low, rolling noise. Paper and record crackle stay brighter.
      const white = random() * 2 - 1;
      smooth = 0.985 * smooth + 0.015 * white;
      const signal = hz
        ? (Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(2 * Math.PI * hz * 2.76 * t)) / 1.3
        : kind === "thunderstorm" ? smooth * 4 : white;
      data[start + i] += amplitude * envelope * signal * (hz ? Math.exp(-t * 1.3) : 1);
    }
  };
  if (kind === "thunderstorm") {
    event(2, 7, 0.9); event(14, 5, 0.65); event(23, 7, 0.8);
  } else if (kind === "copper-chimes") {
    for (let t = 1; t < 28; t += 2 + random() * 3)
      event(t, 3, 0.45, [523.25, 659.25, 783.99, 1046.5][Math.floor(random() * 4)]);
  } else if (kind === "exam-hall") {
    for (let t = 0.5; t < 30; t += 0.8 + random() * 2) {
      event(t, 0.12 + random() * 0.3, 0.08); // pencil strokes
      if (random() > 0.65) event(t + 0.3, 0.6, 0.14); // turning a page
    }
  } else {
    for (let t = 0.1; t < 31.8; t += 0.08 + random() * 0.5)
      event(t, 0.002 + random() * 0.006, 0.12 + random() * 0.16);
  }
  return data;
}

export function createProcedural(
  ctx: AudioContext,
  sound: SoundDefinition,
): SoundVoice {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const own = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const start = <T extends AudioScheduledSourceNode>(node: T): T => {
    own(node);
    sources.push(node);
    node.start();
    return node;
  };
  const gain = (v: number) => {
    const g = own(ctx.createGain());
    g.gain.value = v;
    return g;
  };
  const output = gain(0.25);
  const oscillator = (hz: number) => {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    return start(o);
  };
  const filter = (type: BiquadFilterType, hz: number, q = 0.7) => {
    const f = own(ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  };
  const modulate = (param: AudioParam, hz: number, depth: number) => {
    oscillator(hz).connect(gain(depth)).connect(param);
  };
  const noise = (color: NoiseColor) => {
    let cache = buffers.get(ctx);
    if (!cache) {
      cache = new Map();
      buffers.set(ctx, cache);
    }
    let buffer = cache.get(color);
    if (!buffer) {
      const raw = noiseSamples(ctx.sampleRate * 12, color);
      const samples = loopSamples(raw, ctx.sampleRate / 2);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      cache.set(color, buffer);
    }
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    return start(s);
  };
  const clicks = (kind: string) => {
    // A whole buffer on the audio clock keeps events running in background tabs.
    const data = new Float32Array(ctx.sampleRate * 24);
    const event = (
      time: number,
      amplitude: number,
      length: number,
      frequency = 0,
    ) => {
      const from = Math.floor(time * ctx.sampleRate);
      const count = Math.floor(length * ctx.sampleRate);
      for (let i = 0; i < count && from + i < data.length; i++) {
        data[from + i] +=
          amplitude *
          Math.exp(-i / (count / 6)) *
          (frequency
            ? Math.sin((2 * Math.PI * frequency * i) / ctx.sampleRate)
            : Math.random() * 2 - 1);
      }
    };
    if (kind === "clock")
      for (let t = 0; t < 24; t++) event(t, 0.8, 0.04, t % 2 ? 1700 : 2200);
    else if (kind === "train")
      for (let t = 0; t < 24; t += 0.8) {
        event(t, 0.7, 0.06);
        event(t + 0.14, 0.5, 0.04);
      }
    else {
      const rain = kind === "rain" || kind === "heavy-rain";
      const interval = kind === "keyboard" ? 0.12 : rain ? 0.07 : 0.25;
      for (
        let t = 0.05;
        t < 23.8;
        t += interval + Math.random() * interval * 3
      ) {
        event(
          t,
          rain ? 0.12 : 0.3 + Math.random() * 0.5,
          rain ? 0.025 : 0.018,
          rain ? 1500 + Math.random() * 2200 : 0,
        );
      }
    }
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    start(s).connect(output);
  };
  const scene = (kind: SceneKind) => {
    let cache = buffers.get(ctx);
    if (!cache) { cache = new Map(); buffers.set(ctx, cache); }
    let buffer = cache.get(kind);
    if (!buffer) {
      const samples = sceneSamples(ctx.sampleRate, kind);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      cache.set(kind, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    start(source).connect(output);
  };

  if (sound.id === "airplane-cabin") {
    const air = gain(0.9);
    modulate(air.gain, 0.11, 0.08);
    noise("brown").connect(filter("lowpass", 450)).connect(air).connect(output);
    noise("pink").connect(filter("bandpass", 1200, 0.4)).connect(gain(0.3)).connect(output);
    oscillator(73).connect(gain(0.07)).connect(output);
    oscillator(77).connect(gain(0.04)).connect(output);
  } else if (sound.id === "exam-hall") {
    noise("pink").connect(filter("lowpass", 650)).connect(gain(0.15)).connect(output);
    scene("exam-hall");
  } else if (sound.id === "thunderstorm") {
    noise("pink").connect(filter("highpass", 450)).connect(gain(1.3)).connect(output);
    scene("thunderstorm");
  } else if (sound.id === "record-static") {
    noise("white").connect(filter("lowpass", 4200)).connect(gain(0.12)).connect(output);
    scene("record-static");
  } else if (sound.id === "copper-chimes") {
    scene("copper-chimes");
  } else if (sound.id === "waterfall") {
    const spray = gain(0.85);
    modulate(spray.gain, 0.17, 0.08);
    noise("pink").connect(filter("highpass", 180)).connect(spray).connect(output);
    noise("brown").connect(filter("lowpass", 500)).connect(gain(0.5)).connect(output);
  } else if (sound.id === "light-rain" || sound.id === "rain-on-tent") {
    const tent = sound.id === "rain-on-tent";
    noise("pink").connect(filter("bandpass", tent ? 900 : 2400, 0.5)).connect(gain(tent ? 0.65 : 0.45)).connect(output);
    // A resonant fabric patter differs from the open-air rain's higher droplets.
    const drops = gain(tent ? 0.6 : 0.22);
    modulate(drops.gain, tent ? 7.3 : 2.7, tent ? 0.25 : 0.1);
    noise("white").connect(filter("bandpass", tent ? 600 : 3100, tent ? 2 : 0.7)).connect(drops).connect(output);
  } else if (sound.id === "campfire") {
    noise("brown").connect(filter("lowpass", 850)).connect(gain(0.6)).connect(output);
    noise("pink").connect(filter("highpass", 1500)).connect(gain(0.18)).connect(output);
    clicks("fireplace");
  } else if (sound.beat) {
    const merger = own(ctx.createChannelMerger(2));
    oscillator(200).connect(merger, 0, 0);
    oscillator(200 + sound.beat).connect(merger, 0, 1);
    merger.connect(output);
    output.gain.value = 0.14;
  } else if (["white", "pink", "brown"].includes(sound.id)) {
    noise(sound.id as NoiseColor).connect(output);
  } else if (sound.id === "pulse") {
    const source = noise("pink");
    source.connect(filter("lowpass", 200)).connect(output);
    source.connect(filter("highpass", 1000)).connect(output);
    const band = source
      .connect(filter("highpass", 200))
      .connect(filter("lowpass", 1000));
    const envelope = gain(0.625);
    modulate(envelope.gain, 16, 0.375); // (1 + 0.6 sin(2π16t)) / 1.6, mid-band only.
    band.connect(envelope).connect(output);
  } else if (sound.id === "rain" || sound.id === "heavy-rain") {
    noise("pink")
      .connect(filter("highpass", sound.id === "rain" ? 700 : 350))
      .connect(gain(sound.id === "rain" ? 1.5 : 2.1))
      .connect(output);
    clicks(sound.id);
  } else if (sound.id === "wind") {
    const band = filter("bandpass", 450, 0.5);
    modulate(band.frequency, 0.09, 240);
    const swell = gain(0.6);
    modulate(swell.gain, 0.13, 0.35);
    noise("pink").connect(band).connect(swell).connect(output);
  } else if (sound.id === "ocean") {
    const swell = gain(0.55);
    modulate(swell.gain, 0.08, 0.4);
    noise("pink")
      .connect(filter("lowpass", 1800))
      .connect(swell)
      .connect(output);
  } else if (sound.id === "clock" || sound.id === "keyboard") {
    clicks(sound.id);
  } else if (sound.id === "fireplace") {
    noise("brown")
      .connect(filter("lowpass", 600))
      .connect(gain(0.7))
      .connect(output);
    clicks(sound.id);
  } else if (sound.id === "fan" || sound.id === "ac") {
    const motor = gain(0.1);
    oscillator(sound.id === "fan" ? 90 : 60)
      .connect(motor)
      .connect(output);
    const air = gain(0.8);
    modulate(air.gain, sound.id === "fan" ? 12 : 0.12, 0.1);
    noise("pink")
      .connect(filter("lowpass", sound.id === "fan" ? 1100 : 500))
      .connect(air)
      .connect(output);
  } else if (["underwater", "space", "train"].includes(sound.id)) {
    const rumble = gain(0.7);
    modulate(rumble.gain, 0.07, 0.2);
    noise("brown")
      .connect(filter("lowpass", sound.id === "train" ? 900 : 180))
      .connect(rumble)
      .connect(output);
    if (sound.id === "train") clicks("train");
    if (sound.id === "space")
      oscillator(42).connect(gain(0.08)).connect(output);
  } else {
    nodes.forEach((node) => node.disconnect());
    throw new Error(`Unknown procedural sound: ${sound.id}`);
  }
  let stopped = false;
  return {
    output,
    stop(at = ctx.currentTime) {
      if (stopped) return;
      stopped = true;
      sources.forEach((source) => source.stop(at));
      setTimeout(
        () => nodes.forEach((node) => node.disconnect()),
        Math.max(0, at - ctx.currentTime) * 1000 + 50,
      );
    },
  };
}

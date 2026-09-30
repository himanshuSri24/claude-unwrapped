// An original lo-fi loop for the video, synthesised on the spot: soft chords,
// kick/snare/hats and a pluck melody, with a small swell into every cut. No
// samples and no licence to worry about when you post it.

const SR = 44100;
const note = (m) => 440 * 2 ** ((m - 69) / 12);

function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647 * 2 - 1; };
}

// cuts: seconds where the picture changes; drumsAt: when the beat comes in
export function track(duration, cuts = [], drumsAt = 0) {
  const n = Math.ceil(SR * (duration + 2));
  const L = new Float32Array(n), R = new Float32Array(n);
  const noise = rng(7);
  const beat = 60 / 96, bar = beat * 4;

  const add = (sig, t, gain = 1, pan = 0) => {
    let i = Math.round(t * SR), k = 0;
    if (i < 0) { k = -i; i = 0; }
    const gl = gain * (1 - Math.max(0, pan)), gr = gain * (1 + Math.min(0, pan));
    for (; k < sig.length && i < n; k++, i++) { L[i] += sig[k] * gl; R[i] += sig[k] * gr; }
  };
  const gen = (secs, fn) => { const m = Math.floor(secs * SR), s = new Float32Array(m); for (let i = 0; i < m; i++) s[i] = fn(i / SR, i); return s; };
  const smooth = (s, w) => { const o = new Float32Array(s.length); let acc = 0; for (let i = 0; i < s.length; i++) { acc += s[i] - (i >= w ? s[i - w] : 0); o[i] = acc / w; } return o; };

  const pad = (freqs, len) => gen(len, (t) => {
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t + 0.3 * Math.sin(2 * Math.PI * 0.4 * t)) + 0.5 * Math.sin(2 * Math.PI * f * 2.003 * t);
    return v / freqs.length * Math.min(1, t / 0.4) * Math.min(1, (len - t) / 0.6);
  });
  const bass = (f, len) => gen(len, (t) => Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.02) * Math.exp(-t / 1.2));
  let phase = 0;
  const kick = () => { phase = 0; return gen(0.35, (t) => { phase += 2 * Math.PI * (110 * Math.exp(-t * 30) + 42) / SR; return Math.sin(phase) * Math.exp(-t * 9); }); };
  const snare = () => smooth(gen(0.25, () => noise()), 3).map((v, i) => { const t = i / SR; return (0.6 * v + 0.4 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 18); });
  const hat = () => { const raw = gen(0.06, () => noise()), lo = smooth(raw, 8); return raw.map((v, i) => (v - lo[i]) * Math.exp(-(i / SR) * 60)); };
  const pluck = (f) => gen(0.5, (t) => (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) + 0.15 * Math.sin(6 * Math.PI * f * t)) * Math.min(1, t / 0.004) * Math.exp(-t / 0.18));
  const swell = () => smooth(gen(0.9, () => noise()), 24).map((v, i) => v * Math.pow(i / SR / 0.9, 2.2) * 0.5);
  const hit = () => smooth(gen(1.2, () => noise()), 30).map((v, i) => { const t = i / SR; return (v * 3 + Math.sin(2 * Math.PI * 55 * t)) * Math.exp(-t * 3.5); });

  // Fmaj7 - Em7 - Dm7 - Cmaj7, two bars each
  const prog = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
  for (let t = 0, k = 0; t < duration; t += bar * 2, k++) {
    const ch = prog[k % 4];
    add(pad(ch.map(note), bar * 2 + 0.3), t, 0.24);
    add(bass(note(ch[0] - 12), bar * 2), t, 0.22);
  }
  const melody = [72, 76, 79, 76, 74, 72, 71, 72];
  for (let b = 0; b * beat < duration; b++) {
    const t = b * beat;
    if (t >= drumsAt) {
      if (b % 4 === 0 || b % 4 === 2) add(kick(), t, 0.55);
      if (b % 4 === 1 || b % 4 === 3) add(snare(), t, 0.22, 0.1);
      if (b % 2 === 0) add(pluck(note(melody[(b / 2) % melody.length])), t + beat / 2, 0.09, 0.25);
    }
    add(hat(), t + beat / 2, t >= drumsAt ? 0.07 : 0.03, -0.3);
  }
  for (const c of cuts) { add(swell(), c - 0.9, 0.05); add(hit(), c, 0.035); }

  // soften, a little echo, fades, gentle saturation, normalise
  const len = Math.floor(duration * SR), d = Math.round(beat * 0.75 * SR), fade = 2.5 * SR;
  let peak = 0;
  for (const ch of [L, R]) {
    for (let i = n - 1; i > 0; i--) ch[i] = 0.5 * ch[i] + 0.25 * ch[i - 1] + 0.25 * (ch[i + 1] || 0);
    for (let i = n - 1; i >= d; i--) ch[i] += ch[i - d] * 0.18;
    for (let i = 0; i < len; i++) {
      let v = ch[i];
      if (i > len - fade) v *= (len - i) / fade;
      if (i < 0.3 * SR) v *= i / (0.3 * SR);
      ch[i] = Math.tanh(v * 1.3);
      peak = Math.max(peak, Math.abs(ch[i]));
    }
  }
  const g = peak ? 0.89 / peak : 1;
  const wav = Buffer.alloc(44 + len * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + len * 4, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(len * 4, 40);
  for (let i = 0; i < len; i++) {
    wav.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4);
  }
  return wav;
}

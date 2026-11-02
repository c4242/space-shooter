// All sound effects are synthesized with the Web Audio API: no audio files needed.

let ctx = null, master = null, sfx = null, noiseBuf = null;
let eng = null, grav = null;
const MASTER_VOL = 0.55;

function noiseSource(loop = false) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = loop;
  return s;
}

function envGain(t, attack, peak, decay) {
  const g = ctx.createGain();
  peak = Math.max(peak, 0.0002);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.2, vol = 0.2, attack = 0.004, delay = 0 }) {
  if (!ctx || vol < 0.003) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
  const g = envGain(t, attack, vol, dur);
  o.connect(g); g.connect(sfx);
  o.start(t); o.stop(t + attack + dur + 0.05);
}

function hiss({ dur = 0.3, vol = 0.2, type = 'lowpass', f0 = 1000, f1 = null, q = 0.8, attack = 0.004, delay = 0 }) {
  if (!ctx || vol < 0.003) return;
  const t = ctx.currentTime + delay;
  const s = noiseSource();
  const f = ctx.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
  const g = envGain(t, attack, vol, dur);
  s.connect(f); f.connect(g); g.connect(sfx);
  s.start(t, Math.random() * 0.5);
  s.stop(t + attack + dur + 0.05);
}

export const audio = {
  muted: false,

  // Must be called from a user gesture (click / key press).
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_VOL;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Engine: detuned low saws through a lowpass, plus filtered noise for the afterburner.
    eng = {};
    eng.o1 = ctx.createOscillator(); eng.o1.type = 'sawtooth'; eng.o1.frequency.value = 46;
    eng.o2 = ctx.createOscillator(); eng.o2.type = 'sawtooth'; eng.o2.frequency.value = 46.7;
    eng.o3 = ctx.createOscillator(); eng.o3.type = 'sine'; eng.o3.frequency.value = 92;
    eng.lp = ctx.createBiquadFilter(); eng.lp.type = 'lowpass'; eng.lp.frequency.value = 220;
    eng.g = ctx.createGain(); eng.g.gain.value = 0;
    eng.o1.connect(eng.lp); eng.o2.connect(eng.lp); eng.o3.connect(eng.lp);
    eng.lp.connect(eng.g); eng.g.connect(master);
    eng.n = noiseSource(true);
    eng.bp = ctx.createBiquadFilter(); eng.bp.type = 'bandpass'; eng.bp.frequency.value = 650; eng.bp.Q.value = 0.6;
    eng.gb = ctx.createGain(); eng.gb.gain.value = 0;
    eng.n.connect(eng.bp); eng.bp.connect(eng.gb); eng.gb.connect(master);
    eng.o1.start(); eng.o2.start(); eng.o3.start(); eng.n.start();

    // Gravity rumble near the black hole.
    grav = {};
    grav.n = noiseSource(true);
    grav.lp = ctx.createBiquadFilter(); grav.lp.type = 'lowpass'; grav.lp.frequency.value = 95;
    grav.g = ctx.createGain(); grav.g.gain.value = 0;
    grav.n.connect(grav.lp); grav.lp.connect(grav.g); grav.g.connect(master);
    grav.o = ctx.createOscillator(); grav.o.type = 'sine'; grav.o.frequency.value = 31;
    grav.go = ctx.createGain(); grav.go.gain.value = 0;
    grav.o.connect(grav.go); grav.go.connect(master);
    grav.n.start(); grav.o.start();
  },

  setMuted(m) {
    this.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : MASTER_VOL, ctx.currentTime, 0.05);
  },

  engine(frac, burner, active) {
    if (!ctx) return;
    const t = ctx.currentTime;
    frac = Math.max(0, Math.min(1.2, frac));
    eng.g.gain.setTargetAtTime(active ? 0.05 + 0.1 * frac : 0, t, 0.12);
    eng.o1.frequency.setTargetAtTime(38 + 52 * frac, t, 0.25);
    eng.o2.frequency.setTargetAtTime(38.6 + 53 * frac, t, 0.25);
    eng.o3.frequency.setTargetAtTime(76 + 104 * frac, t, 0.25);
    eng.lp.frequency.setTargetAtTime(170 + 520 * frac + (burner ? 700 : 0), t, 0.2);
    eng.gb.gain.setTargetAtTime(active && burner ? 0.2 : 0, t, 0.15);
  },

  gravity(level) {
    if (!ctx) return;
    const t = ctx.currentTime;
    grav.g.gain.setTargetAtTime(level * 0.9, t, 0.3);
    grav.go.gain.setTargetAtTime(level * 0.35, t, 0.3);
    grav.lp.frequency.setTargetAtTime(70 + 120 * level, t, 0.3);
  },

  laser(vol = 1, player = true) {
    if (player) {
      tone({ type: 'square', f0: 1500, f1: 190, dur: 0.15, vol: 0.09 * vol });
      tone({ type: 'sawtooth', f0: 760, f1: 95, dur: 0.12, vol: 0.06 * vol });
      hiss({ type: 'highpass', f0: 3000, dur: 0.05, vol: 0.05 * vol });
    } else {
      tone({ type: 'sawtooth', f0: 900, f1: 120, dur: 0.18, vol: 0.08 * vol });
      hiss({ type: 'bandpass', f0: 1800, dur: 0.07, vol: 0.05 * vol });
    }
  },
  missile(vol = 1) {
    hiss({ type: 'bandpass', f0: 280, f1: 2600, dur: 0.75, vol: 0.35 * vol, attack: 0.02, q: 1.2 });
    tone({ type: 'sine', f0: 140, f1: 40, dur: 0.35, vol: 0.3 * vol });
  },
  explosion(vol = 1, big = true) {
    hiss({ type: 'lowpass', f0: big ? 2200 : 1600, f1: 70, dur: big ? 1.8 : 0.9, vol: 0.7 * vol, q: 0.5 });
    tone({ type: 'sine', f0: big ? 95 : 130, f1: 28, dur: big ? 1.1 : 0.5, vol: 0.55 * vol });
    hiss({ type: 'highpass', f0: 2500, dur: 0.18, vol: 0.18 * vol });
  },
  shieldHit() {
    tone({ type: 'sine', f0: 1900, f1: 500, dur: 0.16, vol: 0.13 });
    hiss({ type: 'bandpass', f0: 3200, dur: 0.12, vol: 0.18, q: 2 });
  },
  armorHit() {
    tone({ type: 'square', f0: 170, f1: 55, dur: 0.22, vol: 0.18 });
    hiss({ type: 'lowpass', f0: 1100, dur: 0.28, vol: 0.4 });
  },
  hitConfirm() { tone({ type: 'triangle', f0: 2300, f1: 1700, dur: 0.05, vol: 0.05 }); },
  blip() {
    tone({ type: 'sine', f0: 1250, dur: 0.05, vol: 0.09 });
    tone({ type: 'sine', f0: 1650, dur: 0.05, vol: 0.07, delay: 0.05 });
  },
  lockBeep() { tone({ type: 'square', f0: 1320, dur: 0.05, vol: 0.045 }); },
  locked() {
    tone({ type: 'square', f0: 1760, dur: 0.08, vol: 0.06 });
    tone({ type: 'square', f0: 1760, dur: 0.08, vol: 0.06, delay: 0.1 });
    tone({ type: 'square', f0: 2100, dur: 0.18, vol: 0.06, delay: 0.2 });
  },
  warning() {
    tone({ type: 'square', f0: 540, dur: 0.12, vol: 0.08 });
    tone({ type: 'square', f0: 540, dur: 0.12, vol: 0.08, delay: 0.17 });
  },
  alarm() { tone({ type: 'sawtooth', f0: 330, f1: 190, dur: 0.4, vol: 0.1 }); },
  autopilot() {
    hiss({ type: 'bandpass', f0: 180, f1: 4200, dur: 2.6, vol: 0.4, attack: 0.9, q: 1.4 });
    tone({ type: 'sawtooth', f0: 55, f1: 420, dur: 3.0, vol: 0.06, attack: 0.5 });
  },
  chime() {
    tone({ type: 'sine', f0: 660, dur: 0.35, vol: 0.12 });
    tone({ type: 'sine', f0: 880, dur: 0.35, vol: 0.12, delay: 0.18 });
    tone({ type: 'sine', f0: 1320, dur: 0.5, vol: 0.1, delay: 0.36 });
  },
  decoy() {
    hiss({ type: 'highpass', f0: 1800, dur: 0.3, vol: 0.2 });
    tone({ type: 'triangle', f0: 900, f1: 260, dur: 0.25, vol: 0.08 });
  },
  cash() {
    tone({ type: 'sine', f0: 1500, dur: 0.07, vol: 0.08 });
    tone({ type: 'sine', f0: 2000, dur: 0.12, vol: 0.08, delay: 0.07 });
  },
  denied() {
    tone({ type: 'square', f0: 220, dur: 0.12, vol: 0.08 });
    tone({ type: 'square', f0: 170, dur: 0.18, vol: 0.08, delay: 0.13 });
  },
  click() { tone({ type: 'sine', f0: 950, dur: 0.03, vol: 0.06 }); },
};

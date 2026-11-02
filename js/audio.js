// All sound effects are synthesized with the Web Audio API: no audio files needed.

let ctx = null, master = null, sfx = null, noiseBuf = null;
let eng = null, grav = null, mus = null;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
// Slow minor-key progression for the ambient score (MIDI notes).
const CHORDS = [[50, 57, 60, 65, 69], [46, 53, 57, 62, 65], [41, 48, 55, 60, 64], [43, 50, 55, 58, 62], [45, 52, 57, 60, 64], [46, 53, 58, 62, 65]];
const BASS = [38, 34, 41, 43, 45, 34];
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

// Stereo position for the sounds being scheduled (-1 left .. 1 right).
let curPan = 0;
function out(node) {
  if (Math.abs(curPan) < 0.02) { node.connect(sfx); return; }
  const p = ctx.createStereoPanner();
  p.pan.value = curPan;
  node.connect(p); p.connect(sfx);
}

function tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.2, vol = 0.2, attack = 0.004, delay = 0 }) {
  if (!ctx || vol < 0.003) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
  const g = envGain(t, attack, vol, dur);
  o.connect(g); out(g);
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
  s.connect(f); f.connect(g); out(g);
  s.start(t, Math.random() * 0.5);
  s.stop(t + attack + dur + 0.05);
}

export const audio = {
  muted: false,
  vol: { master: 1, music: 1, sfx: 1 },

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!ctx) return;
    master.gain.setTargetAtTime(this.muted ? 0 : MASTER_VOL * this.vol.master, ctx.currentTime, 0.05);
    sfx.gain.setTargetAtTime(0.9 * this.vol.sfx, ctx.currentTime, 0.05);
  },

  // Must be called from a user gesture (click / key press).
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_VOL * this.vol.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = 0.9 * this.vol.sfx; sfx.connect(master);

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

    // Music bus with a long feedback echo for a spacious sound.
    mus = { on: true, t: 0.5, i: 0, beat: 0, step: 0 };
    mus.bus = ctx.createGain(); mus.bus.gain.value = 0;
    const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.48;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const tone_ = ctx.createBiquadFilter(); tone_.type = 'lowpass'; tone_.frequency.value = 1600;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    mus.bus.connect(master);
    mus.bus.connect(delay); delay.connect(tone_); tone_.connect(fb); fb.connect(delay); tone_.connect(wet); wet.connect(master);
  },

  toggleMusic() { if (mus) mus.on = !mus.on; return mus ? mus.on : false; },

  // Called every frame. active: whether music should play; combat 0..1 adds a pulsing bass line.
  music(dt, active, combat) {
    if (!ctx || !mus) return;
    const t0 = ctx.currentTime;
    mus.bus.gain.setTargetAtTime(active && mus.on ? this.vol.music : 0, t0, 0.8);
    if (!active || !mus.on) return;
    mus.t -= dt;
    if (mus.t <= 0) {
      mus.t = 9;
      const chord = CHORDS[mus.i % CHORDS.length];
      mus.root = BASS[mus.i % BASS.length];
      mus.i++;
      for (const m of chord) {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth';
          o.frequency.value = mtof(m); o.detune.value = det;
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520 + Math.random() * 300; f.Q.value = 0.3;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(0.012, t0 + 3);
          g.gain.setValueAtTime(0.012, t0 + 7.5);
          g.gain.linearRampToValueAtTime(0.0001, t0 + 11);
          o.connect(f); f.connect(g); g.connect(mus.bus);
          o.start(t0); o.stop(t0 + 11.1);
        }
      }
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = mtof(mus.root - 12);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t0); sg.gain.linearRampToValueAtTime(0.05, t0 + 3);
      sg.gain.setValueAtTime(0.05, t0 + 7.5); sg.gain.linearRampToValueAtTime(0.0001, t0 + 11);
      sub.connect(sg); sg.connect(mus.bus); sub.start(t0); sub.stop(t0 + 11.1);
    }
    if (combat > 0 && mus.root) {
      mus.beat -= dt;
      if (mus.beat <= 0) {
        mus.beat = 0.21;
        const pat = [0, 0, 12, 0, 7, 0, 12, 10];
        const m = mus.root + pat[mus.step++ % pat.length];
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(m);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t0); f.frequency.exponentialRampToValueAtTime(200, t0 + 0.18);
        const g = envGain(t0, 0.004, 0.05 * combat, 0.18);
        o.connect(f); f.connect(g); g.connect(mus.bus);
        o.start(t0); o.stop(t0 + 0.25);
      }
    }
  },

  setMuted(m) {
    this.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : MASTER_VOL * this.vol.master, ctx.currentTime, 0.05);
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

  laser(vol = 1, player = true, pan = 0) {
    curPan = pan;
    if (player) {
      tone({ type: 'square', f0: 1500, f1: 190, dur: 0.15, vol: 0.09 * vol });
      tone({ type: 'sawtooth', f0: 760, f1: 95, dur: 0.12, vol: 0.06 * vol });
      hiss({ type: 'highpass', f0: 3000, dur: 0.05, vol: 0.05 * vol });
    } else {
      tone({ type: 'sawtooth', f0: 900, f1: 120, dur: 0.18, vol: 0.08 * vol });
      hiss({ type: 'bandpass', f0: 1800, dur: 0.07, vol: 0.05 * vol });
    }

    curPan = 0;
  },
  missile(vol = 1, pan = 0) {
    curPan = pan;
    hiss({ type: 'bandpass', f0: 280, f1: 2600, dur: 0.75, vol: 0.35 * vol, attack: 0.02, q: 1.2 });
    tone({ type: 'sine', f0: 140, f1: 40, dur: 0.35, vol: 0.3 * vol });

    curPan = 0;
  },
  explosion(vol = 1, big = true, pan = 0) {
    curPan = pan;
    hiss({ type: 'lowpass', f0: big ? 2200 : 1600, f1: 70, dur: big ? 1.8 : 0.9, vol: 0.7 * vol, q: 0.5 });
    tone({ type: 'sine', f0: big ? 95 : 130, f1: 28, dur: big ? 1.1 : 0.5, vol: 0.55 * vol });
    hiss({ type: 'highpass', f0: 2500, dur: 0.18, vol: 0.18 * vol });

    curPan = 0;
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

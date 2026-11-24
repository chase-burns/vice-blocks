// audio.js — all sound is synthesised. One-shot effects (gunshots,
// crashes, the cash-register cha-ching, UI beeps) are built from
// oscillators and filtered noise; the engine is a sawtooth whose pitch
// tracks RPM; and the two radio stations are tiny step sequencers —
// Vice FM runs a moody minor bassline, Solmar a bright major arp —
// scheduled a beat ahead of the clock while you drive.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.radioStep = 0;
    this.nextNoteAt = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    this.engineOsc.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  }

  beep(freq, dur, type = 'sine', vol = 0.15) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  noiseBurst(dur, vol, cutoff = 900) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
  }

  shot() {
    this.noiseBurst(0.14, 0.5, 2600);
    this.beep(150, 0.09, 'square', 0.2);
  }

  crash(strength = 8) {
    this.noiseBurst(0.3, Math.min(0.7, 0.2 + strength * 0.03), 500);
  }

  cash() {
    this.beep(1180, 0.09, 'square', 0.10);
    setTimeout(() => this.beep(1560, 0.14, 'square', 0.10), 55);
  }

  _note(freq, t, dur, type, vol) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  // Per-frame: engine pitch from the driven car's rpm, and the radio
  // sequencer while a station is on in a car.
  frame(state) {
    if (!this.ctx) return;
    const car = state.player.inCar;
    const driving = car && state.mode === 'play';
    const rpm = driving ? (car.rpm || 0.15) : 0;
    this.engineOsc.frequency.setTargetAtTime(38 + rpm * 105, this.ctx.currentTime, 0.06);
    this.engineGain.gain.setTargetAtTime(driving ? 0.05 + rpm * 0.05 : 0, this.ctx.currentTime, 0.09);

    if (!driving || state.radio === 0) return;
    const now = this.ctx.currentTime;
    if (this.nextNoteAt < now) this.nextNoteAt = now + 0.05;
    const stepDur = state.radio === 1 ? 0.235 : 0.19;
    while (this.nextNoteAt < now + 0.3) {
      const step = this.radioStep++;
      const t = this.nextNoteAt;
      if (state.radio === 1) {
        // Vice FM: A-minor pulse bass + sparse lead.
        const bass = [55, 0, 55, 55, 0, 65.4, 0, 49, 55, 0, 55, 55, 0, 73.4, 0, 82.4][step % 16];
        if (bass) this._note(bass, t, stepDur * 0.95, 'triangle', 0.16);
        if (step % 8 === 4) this._note(440 * Math.pow(2, [0, 3, 7, 10][(step >> 3) % 4] / 12), t, 0.3, 'sine', 0.05);
      } else {
        // Solmar: C-major arp sparkle over a soft root.
        const arp = [261.6, 329.6, 392, 523.3, 392, 329.6, 293.7, 440][step % 8];
        this._note(arp, t, stepDur * 0.9, 'sine', 0.055);
        if (step % 8 === 0) this._note(130.8, t, stepDur * 3, 'triangle', 0.10);
      }
      this.nextNoteAt += stepDur;
    }
  }
}

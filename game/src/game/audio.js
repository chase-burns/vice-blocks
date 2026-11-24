// audio.js — every sound in the game is synthesised live in WebAudio;
// there are no audio samples. Continuous voices: a twin-sawtooth engine
// pitched and filtered by RPM, throttle-modulated intake noise, a
// tyre-screech band and a two-tone siren. On top of those, a
// step-sequenced procedural radio plays one of two stations while you
// drive, and one-shot helpers cover gunshots, crashes and the till.

const ENGINE_BASE_HZ = 45;
const ENGINE_SPAN_HZ = 220;

export class AudioEngine {
  constructor() { this.ok = false; this._radioClock = 0; this._radioStepIdx = 0; }

  init() {
    if (this.ok) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      this.ac = ac;
      this._engineGain = ac.createGain(); this._engineGain.gain.value = 0;
      this._engineFilter = ac.createBiquadFilter();
      this._engineFilter.type = 'lowpass'; this._engineFilter.Q.value = 4.0; this._engineFilter.frequency.value = 300;
      this._engineOscA = ac.createOscillator(); this._engineOscA.type = 'sawtooth';
      this._engineOscB = ac.createOscillator(); this._engineOscB.type = 'sawtooth'; this._engineOscB.detune.value = 7;
      this._engineOscA.connect(this._engineFilter); this._engineOscB.connect(this._engineFilter);
      this._engineFilter.connect(this._engineGain); this._engineGain.connect(ac.destination);
      this._engineOscA.start(); this._engineOscB.start();
      this._intakeGain = ac.createGain(); this._intakeGain.gain.value = 0;
      const intakeFilter = ac.createBiquadFilter();
      intakeFilter.type = 'bandpass'; intakeFilter.frequency.value = 700; intakeFilter.Q.value = 0.8;
      const intakeSrc = this._makeNoiseSource();
      intakeSrc.connect(intakeFilter); intakeFilter.connect(this._intakeGain); this._intakeGain.connect(ac.destination);
      intakeSrc.start();
      this._tyreGain = ac.createGain(); this._tyreGain.gain.value = 0;
      const tyreFilter = ac.createBiquadFilter();
      tyreFilter.type = 'bandpass'; tyreFilter.frequency.value = 1200; tyreFilter.Q.value = 3.0;
      const tyreSrc = this._makeNoiseSource();
      tyreSrc.connect(tyreFilter); tyreFilter.connect(this._tyreGain); this._tyreGain.connect(ac.destination);
      tyreSrc.start();
      this._sirenGain = ac.createGain(); this._sirenGain.gain.value = 0;
      this._sirenOsc = ac.createOscillator(); this._sirenOsc.type = 'square'; this._sirenOsc.frequency.value = 650;
      this._sirenOsc.connect(this._sirenGain); this._sirenGain.connect(ac.destination);
      this._sirenOsc.start();
      this.ok = true;
    } catch { this.ok = false; }
  }

  _makeNoiseSource() {
    const ac = this.ac;
    const buffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const samples = buffer.getChannelData(0);
    let smoothed = 0;
    for (let i = 0; i < samples.length; i++) {
      const white = Math.random() * 2 - 1;
      smoothed = (smoothed + 0.04 * white) / 1.04;
      samples[i] = (white * 0.5 + smoothed * 2.2) * 0.6;
    }
    const src = ac.createBufferSource(); src.buffer = buffer; src.loop = true;
    return src;
  }

  // Called every frame: drive all the continuous gains from game state.
  frame(s) {
    if (!this.ok) return;
    const car = s.player.inCar;
    const isDriving = !!car && s.mode === 'play';
    this._engineGain.gain.value = isDriving ? 0.05 : 0;
    if (car) {
      const rpm = car.rpm || 0.1;
      const hz = ENGINE_BASE_HZ + rpm * ENGINE_SPAN_HZ;
      this._engineOscA.frequency.value = hz; this._engineOscB.frequency.value = hz;
      this._engineFilter.frequency.value = 200 + Math.pow(rpm, 1.4) * 2800;
      this._intakeGain.gain.value = isDriving ? (car.phys ? car.phys.throttle || 0 : 0) * 0.03 : 0;
      const slipAmount = Math.abs(car.slip || 0);
      const tyresScreaming = (slipAmount > 1.1 && Math.abs(car.speed) > 4) || (car.handbrake && Math.abs(car.speed) > 6);
      this._tyreGain.gain.value = tyresScreaming && isDriving ? Math.min(0.13, slipAmount * 0.028) : 0;
    } else { this._tyreGain.gain.value = 0; this._intakeGain.gain.value = 0; }
    const copPresent = s.cops.some((c) => c.kind === 'cop');
    this._sirenGain.gain.value = copPresent && s.mode === 'play' ? 0.02 : 0;
    if (this._sirenOsc) this._sirenOsc.frequency.value = Math.floor(s.time * 1.6) % 2 === 0 ? 650 : 920;
    this._advanceRadio(s);
  }

  _playNote(freq, dur, type, vol) {
    if (!freq) return;
    const ac = this.ac, osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + dur);
  }

  // Two stations, each a 32-step loop. Vice FM runs quicker and brighter;
  // Solmar is the slower night station.
  _advanceRadio(s) {
    const radioAudible = s.radio > 0 && s.player.inCar && s.mode === 'play';
    if (!radioAudible) { this._radioClock = 0; return; }
    this._radioClock += 1 / 60;
    const stepSeconds = s.radio === 1 ? 0.21 : 0.30;
    if (this._radioClock < stepSeconds) return;
    this._radioClock = 0;
    this._radioStepIdx = (this._radioStepIdx + 1) % 32;
    const i = this._radioStepIdx;
    const bassLines = {
      1: [55, 0, 55, 55, 0, 55, 0, 65.4, 55, 0, 55, 55, 0, 82.4, 0, 73.4],
      2: [65.4, 0, 0, 65.4, 0, 0, 49, 0, 58.3, 0, 0, 58.3, 0, 73.4, 0, 0],
    };
    const leadLines = {
      1: [220, 0, 261.6, 0, 329.6, 0, 261.6, 0, 293.7, 0, 0, 220, 0, 196, 0, 0, 220, 0, 261.6, 0, 392, 0, 329.6, 0, 293.7, 0, 261.6, 0, 0, 0, 0, 0],
      2: [174.6, 0, 0, 220, 0, 0, 261.6, 0, 0, 0, 220, 0, 196, 0, 0, 0, 174.6, 0, 0, 220, 0, 0, 293.7, 0, 261.6, 0, 0, 220, 0, 0, 0, 0],
    };
    this._playNote(bassLines[s.radio][i % 16], stepSeconds * 0.95, 'triangle', 0.16);
    this._playNote(leadLines[s.radio][i], stepSeconds * 1.4, 'square', 0.045);
  }

  beep(freq, dur, type, vol, slide) {
    if (!this.ok) return;
    const ac = this.ac, osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = type || 'square'; osc.frequency.value = freq;
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
    gain.gain.setValueAtTime(vol === undefined ? 0.12 : vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + dur);
  }

  noiseBurst(dur, vol, cutoff) {
    if (!this.ok) return;
    const ac = this.ac;
    const sampleCount = Math.floor(ac.sampleRate * dur);
    const buffer = ac.createBuffer(1, sampleCount, ac.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    const src = ac.createBufferSource(); src.buffer = buffer;
    const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const gain = ac.createGain(); gain.gain.value = vol;
    src.connect(filter); filter.connect(gain); gain.connect(ac.destination);
    src.start();
  }

  shot() { this.noiseBurst(0.15, 0.5, 1400); this.beep(120, 0.04, 'square', 0.25, -90); }
  crash(dv) { this.noiseBurst(0.3, Math.min(0.7, 0.25 + dv * 0.03), 350); }
  cash() { this.beep(880, 0.09, 'square', 0.12); setTimeout(() => this.beep(1320, 0.12, 'square', 0.12), 70); }
}

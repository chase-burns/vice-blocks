// audio.js — all sound is synthesised in WebAudio; there are no samples.
// Continuous voices: a twin-saw engine whose pitch and filter follow RPM,
// throttle-modulated intake noise, a tyre-screech band, and a two-tone
// siren. On top of that, a step-sequenced procedural radio plays one of
// two stations while driving, and short one-shot helpers cover gunshots,
// crashes and the cash register.

const ENGINE_BASE_HZ = 45;
const ENGINE_SPAN_HZ = 220;

export class AudioEngine {
  constructor() {
    this.ok = false;
    this._radioTimer = 0;
    this._radioStep = 0;
  }

  init() {
    if (this.ok) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      this.ac = ac;

      // Engine voice: two slightly detuned saws into a lowpass whose
      // cutoff opens with RPM^1.4.
      this._engGain = ac.createGain();
      this._engGain.gain.value = 0;
      this._engFilter = ac.createBiquadFilter();
      this._engFilter.type = 'lowpass';
      this._engFilter.Q.value = 4.0;
      this._engFilter.frequency.value = 300;
      this._oscA = ac.createOscillator();
      this._oscA.type = 'sawtooth';
      this._oscB = ac.createOscillator();
      this._oscB.type = 'sawtooth';
      this._oscB.detune.value = 7;
      this._oscA.connect(this._engFilter);
      this._oscB.connect(this._engFilter);
      this._engFilter.connect(this._engGain);
      this._engGain.connect(ac.destination);
      this._oscA.start();
      this._oscB.start();

      // Intake rush: looping noise through a bandpass, gain follows throttle.
      this._rushGain = ac.createGain();
      this._rushGain.gain.value = 0;
      const rushFilter = ac.createBiquadFilter();
      rushFilter.type = 'bandpass';
      rushFilter.frequency.value = 700;
      rushFilter.Q.value = 0.8;
      const rushSrc = this._makeNoiseSource();
      rushSrc.connect(rushFilter);
      rushFilter.connect(this._rushGain);
      this._rushGain.connect(ac.destination);
      rushSrc.start();

      // Screech: looping noise through a narrow 1200 Hz band.
      this._screechGain = ac.createGain();
      this._screechGain.gain.value = 0;
      const screechFilter = ac.createBiquadFilter();
      screechFilter.type = 'bandpass';
      screechFilter.frequency.value = 1200;
      screechFilter.Q.value = 3.0;
      const screechSrc = this._makeNoiseSource();
      screechSrc.connect(screechFilter);
      screechFilter.connect(this._screechGain);
      this._screechGain.connect(ac.destination);
      screechSrc.start();

      // Siren: a square wave alternating 650 / 920 Hz.
      this._sirenGain = ac.createGain();
      this._sirenGain.gain.value = 0;
      this._sirenOsc = ac.createOscillator();
      this._sirenOsc.type = 'square';
      this._sirenOsc.frequency.value = 650;
      this._sirenOsc.connect(this._sirenGain);
      this._sirenGain.connect(ac.destination);
      this._sirenOsc.start();

      this.ok = true;
    } catch {
      this.ok = false;
    }
  }

  _makeNoiseSource() {
    const ac = this.ac;
    const buffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04; // pinkish tilt
      data[i] = (white * 0.5 + last * 2.2) * 0.6;
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  // Called once per frame with the game state; sets every continuous gain.
  frame(s) {
    if (!this.ok) return;
    const car = s.player.inCar;
    const driving = !!car && s.mode === 'play';
    this._engGain.gain.value = driving ? 0.05 : 0;
    if (car) {
      const rpm = car.rpm || 0.1;
      const hz = ENGINE_BASE_HZ + rpm * ENGINE_SPAN_HZ;
      this._oscA.frequency.value = hz;
      this._oscB.frequency.value = hz;
      this._engFilter.frequency.value = 200 + Math.pow(rpm, 1.4) * 2800;
      this._rushGain.gain.value = driving ? (car.phys?.throttle || 0) * 0.03 : 0;
      const slip = Math.abs(car.slip || 0);
      const screeching = (slip > 1.1 && Math.abs(car.speed) > 4)
        || (car.handbrake && Math.abs(car.speed) > 6);
      this._screechGain.gain.value = screeching && driving
        ? Math.min(0.13, slip * 0.028) : 0;
    } else {
      this._screechGain.gain.value = 0;
      this._rushGain.gain.value = 0;
    }
    const anyCop = s.cops.some((c) => c.kind === 'cop');
    this._sirenGain.gain.value = anyCop && s.mode === 'play' ? 0.02 : 0;
    if (this._sirenOsc) {
      this._sirenOsc.frequency.value = Math.floor(s.time * 1.6) % 2 === 0 ? 650 : 920;
    }
    this._stepRadio(s);
  }

  _playNote(freq, dur, type, vol) {
    if (!freq) return;
    const ac = this.ac;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }

  // Two stations, each a 32-step loop of bass + lead lines. Vice FM runs
  // quicker and brighter; Solmar is the slower night station.
  _stepRadio(s) {
    const on = s.radio > 0 && s.player.inCar && s.mode === 'play';
    if (!on) { this._radioTimer = 0; return; }
    this._radioTimer += 1 / 60;
    const stepDur = s.radio === 1 ? 0.21 : 0.30;
    if (this._radioTimer < stepDur) return;
    this._radioTimer = 0;
    this._radioStep = (this._radioStep + 1) % 32;
    const i = this._radioStep;
    const bassLines = {
      1: [55, 0, 55, 55, 0, 55, 0, 65.4, 55, 0, 55, 55, 0, 82.4, 0, 73.4],
      2: [65.4, 0, 0, 65.4, 0, 0, 49, 0, 58.3, 0, 0, 58.3, 0, 73.4, 0, 0],
    };
    const leadLines = {
      1: [220, 0, 261.6, 0, 329.6, 0, 261.6, 0, 293.7, 0, 0, 220, 0, 196, 0, 0, 220, 0, 261.6, 0, 392, 0, 329.6, 0, 293.7, 0, 261.6, 0, 0, 0, 0, 0],
      2: [174.6, 0, 0, 220, 0, 0, 261.6, 0, 0, 0, 220, 0, 196, 0, 0, 0, 174.6, 0, 0, 220, 0, 0, 293.7, 0, 261.6, 0, 0, 220, 0, 0, 0, 0],
    };
    this._playNote(bassLines[s.radio][i % 16], stepDur * 0.95, 'triangle', 0.16);
    this._playNote(leadLines[s.radio][i], stepDur * 1.4, 'square', 0.045);
  }

  beep(freq, dur, type = 'square', vol = 0.12, slide = 0) {
    if (!this.ok) return;
    const ac = this.ac;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (slide) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(30, freq + slide), ac.currentTime + dur);
    }
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }

  noiseBurst(dur, vol, cutoff) {
    if (!this.ok) return;
    const ac = this.ac;
    const len = Math.floor(ac.sampleRate * dur);
    const buffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ac.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    src.start();
  }

  shot() {
    this.noiseBurst(0.15, 0.5, 1400);
    this.beep(120, 0.04, 'square', 0.25, -90);
  }

  crash(dv) {
    this.noiseBurst(0.3, Math.min(0.7, 0.25 + dv * 0.03), 350);
  }

  cash() {
    this.beep(880, 0.09, 'square', 0.12);
    setTimeout(() => this.beep(1320, 0.12, 'square', 0.12), 70);
  }
}

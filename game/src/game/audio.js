// Synthesised WebAudio engine (WO Task 7). No samples: everything is
// oscillators + filtered noise, following the spec's RPM formulas.
export class AudioEngine {
  constructor() { this.ok = false; }
  init() {
    if (this.ok) return;
    try {
      const AC = new (window.AudioContext || window.webkitAudioContext)();
      this.ac = AC;
      // Engine: two detuned saws -> lowpass (cutoff tracks RPM^1.4).
      this.engGain = AC.createGain(); this.engGain.gain.value = 0;
      this.engFilter = AC.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 4.0; this.engFilter.frequency.value = 300;
      this.osc1 = AC.createOscillator(); this.osc1.type = 'sawtooth';
      this.osc2 = AC.createOscillator(); this.osc2.type = 'sawtooth'; this.osc2.detune.value = 7;
      this.osc1.connect(this.engFilter); this.osc2.connect(this.engFilter);
      this.engFilter.connect(this.engGain); this.engGain.connect(AC.destination);
      this.osc1.start(); this.osc2.start();
      // Intake/exhaust rush: throttle-modulated noise.
      this.rushGain = AC.createGain(); this.rushGain.gain.value = 0;
      const rushSrc = this._noiseSource();
      const rushFilter = AC.createBiquadFilter(); rushFilter.type = 'bandpass'; rushFilter.frequency.value = 700; rushFilter.Q.value = 0.8;
      rushSrc.connect(rushFilter); rushFilter.connect(this.rushGain); this.rushGain.connect(AC.destination); rushSrc.start();
      // Tyre screech: looped noise -> bandpass 1200 Hz Q 3.
      this.screechGain = AC.createGain(); this.screechGain.gain.value = 0;
      const scr = this._noiseSource();
      const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 3.0;
      scr.connect(bp); bp.connect(this.screechGain); this.screechGain.connect(AC.destination); scr.start();
      // Siren: two-tone square 650/920 Hz.
      this.sirenGain = AC.createGain(); this.sirenGain.gain.value = 0;
      this.sirenOsc = AC.createOscillator(); this.sirenOsc.type = 'square'; this.sirenOsc.frequency.value = 650;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(AC.destination); this.sirenOsc.start();
      this.ok = true;
    } catch { this.ok = false; }
  }
  _noiseSource() {
    const AC = this.ac;
    const len = AC.sampleRate;
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = (w * 0.5 + last * 2.2) * 0.6; } // pinkish
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    return src;
  }
  frame(s) {
    if (!this.ok) return;
    const AC = this.ac, car = s.player.inCar;
    const driving = car && s.mode === 'play';
    this.engGain.gain.value = driving ? 0.05 : 0;
    if (car) {
      const rpm = car.rpm || 0.1;
      const f = 45 + rpm * 220;
      this.osc1.frequency.value = f; this.osc2.frequency.value = f;
      this.engFilter.frequency.value = 200 + Math.pow(rpm, 1.4) * 2800;
      this.rushGain.gain.value = driving ? (car.phys?.throttle || 0) * 0.03 : 0;
      const slip = Math.abs(car.slip || 0);
      const screech = (slip > 1.1 && Math.abs(car.speed) > 4) || (car.handbrake && Math.abs(car.speed) > 6);
      this.screechGain.gain.value = screech && driving ? Math.min(0.13, slip * 0.028) : 0;
    } else { this.screechGain.gain.value = 0; this.rushGain.gain.value = 0; }
    const copsNear = s.cops.some(c => c.kind === 'cop');
    this.sirenGain.gain.value = copsNear && s.mode === 'play' ? 0.02 : 0;
    if (this.sirenOsc) this.sirenOsc.frequency.value = (Math.floor(s.time * 1.6) % 2 === 0) ? 650 : 920;
  }
  beep(freq, dur, type = 'square', vol = 0.12, slide = 0) {
    if (!this.ok) return;
    const AC = this.ac;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), AC.currentTime + dur);
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
  }
  noiseBurst(dur, vol, freq) {
    if (!this.ok) return;
    const AC = this.ac;
    const len = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = AC.createBufferSource(); src.buffer = buf;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = AC.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(AC.destination); src.start();
  }
  shot() { this.noiseBurst(0.02 + 0.13, 0.5, 1400); this.beep(120, 0.04, 'square', 0.25, -90); }
  crash(dv) { this.noiseBurst(0.3, Math.min(0.7, 0.25 + dv * 0.03), 350); }
  cash() { this.beep(880, 0.09, 'square', 0.12); setTimeout(() => this.beep(1320, 0.12, 'square', 0.12), 70); }
}

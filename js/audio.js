const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export class AudioEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.musicBus = null
    this.sfxBus = null
    this.delay = null
    this.noise = null
    this.timer = null
    this.playing = false
    this.paused = false
    this.level = null
    this.mode = 'menu'
    this.step = 0
    this.nextStepTime = 0
    this.stepDuration = 60 / 112 / 4
    this.settings = { master: 0.72, music: 0.65, muted: false }
    this.started = false
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
      return this.ctx
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    this.ctx = ctx

    this.master = ctx.createGain()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.knee.value = 22
    comp.ratio.value = 5
    comp.attack.value = 0.004
    comp.release.value = 0.22
    this.master.connect(comp)
    comp.connect(ctx.destination)

    this.musicBus = ctx.createGain()
    this.sfxBus = ctx.createGain()
    this.musicBus.connect(this.master)
    this.sfxBus.connect(this.master)

    const delay = ctx.createDelay(1)
    delay.delayTime.value = 0.235
    const fb = ctx.createGain()
    fb.gain.value = 0.24
    const wet = ctx.createGain()
    wet.gain.value = 0.21
    delay.connect(fb)
    fb.connect(delay)
    delay.connect(wet)
    wet.connect(this.master)
    this.delay = delay

    const length = ctx.sampleRate * 1.2
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    this.noise = buffer

    this.applyVolumes()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    this.started = true
    return ctx
  }

  applyVolumes() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const master = this.settings.muted ? 0.0001 : Math.max(0.0001, this.settings.master)
    this.master.gain.setTargetAtTime(master, now, 0.05)
    this.musicBus.gain.setTargetAtTime(this.paused ? 0.0001 : Math.max(0.0001, this.settings.music * 0.5), now, 0.08)
    this.sfxBus.gain.setTargetAtTime(Math.max(0.0001, this.settings.master * 0.72), now, 0.05)
  }

  setSettings({ master, music, muted }) {
    if (typeof master === 'number') this.settings.master = clamp(master, 0, 1)
    if (typeof music === 'number') this.settings.music = clamp(music, 0, 1)
    if (typeof muted === 'boolean') this.settings.muted = muted
    this.applyVolumes()
  }

  startMenuMusic() {
    if (!this.ctx) return
    this.startMusic(null, 'menu')
  }

  startMusic(level, mode = 'level') {
    if (!this.ctx) return
    this.stopMusic(false)
    this.level = level
    this.mode = mode
    this.playing = true
    this.paused = false
    this.step = 0
    this.stepDuration = 60 / (mode === 'menu' ? 108 : (level?.bpm || 120)) / 4
    this.nextStepTime = this.ctx.currentTime + 0.08
    this.applyVolumes()
    this.timer = setInterval(() => this.schedule(), 24)
    this.schedule()
  }

  startLevelMusic(level) {
    this.startMusic(level, 'level')
  }

  stopMusic(fade = true) {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.playing = false
    if (fade && this.ctx) {
      const now = this.ctx.currentTime
      this.musicBus.gain.cancelScheduledValues(now)
      this.musicBus.gain.setTargetAtTime(0.0001, now, 0.06)
      setTimeout(() => { if (!this.playing) this.applyVolumes() }, 280)
    }
  }

  pause() {
    if (!this.ctx || this.paused) return
    this.paused = true
    this.applyVolumes()
  }

  resume() {
    if (!this.ctx || !this.paused) return
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
    this.paused = false
    this.applyVolumes()
  }

  schedule() {
    if (!this.ctx || !this.playing || this.paused) return
    const horizon = this.ctx.currentTime + 0.14
    let safety = 0
    while (this.nextStepTime < horizon && safety++ < 32) {
      this.playStep(this.step, this.nextStepTime)
      this.nextStepTime += this.stepDuration
      this.step = (this.step + 1) % 64
    }
  }

  playStep(step, time) {
    const menu = this.mode === 'menu'
    const bar = Math.floor(step / 16)
    const levelIndex = this.level?.index || 0
    const roots = menu ? [45, 41, 48, 43] : [
      [45, 41, 48, 43],
      [43, 38, 46, 41],
      [40, 36, 43, 38]
    ][levelIndex]
    const root = roots[bar % roots.length]
    const scale = menu ? [0, 3, 5, 7, 10] : [
      [0, 3, 5, 7, 10, 12],
      [0, 2, 3, 7, 8, 10, 12],
      [0, 1, 5, 6, 8, 10, 12]
    ][levelIndex]
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12)

    if (!menu && step % 4 === 0) this.kick(time, step % 16 === 0 ? 0.5 : 0.34)
    if (!menu && step % 8 === 4) this.snare(time, 0.22)
    if (step % 2 === 0) this.hat(time, step % 4 === 0 ? 0.09 : 0.045, step % 8 === 2)
    if (menu && step % 8 === 0) this.kick(time, 0.12)

    const bassSteps = menu ? [0, 3, 6, 8, 11, 14] : [0, 2, 4, 6, 8, 10, 12, 14]
    if (bassSteps.includes(step % 16)) {
      const degree = [0, 0, 7, 0, 3, 0, 10, 0][bassSteps.indexOf(step % 16)]
      this.bass(time, midi(root - 12 + degree), this.stepDuration * 1.65, menu ? 0.06 : 0.11)
    }

    const arpPattern = menu ? [0, 2, 4, 2] : [0, 2, 4, 2, 5, 4, 2, 3]
    const arpDegree = arpPattern[step % arpPattern.length]
    if (step % (menu ? 2 : 1) === 0) {
      const octave = step % 16 >= 8 ? 12 : 0
      const freq = midi(root + 12 + scale[arpDegree % scale.length] + octave)
      this.lead(time, freq, this.stepDuration * (menu ? 1.5 : 0.82), menu ? 0.022 : 0.035, menu ? 'sine' : 'triangle')
    }

    if (step % 16 === 0) {
      const chord = [0, scale[2], scale[4], 12]
      chord.forEach((deg, i) => {
        this.pad(time, midi(root + deg), this.stepDuration * (menu ? 18 : 15.5), menu ? 0.018 : 0.025, i)
      })
    }

    if (!menu && (step === 30 || step === 62) && levelIndex > 0) {
      this.lead(time, midi(root + 24 + scale[2]), this.stepDuration * 2, 0.028, 'square')
    }
  }

  env(gain, time, attack, decay, peak) {
    gain.gain.cancelScheduledValues(time)
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay)
  }

  tone({ freq, freqEnd, time, duration, type = 'sine', peak = 0.1, attack = 0.005, dest = null, filter = 0 }) {
    if (!this.ctx) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(Math.max(20, freq), time)
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), time + duration)
    let node = gain
    if (filter) {
      const biquad = this.ctx.createBiquadFilter()
      biquad.type = 'lowpass'
      biquad.frequency.setValueAtTime(filter, time)
      biquad.Q.value = 0.8
      gain.connect(biquad)
      node = biquad
    }
    osc.connect(gain)
    node.connect(dest || this.sfxBus)
    this.env(gain, time, attack, duration, peak)
    osc.start(time)
    osc.stop(time + duration + attack + 0.05)
  }

  kick(time, peak) {
    this.tone({ freq: 155, freqEnd: 44, time, duration: 0.22, peak, attack: 0.002, dest: this.musicBus })
  }

  snare(time, peak) {
    if (!this.noise) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1850
    filter.Q.value = 0.9
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(peak, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.musicBus)
    src.start(time, Math.random() * 0.2)
    src.stop(time + 0.18)
  }

  hat(time, peak, open) {
    if (!this.noise) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 7200
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(peak, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (open ? 0.1 : 0.036))
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.musicBus)
    src.start(time, Math.random() * 0.4)
    src.stop(time + 0.12)
  }

  bass(time, freq, duration, peak) {
    this.tone({ freq, time, duration, type: 'sawtooth', peak, attack: 0.008, filter: 260, dest: this.musicBus })
  }

  lead(time, freq, duration, peak, type) {
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    const filter = this.ctx.createBiquadFilter()
    osc.type = type
    osc.frequency.setValueAtTime(freq, time)
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(3400, time)
    filter.frequency.exponentialRampToValueAtTime(900, time + duration)
    filter.Q.value = 2
    this.env(gain, time, 0.006, duration, peak)
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(this.musicBus)
    gain.connect(this.delay)
    osc.start(time)
    osc.stop(time + duration + 0.08)
  }

  pad(time, freq, duration, peak, index) {
    const osc = this.ctx.createOscillator()
    const osc2 = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    const filter = this.ctx.createBiquadFilter()
    osc.type = 'sawtooth'
    osc2.type = 'sawtooth'
    osc.frequency.value = freq
    osc2.frequency.value = freq * 1.005
    osc.detune.value = -5
    osc2.detune.value = 6
    filter.type = 'lowpass'
    filter.frequency.value = 780 + index * 160
    filter.Q.value = 0.7
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(peak, time + 0.35)
    gain.gain.setValueAtTime(peak, time + duration * 0.6)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)
    osc.connect(filter)
    osc2.connect(filter)
    filter.connect(gain)
    gain.connect(this.musicBus)
    osc.start(time)
    osc2.start(time)
    osc.stop(time + duration + 0.1)
    osc2.stop(time + duration + 0.1)
  }

  sfx(name) {
    if (!this.ctx || this.settings.muted) return
    const t = this.ctx.currentTime + 0.005
    if (name === 'jump') {
      this.tone({ freq: 520, freqEnd: 820, time: t, duration: 0.08, type: 'sine', peak: 0.055 })
    } else if (name === 'orb') {
      this.tone({ freq: 680, freqEnd: 1180, time: t, duration: 0.14, type: 'triangle', peak: 0.08 })
      this.tone({ freq: 1020, time: t + 0.04, duration: 0.1, type: 'sine', peak: 0.04 })
    } else if (name === 'pad') {
      this.tone({ freq: 180, freqEnd: 760, time: t, duration: 0.2, type: 'square', peak: 0.055, filter: 1400 })
    } else if (name === 'portal') {
      this.tone({ freq: 160, freqEnd: 920, time: t, duration: 0.38, type: 'sawtooth', peak: 0.05, filter: 1800 })
      this.tone({ freq: 920, freqEnd: 320, time: t + 0.13, duration: 0.3, type: 'triangle', peak: 0.035 })
    } else if (name === 'gem') {
      [0, 0.075, 0.15].forEach((d, i) => this.tone({ freq: 880 * Math.pow(1.26, i), time: t + d, duration: 0.25, type: 'sine', peak: 0.055 }))
    } else if (name === 'death') {
      this.tone({ freq: 220, freqEnd: 34, time: t, duration: 0.55, type: 'sawtooth', peak: 0.12, filter: 900 })
      if (this.noise) {
        const src = this.ctx.createBufferSource()
        src.buffer = this.noise
        const filter = this.ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.setValueAtTime(6000, t)
        filter.frequency.exponentialRampToValueAtTime(180, t + 0.45)
        const gain = this.ctx.createGain()
        gain.gain.setValueAtTime(0.18, t)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
        src.connect(filter)
        filter.connect(gain)
        gain.connect(this.sfxBus)
        src.start(t)
        src.stop(t + 0.55)
      }
    } else if (name === 'complete') {
      [0, 4, 7, 12, 16].forEach((semi, i) => {
        this.tone({ freq: 440 * Math.pow(2, semi / 12), time: t + i * 0.09, duration: 0.6, type: 'triangle', peak: 0.06 })
      })
    } else if (name === 'ui') {
      this.tone({ freq: 950, freqEnd: 1280, time: t, duration: 0.045, type: 'square', peak: 0.018, filter: 4000 })
    } else if (name === 'checkpoint') {
      this.tone({ freq: 1100, time: t, duration: 0.06, type: 'sine', peak: 0.04 })
    }
  }
}

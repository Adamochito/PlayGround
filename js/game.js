import { levels, GROUND, BEAT, PLAYER_SIZE, levelLength, totalShards } from './levels.js'
import { AudioEngine } from './audio.js'

const VIEW_H = 720
const CUBE_GRAVITY = 2850
const JUMP_FORCE = -885
const SHIP_GRAVITY = 1550
const SHIP_THRUST = -3350
const SHIP_MAX = 610
const SAVE_KEY = 'neon-dash-save-v1'
const PLAYER_COLORS = ['#4deaff', '#ffb347', '#b6ff4d']

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (a, b, t) => a + (b - a) * t
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const pad2 = (n) => String(n).padStart(2, '0')

function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  }
}
const rgba = (hex, alpha = 1) => {
  const c = hexToRgb(hex)
  return `rgba(${c.r},${c.g},${c.b},${alpha})`
}

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function cutRect(ctx, x, y, w, h, cut = 8) {
  ctx.beginPath()
  ctx.moveTo(x + cut, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + h - cut)
  ctx.lineTo(x + w - cut, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + cut)
  ctx.closePath()
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${pad2(s)}`
}

function loadSave() {
  const fallback = {
    version: 1,
    totalAttempts: 0,
    levels: {},
    settings: { master: 72, music: 65, shake: true, reducedMotion: false, hitboxes: false, muted: false }
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return fallback
    return {
      ...fallback,
      ...parsed,
      levels: { ...fallback.levels, ...(parsed.levels || {}) },
      settings: { ...fallback.settings, ...(parsed.settings || {}) }
    }
  } catch {
    return fallback
  }
}

function saveData(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    /* storage may be unavailable */
  }
}

class NeonDash {
  constructor() {
    this.canvas = document.getElementById('scene')
    this.ctx = this.canvas.getContext('2d', { alpha: false })
    this.previewCanvas = document.getElementById('previewCanvas')
    this.previewCtx = this.previewCanvas?.getContext('2d') || null
    this.save = loadSave()
    this.audio = new AudioEngine()
    this.audio.setSettings({
      master: this.save.settings.master / 100,
      music: this.save.settings.music / 100,
      muted: this.save.settings.muted
    })

    this.state = 'menu'
    this.view = 'menu'
    this.currentLevelIndex = 0
    this.level = levels[0]
    this.finishX = levelLength(this.level)
    this.time = 0
    this.ambientCam = 0
    this.lastFrame = performance.now()
    this.deathTimer = 0
    this.completeTimer = 0
    this.deathShown = false
    this.completeShown = false
    this.hintTimer = 0
    this.flash = { color: '#ffffff', alpha: 0 }
    this.shake = 0
    this.shakeX = 0
    this.shakeY = 0
    this.settings = this.save.settings
    this.reducedMotion = this.settings.reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    this.cardCanvases = []
    this.lastHud = {}
    this.pausedFromHidden = false

    this.player = { x: 0, y: GROUND - PLAYER_SIZE, vy: 0, w: PLAYER_SIZE, h: PLAYER_SIZE, onGround: true, mode: 'cube', rotation: 0, squash: 1 }
    this.trail = []
    this.trailTimer = 0
    this.particles = []
    this.runShards = new Set()
    this.usedGems = new Set()
    this.usedOrbs = new Set()
    this.usedPads = new Set()
    this.usedPortals = new Set()
    this.attempts = 0
    this.levelTime = 0
    this.progress = 0
    this.camX = -300
    this.anchorX = 330
    this.lastPercent = -1
    this.jumpBuffer = 0
    this.held = false
    this.modeCalloutTimer = 0
    this.previewState = null
    this.buildingsFar = this.makeBuildings(mulberry32(913), 26, 2380, 45, 220)
    this.buildingsNear = this.makeBuildings(mulberry32(4401), 18, 2380, 80, 310)
    this.stars = this.makeStars()
    this.bind()
    this.resize()
    this.setTheme(this.level)
    this.renderLevelCards()
    this.refreshMenu()
    this.applySettingsUI()
    this.showScreen('menu')
    document.fonts?.ready.then(() => {
      this.resize()
      this.refreshTheme()
    })
    requestAnimationFrame((t) => this.loop(t))
  }

  /* ─────────────────────────── setup + persistence ─────────────────────────── */

  makeBuildings(rand, count, span, minH, maxH) {
    const result = []
    let x = 0
    for (let i = 0; i < count; i++) {
      const w = 55 + rand() * 120
      const h = minH + rand() * (maxH - minH)
      const windows = []
      const cols = Math.max(1, Math.floor(w / 28))
      const rows = Math.max(1, Math.floor(h / 34))
      for (let cx = 0; cx < cols; cx++) {
        for (let ry = 0; ry < rows; ry++) {
          if (rand() > 0.62) windows.push({ x: 8 + cx * 25 + rand() * 3, y: 12 + ry * 29, w: 5 + rand() * 5, h: 2 + rand() * 3, p: rand() })
        }
      }
      result.push({ x, w, h, windows, antenna: rand() > 0.65, blink: rand() })
      x += w + 12 + rand() * 28
    }
    return { buildings: result, span: Math.max(span, x) }
  }

  makeStars() {
    const rand = mulberry32(7321)
    return Array.from({ length: 165 }, () => ({
      x: rand(),
      y: rand() * 0.67,
      size: 0.5 + rand() * 1.6,
      depth: 0.14 + rand() * 0.52,
      phase: rand() * Math.PI * 2,
      bright: rand() > 0.83
    }))
  }

  levelRecord(level = this.level) {
    if (!this.save.levels[level.id]) {
      this.save.levels[level.id] = { best: 0, attempts: 0, completed: false, shards: [], bestTime: null }
    }
    return this.save.levels[level.id]
  }

  persist() {
    this.save.settings = this.settings
    saveData(this.save)
  }

  totalShardsCollected() {
    return levels.reduce((sum, level) => sum + (this.save.levels[level.id]?.shards?.length || 0), 0)
  }

  bestPercent(level = this.level) {
    return Math.floor(this.save.levels[level.id]?.best || 0)
  }

  bind() {
    const $ = (id) => document.getElementById(id)
    this.el = {
      menu: document.querySelector('[data-screen="menu"]'),
      levels: document.querySelector('[data-screen="levels"]'),
      how: document.querySelector('[data-screen="how"]'),
      hud: $('hud'),
      progressFill: $('progressFill'),
      progressGlint: $('progressGlint'),
      hudPercent: $('hudPercent'),
      hudAttempt: $('hudAttempt'),
      hudShards: $('hudShards'),
      hudMode: $('hudMode'),
      hudLevelNo: $('hudLevelNo'),
      hudLevelName: $('hudLevelName'),
      pauseModal: $('pauseModal'),
      deathModal: $('deathModal'),
      completeModal: $('completeModal'),
      settingsModal: $('settingsModal'),
      pauseProgress: $('pauseProgress'),
      pauseAttempt: $('pauseAttempt'),
      pauseShards: $('pauseShards'),
      deathPercent: $('deathPercent'),
      deathAttempt: $('deathAttempt'),
      deathBest: $('deathBest'),
      deathShards: $('deathShards'),
      completeLevel: $('completeLevel'),
      completeTime: $('completeTime'),
      completeAttempts: $('completeAttempts'),
      completeShards: $('completeShards'),
      completeStars: $('completeStars'),
      nextLevelBtn: $('nextLevelBtn'),
      featureBest: $('featureBest'),
      menuBest: $('menuBest'),
      menuAttempts: $('menuAttempts'),
      menuShards: $('menuShards'),
      toast: $('toast'),
      modeCallout: $('modeCallout'),
      startHint: $('startHint'),
      levelGrid: $('levelGrid'),
      muteBtn: $('muteBtn'),
      volumeSlider: $('volumeSlider'),
      musicSlider: $('musicSlider'),
      volumeOut: $('volumeOut'),
      musicOut: $('musicOut'),
      shakeToggle: $('shakeToggle'),
      motionToggle: $('motionToggle'),
      hitboxToggle: $('hitboxToggle')
    }

    const click = (id, fn) => $(id)?.addEventListener('click', (event) => {
      event.stopPropagation()
      this.audio.init()
      this.audio.sfx('ui')
      fn(event)
    })

    click('playBtn', () => this.startRun(this.currentLevelIndex))
    click('featurePlay', () => this.startRun(0))
    click('levelsBtn', () => this.openLevels())
    click('levelsHowBtn', () => this.showScreen('how'))
    click('brandHome', () => this.goHome())
    document.querySelectorAll('[data-back]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.init()
        this.audio.sfx('ui')
        const target = btn.dataset.back
        if (target === 'menu') this.showScreen('menu')
      })
    })
    click('settingsBtn', () => this.openSettings())
    click('settingsClose', () => this.closeSettings())
    click('pauseSettings', () => this.openSettings())
    click('pauseBtn', () => this.pause())
    click('resumeBtn', () => this.resume())
    click('pauseRestart', () => this.restartRun())
    click('pauseLevels', () => this.exitToLevels())
    click('retryBtn', () => this.restartRun())
    click('deathLevels', () => this.exitToLevels())
    click('completeRetry', () => this.restartRun())
    click('completeLevels', () => this.exitToLevels())
    click('nextLevelBtn', () => this.nextLevel())
    click('muteBtn', () => this.toggleMute())
    click('resetBtn', () => this.resetProgress())

    this.el.levelGrid?.addEventListener('click', (event) => {
      const card = event.target.closest('.level-card')
      if (!card) return
      this.audio.init()
      this.audio.sfx('ui')
      this.startRun(Number(card.dataset.index))
    })

    this.el.volumeSlider?.addEventListener('input', (event) => {
      this.save.settings.master = Number(event.target.value)
      this.el.volumeOut.textContent = event.target.value
      this.audio.setSettings({ master: Number(event.target.value) / 100 })
      this.persist()
    })
    this.el.musicSlider?.addEventListener('input', (event) => {
      this.save.settings.music = Number(event.target.value)
      this.el.musicOut.textContent = event.target.value
      this.audio.setSettings({ music: Number(event.target.value) / 100 })
      this.persist()
    })
    this.el.shakeToggle?.addEventListener('change', (event) => {
      this.settings.shake = event.target.checked
      this.persist()
    })
    this.el.motionToggle?.addEventListener('change', (event) => {
      this.settings.reducedMotion = event.target.checked
      this.reducedMotion = this.settings.reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      document.body.classList.toggle('reduced-motion', this.reducedMotion)
      this.persist()
    })
    this.el.hitboxToggle?.addEventListener('change', (event) => {
      this.settings.hitboxes = event.target.checked
      this.persist()
    })

    window.addEventListener('keydown', (event) => this.onKeyDown(event))
    window.addEventListener('keyup', (event) => this.onKeyUp(event))
    window.addEventListener('pointerdown', (event) => this.onPointerDown(event))
    window.addEventListener('pointerup', () => { this.held = false })
    window.addEventListener('pointercancel', () => { this.held = false })
    window.addEventListener('blur', () => {
      this.held = false
      if (this.state === 'playing') this.pause()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause()
    })
    window.addEventListener('resize', () => this.resize())
    this.el.pauseModal?.addEventListener('click', (event) => {
      if (event.target === this.el.pauseModal) this.resume()
    })
  }

  onKeyDown(event) {
    const code = event.code
    if (['Space', 'ArrowUp', 'KeyW', 'ArrowDown'].includes(code)) event.preventDefault()
    if (event.repeat && ['Space', 'ArrowUp', 'KeyW'].includes(code)) return

    if (code === 'Escape') {
      if (this.el.settingsModal.classList.contains('is-open')) { this.closeSettings(); return }
      if (this.state === 'playing') this.pause()
      else if (this.state === 'paused') this.resume()
      else if (this.view === 'levels' || this.view === 'how') this.showScreen('menu')
      return
    }
    if (code === 'KeyM') { this.toggleMute(); return }
    if (code === 'KeyF') { this.toggleFullscreen(); return }
    if (code === 'KeyR' && ['playing', 'paused', 'dead', 'complete'].includes(this.state)) {
      event.preventDefault()
      this.restartRun()
      return
    }

    if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') {
      if (this.state === 'menu') {
        if (this.view === 'menu') { this.audio.init(); this.startRun(this.currentLevelIndex) }
        return
      }
      if (this.state === 'dead') {
        if (this.deathShown) this.restartRun()
        return
      }
      if (this.state === 'complete') {
        if (this.completeShown) this.nextLevel()
        return
      }
      if (this.state === 'paused') { this.resume(); return }
      if (this.state === 'playing') {
        this.audio.init()
        this.held = true
        this.jumpBuffer = 0.12
      }
    }
  }

  onKeyUp(event) {
    if (['Space', 'ArrowUp', 'KeyW'].includes(event.code)) {
      this.held = false
    }
  }

  onPointerDown(event) {
    if (event.button !== 0) return
    const target = event.target
    if (target.closest?.('button, a, input, select, label, .modal__panel')) return
    this.audio.init()
    if (this.state === 'playing') {
      this.held = true
      this.jumpBuffer = 0.12
    } else if (this.state === 'dead' && this.deathShown) {
      this.restartRun()
    } else if (this.state === 'complete' && this.completeShown) {
      this.nextLevel()
    } else if (this.state === 'menu' && this.view === 'menu') {
      this.startRun(this.currentLevelIndex)
    }
  }

  toggleMute() {
    this.audio.init()
    this.settings.muted = !this.settings.muted
    this.audio.setSettings({ muted: this.settings.muted })
    this.save.settings.muted = this.settings.muted
    this.persist()
    this.el.muteBtn?.classList.toggle('is-muted', this.settings.muted)
    this.el.muteBtn?.setAttribute('aria-label', this.settings.muted ? 'Enable sound' : 'Toggle sound')
    this.showToast(this.settings.muted ? 'AUDIO MUTED' : 'AUDIO ONLINE')
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  resetProgress() {
    if (!window.confirm('Erase every best run and collected shard? This cannot be undone.')) return
    this.save.levels = {}
    this.save.totalAttempts = 0
    this.persist()
    this.refreshMenu()
    this.renderLevelCards()
    this.showToast('ARCHIVE WIPED')
  }

  applySettingsUI() {
    const s = this.save.settings
    this.settings = { ...s }
    this.el.volumeSlider.value = s.master
    this.el.musicSlider.value = s.music
    this.el.volumeOut.textContent = s.master
    this.el.musicOut.textContent = s.music
    this.el.shakeToggle.checked = s.shake
    this.el.motionToggle.checked = s.reducedMotion
    this.el.hitboxToggle.checked = s.hitboxes
    this.el.muteBtn.classList.toggle('is-muted', s.muted)
    this.reducedMotion = s.reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.body.classList.toggle('reduced-motion', this.reducedMotion)
  }

  /* ─────────────────────────── screens + theme ─────────────────────────── */

  showScreen(view) {
    this.view = view
    document.body.dataset.view = view
    document.querySelectorAll('[data-screen]').forEach((screen) => {
      screen.classList.toggle('is-active', screen.dataset.screen === view)
    })
    this.el.hud?.classList.toggle('is-visible', view === 'game')
    if (view === 'menu' || view === 'levels' || view === 'how') {
      this.closeModal(this.el.pauseModal)
      this.closeModal(this.el.deathModal)
      this.closeModal(this.el.completeModal)
      this.closeModal(this.el.settingsModal)
      if (this.state !== 'menu') {
        this.state = 'menu'
        this.audio.stopMusic()
        this.previewState = null
      }
      this.setTheme(this.level)
    }
    if (view === 'levels') {
      this.refreshLevelCards()
    }
    if (view === 'menu') this.refreshMenu()
  }

  goHome() {
    if (this.state === 'playing' || this.state === 'paused') this.recordProgress()
    this.level = levels[0]
    this.state = 'menu'
    this.audio.stopMusic()
    this.audio.startMenuMusic()
    this.showScreen('menu')
  }

  openLevels() {
    if (this.state === 'playing' || this.state === 'paused') this.recordProgress()
    this.state = 'menu'
    this.audio.stopMusic()
    this.audio.startMenuMusic()
    this.showScreen('levels')
  }

  openSettings() {
    if (this.state === 'playing') this.pause()
    this.audio.init()
    this.el.settingsModal.classList.add('is-open')
    this.applySettingsUI()
  }

  closeSettings() {
    this.el.settingsModal.classList.remove('is-open')
  }

  closeModal(element) {
    element?.classList.remove('is-open')
  }

  setTheme(level) {
    const c = level.colors
    const rgb = hexToRgb(c.primary)
    const rgb2 = hexToRgb(c.secondary)
    document.documentElement.style.setProperty('--accent', c.primary)
    document.documentElement.style.setProperty('--accent-2', c.secondary)
    document.documentElement.style.setProperty('--accent-3', c.tertiary)
    document.documentElement.style.setProperty('--accent-rgb', `${rgb.r},${rgb.g},${rgb.b}`)
    document.documentElement.style.setProperty('--accent-2-rgb', `${rgb2.r},${rgb2.g},${rgb2.b}`)
    document.documentElement.style.setProperty('--success', c.primary)
  }

  refreshTheme() {
    this.setTheme(this.level)
  }

  refreshMenu() {
    const record = this.levelRecord(levels[0])
    const best = Math.floor(record.best || 0)
    if (this.el.menuBest) this.el.menuBest.textContent = `${best}%`
    if (this.el.featureBest) this.el.featureBest.textContent = best > 0 ? `${best}%` : '—'
    if (this.el.menuAttempts) this.el.menuAttempts.textContent = this.save.totalAttempts || 0
    if (this.el.menuShards) this.el.menuShards.textContent = this.totalShardsCollected()
  }

  showToast(text) {
    if (!this.el.toast) return
    this.el.toast.textContent = text
    this.el.toast.classList.add('is-showing')
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('is-showing'), 1900)
  }

  /* ─────────────────────────── level cards ─────────────────────────── */

  renderLevelCards() {
    if (!this.el.levelGrid) return
    this.el.levelGrid.innerHTML = levels.map((level) => {
      const rgb = hexToRgb(level.primary || level.colors.primary)
      const record = this.save.levels[level.id] || { best: 0, shards: [], completed: false }
      const shardSet = new Set(record.shards || [])
      const gems = level.objects.filter((o) => o.t === 'gem')
      const diffs = Array.from({ length: 5 }, (_, i) => `<i class="${i < level.difficultyLevel ? '' : 'dim'}"></i>`).join('')
      return `
        <button class="level-card ${record.completed ? 'is-complete' : ''}" data-index="${level.index}" style="--card-accent:${level.colors.primary};--card-rgb:${rgb.r},${rgb.g},${rgb.b}">
          <div class="level-card__art">
            <canvas width="620" height="300" data-card="${level.index}"></canvas>
            <span class="level-card__no">${pad2(level.index + 1)}</span>
            <span class="level-card__diff">${level.difficulty}</span>
            <span class="level-card__complete">SIGNAL CLEARED</span>
          </div>
          <div class="level-card__body">
            <span class="level-card__tag">${level.tag} · ${level.bpm} BPM</span>
            <h3>${level.name}</h3>
            <p class="level-card__desc">${level.description}</p>
            <div class="level-card__bar">
              <div class="level-card__bar-label"><span>BEST RUN</span><strong>${Math.floor(record.best || 0)}%</strong></div>
              <div class="level-card__track"><i style="width:${Math.floor(record.best || 0)}%"></i></div>
            </div>
            <div class="level-card__foot">
              <div class="level-card__shards">${gems.map((gem) => `<i class="${shardSet.has(gem.id) ? 'on' : ''}"></i>`).join('')}</div>
              <span class="level-card__play">ENTER SIGNAL <b>→</b></span>
            </div>
          </div>
        </button>
      `
    }).join('')
    this.cardCanvases = [...this.el.levelGrid.querySelectorAll('canvas[data-card]')]
    this.drawCards(0, true)
  }

  refreshLevelCards() {
    const cards = this.el.levelGrid?.querySelectorAll('.level-card') || []
    cards.forEach((card) => {
      const level = levels[Number(card.dataset.index)]
      const record = this.save.levels[level.id] || { best: 0, shards: [], completed: false }
      const percent = Math.floor(record.best || 0)
      const label = card.querySelector('.level-card__bar-label strong')
      const bar = card.querySelector('.level-card__track i')
      if (label) label.textContent = `${percent}%`
      if (bar) bar.style.width = `${percent}%`
      card.classList.toggle('is-complete', Boolean(record.completed))
      const shardSet = new Set(record.shards || [])
      const gems = level.objects.filter((o) => o.t === 'gem')
      card.querySelectorAll('.level-card__shards i').forEach((el, i) => {
        el.classList.toggle('on', shardSet.has(gems[i]?.id))
      })
    })
  }

  drawCards(time, force = false) {
    if (!this.cardCanvases.length) return
    if (!force && this.view !== 'levels') return
    for (const canvas of this.cardCanvases) {
      const level = levels[Number(canvas.dataset.card)]
      if (!level) continue
      const ctx = canvas.getContext('2d')
      this.drawCardArt(ctx, canvas.width, canvas.height, level, time)
    }
  }

  drawCardArt(ctx, w, h, level, time) {
    const c = level.colors
    ctx.clearRect(0, 0, w, h)
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, c.bgTop)
    sky.addColorStop(0.62, c.bgMid)
    sky.addColorStop(1, c.bgBottom)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    const rand = mulberry32(level.index * 1000 + 53)
    for (let i = 0; i < 60; i++) {
      const sx = rand() * w
      const sy = rand() * h * 0.6
      const twinkle = 0.28 + (0.5 + Math.sin(time * 1.4 + i) * 0.5) * 0.5
      ctx.fillStyle = `rgba(225,247,255,${twinkle * 0.65})`
      ctx.fillRect(sx, sy, i % 9 ? 1.2 : 2, i % 9 ? 1.2 : 2)
    }

    const sunX = w * 0.72
    const sunY = h * 0.38
    const sunR = h * 0.25
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.3)
    glow.addColorStop(0, rgba(c.sun, 0.4))
    glow.addColorStop(0.4, rgba(c.sun, 0.13))
    glow.addColorStop(1, rgba(c.sun, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    const disc = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR)
    disc.addColorStop(0, c.sun)
    disc.addColorStop(0.65, c.sun2)
    disc.addColorStop(1, rgba(c.sun2, 0.14))
    ctx.fillStyle = disc
    ctx.beginPath()
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.beginPath()
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = rgba(c.bgMid, 0.5)
    for (let y = sunY - sunR; y < sunY + sunR; y += 7) ctx.fillRect(sunX - sunR, y, sunR * 2, 2)
    ctx.restore()

    const ground = h * 0.79
    ctx.fillStyle = c.skyline
    for (let i = 0; i < 17; i++) {
      const bw = 20 + ((i * 17 + level.index * 23) % 48)
      const bh = 18 + ((i * 43 + level.index * 31) % 88)
      const bx = ((i * 55 - time * 8) % (w + 140) + w + 140) % (w + 140) - 60
      ctx.fillRect(bx, ground - bh, bw, bh)
      ctx.fillStyle = rgba(c.primary, 0.24)
      ctx.fillRect(bx, ground - bh, bw, 1)
      ctx.fillStyle = c.skyline
      if (i % 3 === 0) {
        ctx.fillStyle = rgba(c.primary, 0.28)
        ctx.fillRect(bx + 8, ground - bh + 15, 3, 2)
        ctx.fillRect(bx + 18, ground - bh + 27, 4, 2)
        ctx.fillStyle = c.skyline
      }
    }

    ctx.fillStyle = c.floor
    ctx.fillRect(0, ground, w, h - ground)
    const floorGlow = ctx.createLinearGradient(0, ground - 10, 0, ground + 40)
    floorGlow.addColorStop(0, rgba(c.primary, 0.24))
    floorGlow.addColorStop(1, rgba(c.primary, 0))
    ctx.fillStyle = floorGlow
    ctx.fillRect(0, ground - 10, w, 50)
    ctx.strokeStyle = rgba(c.grid, 0.78)
    ctx.lineWidth = 1
    const off = (time * 22) % 46
    for (let x = -off; x < w + 46; x += 46) {
      ctx.beginPath()
      ctx.moveTo(x, h)
      ctx.lineTo(x + 32, ground)
      ctx.stroke()
    }
    for (let i = 1; i < 5; i++) {
      ctx.strokeStyle = rgba(c.grid, 0.34 - i * 0.05)
      ctx.beginPath()
      ctx.moveTo(0, ground + i * 22)
      ctx.lineTo(w, ground + i * 22)
      ctx.stroke()
    }
    ctx.strokeStyle = rgba(c.primary, 0.95)
    ctx.lineWidth = 2
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 14
    ctx.beginPath()
    ctx.moveTo(0, ground)
    ctx.lineTo(w, ground)
    ctx.stroke()
    ctx.shadowBlur = 0

    const configs = [
      { crop: 3140, scale: 0.35, player: 3420, air: 92 },
      { crop: 2470, scale: 0.35, player: 2590, air: 36 },
      { crop: 4190, scale: 0.35, player: 4310, air: 112 }
    ]
    const cfg = configs[level.index] || configs[0]
    const scale = cfg.scale
    const xOf = (worldX) => 28 + (worldX - cfg.crop) * scale
    const yOf = (worldY) => ground + (worldY - GROUND) * scale
    const visible = level.objects.filter((o) => o.t !== 'marker' && o.t !== 'portal' && o.x > cfg.crop - 100 && o.x < cfg.crop + (w - 50) / scale + 100)

    for (const o of visible) {
      const x = xOf(o.x)
      if (o.t === 'spike') {
        const sw = o.w * scale
        const sh = o.h * scale
        const base = yOf(o.y + o.h)
        const grad = ctx.createLinearGradient(0, base - sh, 0, base)
        grad.addColorStop(0, c.primary)
        grad.addColorStop(1, rgba(c.primary, 0.14))
        ctx.fillStyle = grad
        ctx.strokeStyle = rgba(c.primary, 0.95)
        ctx.lineWidth = 1.4
        ctx.shadowColor = c.primary
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.moveTo(x, base)
        ctx.lineTo(x + sw / 2, base - sh)
        ctx.lineTo(x + sw, base)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.shadowBlur = 0
      } else if (o.t === 'block') {
        const bw = o.w * scale
        const bh = o.h * scale
        const top = yOf(o.y)
        const grad = ctx.createLinearGradient(0, top, 0, top + bh)
        grad.addColorStop(0, 'rgba(19,34,55,.95)')
        grad.addColorStop(1, 'rgba(5,11,22,.97)')
        ctx.fillStyle = grad
        ctx.strokeStyle = rgba(c.primary, 0.78)
        ctx.lineWidth = 1.4
        ctx.fillRect(x, top, bw, bh)
        ctx.strokeRect(x, top, bw, bh)
        ctx.strokeStyle = rgba(c.primary, 0.65)
        ctx.beginPath()
        ctx.moveTo(x + 4, top + 1.5)
        ctx.lineTo(x + bw - 4, top + 1.5)
        ctx.stroke()
        ctx.strokeStyle = rgba(c.primary, 0.2)
        for (let yy = top + 12; yy < top + bh; yy += 15) {
          ctx.beginPath()
          ctx.moveTo(x + 4, yy)
          ctx.lineTo(x + bw - 4, yy)
          ctx.stroke()
        }
      } else if (o.t === 'saw') {
        const cy = yOf(o.y)
        const rad = o.r * scale
        ctx.save()
        ctx.translate(x, cy)
        ctx.rotate(time * 2.2 + level.index)
        ctx.fillStyle = 'rgba(8,10,22,.94)'
        ctx.strokeStyle = rgba(c.secondary, 0.9)
        ctx.lineWidth = 1.4
        ctx.shadowColor = c.secondary
        ctx.shadowBlur = 10
        ctx.beginPath()
        for (let i = 0; i < 28; i++) {
          const a = i / 28 * Math.PI * 2
          const r = i % 2 ? rad * 0.7 : rad
          const px = Math.cos(a) * r
          const py = Math.sin(a) * r
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.shadowBlur = 0
        ctx.strokeStyle = rgba(c.primary, 0.35)
        ctx.beginPath()
        ctx.arc(0, 0, rad * 0.3, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      } else if (o.t === 'pad') {
        const base = yOf(GROUND)
        ctx.fillStyle = c.primary
        ctx.shadowColor = c.primary
        ctx.shadowBlur = 12
        ctx.fillRect(x - 22 * scale * 2, base - 3, 44 * scale * 2, 3)
        ctx.shadowBlur = 0
      } else if (o.t === 'orb') {
        const cy = yOf(o.y)
        ctx.strokeStyle = c.primary
        ctx.lineWidth = 2
        ctx.shadowColor = c.primary
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(x, cy, Math.max(7, o.r * scale), 0, Math.PI * 2)
        ctx.stroke()
        ctx.shadowBlur = 0
      } else if (o.t === 'gem') {
        const cy = yOf(o.y)
        ctx.save()
        ctx.translate(x, cy)
        ctx.rotate(time * 1.2)
        ctx.fillStyle = c.primary
        ctx.shadowColor = c.primary
        ctx.shadowBlur = 10
        ctx.fillRect(-4, -4, 8, 8)
        ctx.restore()
      }
    }

    const playerX = xOf(cfg.player)
    const playerY = ground - PLAYER_SIZE * scale - cfg.air - Math.sin(time * 2.2) * 6
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 5; i > 0; i--) {
      ctx.fillStyle = rgba(c.primary, 0.045 * (6 - i))
      const s = PLAYER_SIZE * scale * (0.55 + i * 0.08)
      ctx.fillRect(playerX - s * 0.6 - i * 16, playerY - s * 0.5 - i * 2, s, s)
    }
    ctx.restore()
    ctx.save()
    ctx.translate(playerX, playerY + PLAYER_SIZE * scale / 2)
    ctx.rotate(Math.sin(time * 1.6) * 0.18 + 0.35)
    const ps = PLAYER_SIZE * scale
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 18
    ctx.fillStyle = '#071321'
    ctx.strokeStyle = c.primary
    ctx.lineWidth = 2
    cutRect(ctx, -ps / 2, -ps / 2, ps, ps, 6)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = c.primary
    ctx.fillRect(-ps * 0.24, -ps * 0.24, ps * 0.48, ps * 0.48)
    ctx.fillStyle = '#071321'
    ctx.fillRect(-ps * 0.1, -ps * 0.1, ps * 0.2, ps * 0.2)
    ctx.restore()

    const fade = ctx.createLinearGradient(0, 0, 0, h)
    fade.addColorStop(0, 'rgba(3,6,16,0)')
    fade.addColorStop(0.58, 'rgba(3,6,16,0.04)')
    fade.addColorStop(1, 'rgba(3,6,16,0.64)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, w, h)
  }

  /* ─────────────────────────── run lifecycle ─────────────────────────── */

  startRun(index) {
    this.audio.init()
    const level = levels[clamp(index, 0, levels.length - 1)]
    this.currentLevelIndex = level.index
    this.level = level
    this.finishX = levelLength(level)
    this.setTheme(level)
    this.showScreen('game')
    this.state = 'playing'
    this.closeModal(this.el.pauseModal)
    this.closeModal(this.el.deathModal)
    this.closeModal(this.el.completeModal)
    this.startAttempt()
    this.audio.startLevelMusic(level)
    this.refreshMenu()
    this.lastFrame = performance.now()
    this.render()
  }

  startAttempt() {
    const record = this.levelRecord()
    record.attempts = (record.attempts || 0) + 1
    this.save.totalAttempts = (this.save.totalAttempts || 0) + 1
    this.attempts = record.attempts
    this.persist()

    this.player = {
      x: 0, y: GROUND - PLAYER_SIZE, vy: 0,
      w: PLAYER_SIZE, h: PLAYER_SIZE, onGround: true, mode: 'cube', rotation: 0, squash: 1
    }
    this.trail = []
    this.trailTimer = 0
    this.particles = []
    this.runShards = new Set()
    this.usedGems = new Set()
    this.usedOrbs = new Set()
    this.usedPads = new Set()
    this.usedPortals = new Set()
    this.levelTime = 0
    this.progress = 0
    this.camX = -this.anchorX
    this.deathTimer = 0
    this.completeTimer = 0
    this.deathShown = false
    this.completeShown = false
    this.held = false
    this.jumpBuffer = 0
    this.shake = 0
    this.flash = { color: this.level.colors.primary, alpha: 0.55 }
    this.modeCalloutTimer = 0
    this.hintTimer = 4.2
    this.lastPercent = -1
    this.el.startHint?.classList.add('is-showing')
    this.el.modeCallout?.classList.remove('is-showing')
    this.updateHud(true)
  }

  restartRun() {
    if (!levels[this.currentLevelIndex]) return
    this.audio.init()
    this.startRun(this.currentLevelIndex)
  }

  nextLevel() {
    if (this.currentLevelIndex + 1 < levels.length) {
      this.startRun(this.currentLevelIndex + 1)
    } else {
      this.exitToLevels()
    }
  }

  exitToLevels() {
    if (this.state === 'playing' || this.state === 'paused' || this.state === 'dead') this.recordProgress()
    this.state = 'menu'
    this.audio.stopMusic()
    this.audio.startMenuMusic()
    this.closeModal(this.el.deathModal)
    this.closeModal(this.el.completeModal)
    this.closeModal(this.el.pauseModal)
    this.closeModal(this.el.settingsModal)
    this.showScreen('levels')
  }

  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.held = false
    this.audio.pause()
    this.el.pauseProgress.textContent = `${Math.floor(this.progress)}%`
    this.el.pauseAttempt.textContent = pad2(this.attempts)
    this.el.pauseShards.textContent = `${this.runShards.size}/3`
    this.el.pauseModal.classList.add('is-open')
    this.audio.sfx('ui')
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    this.audio.resume()
    this.closeModal(this.el.pauseModal)
    this.audio.sfx('ui')
  }

  recordProgress() {
    if (!this.level) return
    const record = this.levelRecord()
    const percent = this.state === 'complete' ? 100 : Math.floor(this.progress)
    if (percent > (record.best || 0)) record.best = percent
    record.shards = [...new Set([...(record.shards || []), ...this.runShards])]
    if (this.state === 'complete') {
      record.completed = true
      record.best = 100
      record.bestTime = record.bestTime ? Math.min(record.bestTime, this.levelTime) : this.levelTime
    }
    this.persist()
    this.refreshLevelCards()
    this.refreshMenu()
  }

  completeRun() {
    if (this.state !== 'playing') return
    this.state = 'complete'
    this.progress = 100
    this.completeTimer = 0
    this.completeShown = false
    this.player.x = this.finishX - 12
    this.camX = this.player.x - this.anchorX
    this.held = false
    this.spawnBurst(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, this.level.colors.primary, 70, 640, 'confetti')
    this.spawnRing(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, this.level.colors.primary, 210)
    this.flash = { color: this.level.colors.primary, alpha: 0.8 }
    this.shake = this.settings.shake ? 12 : 0
    this.audio.stopMusic()
    this.audio.sfx('complete')
    const record = this.levelRecord()
    record.completed = true
    record.best = 100
    if (this.levelTime && (!record.bestTime || this.levelTime < record.bestTime)) record.bestTime = this.levelTime
    record.shards = [...new Set([...(record.shards || []), ...this.runShards])]
    this.persist()
    this.updateHud(true)
  }

  die() {
    if (this.state !== 'playing') return
    this.state = 'dead'
    this.deathTimer = 0
    this.deathShown = false
    this.held = false
    this.audio.stopMusic()
    this.audio.sfx('death')
    this.spawnBurst(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, this.level.colors.primary, 46, 520, 'debris')
    this.spawnBurst(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, '#ffffff', 18, 420, 'spark')
    this.spawnRing(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, this.level.colors.secondary, 150)
    this.flash = { color: this.level.colors.secondary, alpha: 0.72 }
    this.shake = this.settings.shake ? 18 : 0
    this.trail = []
    this.player.dead = true
    const record = this.levelRecord()
    const percent = Math.floor(this.progress)
    if (percent > (record.best || 0)) record.best = percent
    record.shards = [...new Set([...(record.shards || []), ...this.runShards])]
    this.persist()
    this.el.deathPercent.textContent = `${percent}%`
    this.el.deathAttempt.textContent = pad2(this.attempts)
    this.el.deathBest.textContent = `${Math.floor(record.best)}%`
    this.el.deathShards.textContent = `${this.runShards.size}/3`
    this.updateHud(true)
    this.refreshMenu()
  }

  showDeathModal() {
    if (this.deathShown) return
    this.deathShown = true
    this.el.deathModal.classList.add('is-open')
  }

  showCompleteModal() {
    if (this.completeShown) return
    this.completeShown = true
    const record = this.levelRecord()
    this.el.completeLevel.textContent = this.level.name
    this.el.completeTime.textContent = formatTime(this.levelTime)
    this.el.completeAttempts.textContent = pad2(this.attempts)
    this.el.completeShards.textContent = `${this.runShards.size}/${this.level.shardCount}`
    this.el.nextLevelBtn.querySelector('.btn__label').textContent = this.currentLevelIndex + 1 < levels.length ? 'NEXT SIGNAL' : 'LEVEL SELECT'
    this.el.completeStars.querySelectorAll('i').forEach((star, i) => star.classList.toggle('on', i < this.runShards.size))
    this.el.completeModal.classList.add('is-open')
    this.spawnBurst(this.player.x + 20, this.player.y, this.level.colors.primary, 34, 500, 'confetti')
    this.refreshLevelCards()
    this.refreshMenu()
    if (record.completed) this.showToast('SIGNAL ARCHIVED · 100%')
  }

  /* ─────────────────────────── input / update ─────────────────────────── */

  loop(now) {
    const dt = Math.min(0.033, Math.max(0.001, (now - this.lastFrame) / 1000))
    this.lastFrame = now
    this.time += dt
    if (this.state === 'playing') this.updatePlaying(dt)
    else if (this.state === 'dead') this.updateDead(dt)
    else if (this.state === 'complete') this.updateComplete(dt)
    else if (this.state === 'menu' || this.state === 'paused') this.updateAmbient(dt)

    this.updateParticles(dt)
    this.flash.alpha = Math.max(0, this.flash.alpha - dt * 2.8)
    this.shake = Math.max(0, this.shake - dt * 28)
    if (this.shake > 0 && this.settings.shake && !this.reducedMotion) {
      const t = this.time * 57
      this.shakeX = Math.sin(t) * this.shake * 0.55 + Math.sin(t * 2.7) * this.shake * 0.2
      this.shakeY = Math.cos(t * 1.3) * this.shake * 0.45
    } else {
      this.shakeX = 0
      this.shakeY = 0
    }
    this.render()
    if (this.view === 'menu' && this.previewCtx) {
      this.updatePreview(dt)
      this.renderPreview()
    }
    if (this.view === 'levels') this.drawCards(this.time)
    requestAnimationFrame((t) => this.loop(t))
  }

  updatePlaying(dt) {
    this.levelTime += dt
    const p = this.player
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)
    this.camX = p.x - this.anchorX
    const prevX = p.x
    const prevY = p.y
    const prevBottom = prevY + p.h
    p.x += this.level.speed * dt

    if (p.mode === 'cube') {
      if (p.onGround && (this.held || this.jumpBuffer > 0)) {
        this.jump(prevX)
      }
      p.vy = Math.min(1700, p.vy + CUBE_GRAVITY * dt)
      p.y += p.vy * dt
      if (!p.onGround) p.rotation += dt * 5.2
    } else {
      p.vy += (this.held ? SHIP_THRUST : SHIP_GRAVITY) * dt
      p.vy = clamp(p.vy, -SHIP_MAX, SHIP_MAX)
      p.y += p.vy * dt
      p.rotation = clamp(p.vy / 1000, -0.52, 0.62)
      if (p.y < 62) {
        p.y = 62
        p.vy = Math.max(0, p.vy)
      }
    }

    this.handleGround(prevBottom, prevY)
    this.handleObjects(prevX, prevY, prevBottom)
    this.handlePortals(prevX)
    this.handlePads(prevX, prevY)
    this.handleOrbs(prevX, prevY)
    this.handleGems(prevX, prevY)

    if (p.y > 900) this.die()
    this.progress = clamp((p.x / this.finishX) * 100, 0, 100)
    if (p.x >= this.finishX - 24) this.completeRun()
    this.updateTrail(dt)
    this.updateHud()
    if (this.hintTimer > 0) {
      this.hintTimer -= dt
      if (this.hintTimer <= 0) this.el.startHint?.classList.remove('is-showing')
    }
    if (this.modeCalloutTimer > 0) {
      this.modeCalloutTimer -= dt
      if (this.modeCalloutTimer <= 0) this.el.modeCallout?.classList.remove('is-showing')
    }
  }

  updateDead(dt) {
    this.deathTimer += dt
    if (this.deathTimer > 0.64) this.showDeathModal()
    this.updateAmbient(dt)
  }

  updateComplete(dt) {
    this.completeTimer += dt
    if (this.completeTimer > 0.9) this.showCompleteModal()
  }

  updateAmbient(dt) {
    this.ambientCam += dt * (this.reducedMotion ? 14 : 34)
  }

  handleGround(prevBottom, prevY) {
    const p = this.player
    if (p.y + p.h >= GROUND) {
      if (p.mode === 'ship') {
        this.die()
        return
      }
      const impact = p.vy
      p.y = GROUND - p.h
      p.vy = 0
      if (!p.onGround) {
        p.onGround = true
        p.rotation = Math.round(p.rotation / (Math.PI / 2)) * (Math.PI / 2)
        p.squash = 0.82
        if (impact > 600) {
          this.spawnDust(p.x, GROUND, 7, impact / 1800)
          if (this.settings.shake) this.shake = Math.max(this.shake, Math.min(5, impact / 300))
        }
        if (this.jumpBuffer > 0) this.jump()
      }
    } else if (p.mode === 'cube') {
      p.onGround = false
    }
    p.squash = lerp(p.squash, 1, 0.18)
  }

  jump(x = this.player.x) {
    const p = this.player
    p.vy = JUMP_FORCE
    p.onGround = false
    p.rotation += 0.12
    p.squash = 1.14
    this.jumpBuffer = 0
    this.spawnDust(p.x + p.w / 2, p.y + p.h, 5, 1)
    this.audio.sfx('jump')
  }

  handleObjects(prevX, prevY, prevBottom) {
    const p = this.player
    const inset = 4
    const box = { left: p.x + inset, right: p.x + p.w - inset, top: p.y + inset, bottom: p.y + p.h - inset }
    for (const o of this.level.objects) {
      if (o.t === 'block') {
        if (o.x > p.x + p.w + 30 || o.x + o.w < p.x - 30) continue
        if (box.right <= o.x || box.left >= o.x + o.w || box.bottom <= o.y || box.top >= o.y + o.h) continue
        if (p.mode === 'cube' && p.vy >= 0 && prevBottom <= o.y + 9) {
          p.y = o.y - p.h
          p.vy = 0
          if (!p.onGround) {
            p.onGround = true
            p.rotation = Math.round(p.rotation / (Math.PI / 2)) * (Math.PI / 2)
            this.spawnDust(p.x + p.w / 2, p.y + p.h, 4, 0.7)
          }
          if (this.jumpBuffer > 0) this.jump()
          continue
        }
        this.die()
        return
      }
      if (o.t === 'spike') {
        const hx = o.x + 10
        const hy = o.y + 17
        const hw = o.w - 20
        const hh = o.h - 17
        if (box.right > hx && box.left < hx + hw && box.bottom > hy && box.top < hy + hh) {
          this.die()
          return
        }
      }
      if (o.t === 'saw') {
        const cx = o.x
        const cy = o.y
        const nx = clamp(cx, box.left, box.right)
        const ny = clamp(cy, box.top, box.bottom)
        if ((cx - nx) ** 2 + (cy - ny) ** 2 < (o.r * 0.84) ** 2) {
          this.die()
          return
        }
      }
    }
  }

  handlePortals(prevX) {
    const p = this.player
    const center = p.x + p.w / 2
    const prevCenter = prevX + p.w / 2
    for (const o of this.level.objects) {
      if (o.t !== 'portal' || this.usedPortals.has(o.id)) continue
      if (prevCenter <= o.x && center >= o.x) {
        this.usedPortals.add(o.id)
        if (o.kind !== p.mode) {
          p.mode = o.kind
          p.vy = 0
          p.rotation = 0
          if (o.kind === 'ship') {
            p.y = GROUND - 132
            p.onGround = false
            this.showModeCallout('SHIP MODE', 'HOLD TO THRUST')
          } else {
            p.onGround = false
            this.showModeCallout('CUBE MODE', 'SPACE TO JUMP')
          }
          this.spawnRing(o.x, GROUND - 150, o.kind === 'ship' ? this.level.colors.secondary : this.level.colors.primary, 180)
          this.spawnBurst(o.x, GROUND - 150, o.kind === 'ship' ? this.level.colors.secondary : this.level.colors.primary, 34, 460, 'spark')
          this.flash = { color: o.kind === 'ship' ? this.level.colors.secondary : this.level.colors.primary, alpha: 0.45 }
          this.shake = this.settings.shake ? 6 : 0
          this.audio.sfx('portal')
          this.updateHud(true)
        }
      }
    }
  }

  handlePads(prevX, prevY) {
    const p = this.player
    if (p.mode !== 'cube') return
    for (const o of this.level.objects) {
      if (o.t !== 'pad' || this.usedPads.has(o.id)) continue
      if (p.x + p.w > o.x - o.w / 2 && p.x < o.x + o.w / 2 && p.y + p.h > GROUND - 18 && p.y + p.h < GROUND + 10) {
        this.usedPads.add(o.id)
        p.vy = -1140
        p.onGround = false
        p.squash = 0.72
        this.spawnBurst(o.x, GROUND - 8, this.level.colors.primary, 16, 270, 'spark')
        this.spawnRing(o.x, GROUND - 6, this.level.colors.primary, 70)
        this.audio.sfx('pad')
        if (this.settings.shake) this.shake = 4
      }
    }
  }

  handleOrbs(prevX, prevY) {
    const p = this.player
    if (p.mode !== 'cube' || this.jumpBuffer <= 0 || p.onGround) return
    const cx = p.x + p.w / 2
    const cy = p.y + p.h / 2
    let nearest = null
    let nearestDist = Infinity
    for (const o of this.level.objects) {
      if (o.t !== 'orb' || this.usedOrbs.has(o.id)) continue
      const d = Math.hypot(o.x - cx, o.y - cy)
      if (d < 58 && d < nearestDist) {
        nearest = o
        nearestDist = d
      }
    }
    if (nearest) {
      this.usedOrbs.add(nearest.id)
      p.vy = -860
      p.onGround = false
      p.rotation += 0.35
      this.jumpBuffer = 0
      this.spawnRing(nearest.x, nearest.y, this.level.colors.primary, 62)
      this.spawnBurst(nearest.x, nearest.y, this.level.colors.primary, 15, 230, 'spark')
      this.audio.sfx('orb')
      if (this.settings.shake) this.shake = Math.max(this.shake, 2.5)
    }
  }

  handleGems(prevX, prevY) {
    const p = this.player
    const cx = p.x + p.w / 2
    const cy = p.y + p.h / 2
    for (const o of this.level.objects) {
      if (o.t !== 'gem' || this.usedGems.has(o.id)) continue
      if (Math.hypot(o.x - cx, o.y - cy) < 36) {
        this.usedGems.add(o.id)
        this.runShards.add(o.id)
        const record = this.levelRecord()
        record.shards = [...new Set([...(record.shards || []), o.id])]
        this.persist()
        this.spawnBurst(o.x, o.y, this.level.colors.primary, 22, 300, 'spark')
        this.spawnRing(o.x, o.y, '#ffffff', 48)
        this.audio.sfx('gem')
        this.showToast(`SHARD SECURED · ${this.runShards.size}/${this.level.shardCount}`)
        this.updateHud(true)
        this.refreshLevelCards()
      }
    }
  }

  updateTrail(dt) {
    const p = this.player
    this.trailTimer -= dt
    if (this.trailTimer <= 0) {
      this.trailTimer = p.mode === 'ship' ? 0.018 : 0.032
      this.trail.push({
        x: p.x + p.w / 2, y: p.y + p.h / 2,
        rot: p.rotation, mode: p.mode, life: 0.38, max: 0.38,
        color: this.level.colors.primary
      })
      if (this.trail.length > 24) this.trail.shift()
    }
    for (const point of this.trail) point.life -= dt
    this.trail = this.trail.filter((point) => point.life > 0)
  }

  updateHud(force = false) {
    const percent = Math.floor(this.progress)
    if (force || percent !== this.lastPercent) {
      this.lastPercent = percent
      this.el.hudPercent.textContent = `${percent}%`
      this.el.progressFill.style.width = `${this.progress}%`
      this.el.progressGlint.style.left = `${this.progress}%`
    }
    if (force) {
      this.el.hudAttempt.textContent = pad2(this.attempts)
      this.el.hudShards.textContent = `${this.runShards.size}/${this.level.shardCount}`
      this.el.hudMode.textContent = this.player.mode.toUpperCase()
      this.el.hudLevelNo.textContent = pad2(this.level.index + 1)
      this.el.hudLevelName.textContent = this.level.name
    }
  }

  showModeCallout(title, sub) {
    if (!this.el.modeCallout) return
    this.el.modeCallout.querySelector('strong').textContent = title
    this.el.modeCallout.querySelector('em').textContent = sub
    this.el.modeCallout.classList.remove('is-showing')
    void this.el.modeCallout.offsetWidth
    this.el.modeCallout.classList.add('is-showing')
    this.modeCalloutTimer = 2
  }

  /* ─────────────────────────── particles ─────────────────────────── */

  addParticle(particle) {
    if (this.particles.length > 320) this.particles.shift()
    this.particles.push(particle)
  }

  spawnBurst(x, y, color, count, power, kind = 'spark') {
    const rand = mulberry32(Math.floor(this.time * 9999) + count)
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2
      const speed = power * (0.22 + rand() * 0.78)
      this.addParticle({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (kind === 'confetti' ? 160 : 30),
        life: 0.45 + rand() * (kind === 'confetti' ? 1.15 : 0.62),
        max: 1.6,
        size: kind === 'confetti' ? 3 + rand() * 6 : 1.4 + rand() * 4.2,
        color: rand() > 0.25 ? color : '#ffffff',
        gravity: kind === 'confetti' ? 520 : 740,
        drag: kind === 'confetti' ? 0.985 : 0.98,
        rot: rand() * Math.PI * 2,
        spin: (rand() - 0.5) * 14,
        kind
      })
    }
  }

  spawnRing(x, y, color, size) {
    this.addParticle({
      x, y, vx: 0, vy: 0, life: 0.44, max: 0.44, size, color,
      gravity: 0, drag: 1, rot: 0, spin: 0, kind: 'ring'
    })
  }

  spawnDust(x, y, count, power = 1) {
    const rand = mulberry32(Math.floor(this.time * 777) + count)
    for (let i = 0; i < count; i++) {
      this.addParticle({
        x: x - 8 + rand() * 16, y: y - 2,
        vx: -80 - rand() * 180 * power,
        vy: -20 - rand() * 120 * power,
        life: 0.25 + rand() * 0.28, max: 0.55,
        size: 1.2 + rand() * 2.6,
        color: rand() > 0.55 ? this.level.colors.primary : '#c9f8ff',
        gravity: 220, drag: 0.96, rot: 0, spin: 0, kind: 'dust'
      })
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.gravity * dt
      p.vx *= p.drag
      p.vy *= p.drag
      p.rot += p.spin * dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)
  }

  /* ─────────────────────────── preview ─────────────────────────── */

  updatePreview(dt) {
    if (!this.previewState) this.resetPreview()
    const p = this.previewState
    p.x += 330 * dt
    p.vy += CUBE_GRAVITY * dt * 0.7
    p.y += p.vy * dt
    if (p.y + PLAYER_SIZE >= GROUND) {
      p.y = GROUND - PLAYER_SIZE
      p.vy = 0
      p.onGround = true
    } else {
      p.onGround = false
    }
    p.rotation += dt * (p.onGround ? 0 : 4.8)
    if (p.onGround) p.rotation = Math.round(p.rotation / (Math.PI / 2)) * (Math.PI / 2)

    const ahead = this.level.objects.find((o) =>
      (o.t === 'spike' || o.t === 'block' || o.t === 'saw') &&
      o.x > p.x + 20 && o.x < p.x + 150
    )
    if (ahead && p.onGround) {
      p.vy = JUMP_FORCE * 0.92
      p.onGround = false
      p.jumps++
      this.spawnDustPreview(p.x + PLAYER_SIZE / 2, GROUND)
    }
    if (p.x > 6800) this.resetPreview()
    p.trail.unshift({ x: p.x + PLAYER_SIZE / 2, y: p.y + PLAYER_SIZE / 2, rot: p.rotation })
    if (p.trail.length > 20) p.trail.pop()
  }

  resetPreview() {
    this.previewState = {
      x: 3340, y: GROUND - PLAYER_SIZE, vy: 0, onGround: true,
      rotation: 0, trail: [], jumps: 0
    }
  }

  spawnDustPreview(x, y) {
    if (!this.previewState) return
    this.previewState.dust = this.previewState.dust || []
    for (let i = 0; i < 4; i++) {
      this.previewState.dust.push({ x, y, vx: -20 - Math.random() * 30, vy: -10 - Math.random() * 20, life: 0.5 })
    }
  }

  renderPreview() {
    const canvas = this.previewCanvas
    if (!canvas || !canvas.offsetParent) return
    const ctx = this.previewCtx
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const p = this.previewState
    const c = this.level.colors
    const scale = 0.53
    const groundY = h * 0.75

    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, c.bgTop)
    sky.addColorStop(0.65, c.bgMid)
    sky.addColorStop(1, c.bgBottom)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    const rand = mulberry32(114)
    for (let i = 0; i < 42; i++) {
      const sx = ((rand() * w - this.ambientCam * 0.6) % w + w) % w
      const sy = rand() * h * 0.55
      ctx.fillStyle = `rgba(210,245,255,${0.16 + rand() * 0.55})`
      ctx.fillRect(sx, sy, 1.3, 1.3)
    }
    const sunX = w * 0.72
    const sunY = h * 0.34
    const sr = h * 0.22
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sr * 2.4)
    glow.addColorStop(0, rgba(c.sun, 0.4))
    glow.addColorStop(1, rgba(c.sun, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    const disc = ctx.createLinearGradient(0, sunY - sr, 0, sunY + sr)
    disc.addColorStop(0, c.sun)
    disc.addColorStop(1, c.sun2)
    ctx.fillStyle = disc
    ctx.beginPath()
    ctx.arc(sunX, sunY, sr, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.beginPath()
    ctx.arc(sunX, sunY, sr, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = rgba(c.bgMid, 0.5)
    for (let y = sunY - sr; y < sunY + sr; y += 6) ctx.fillRect(sunX - sr, y, sr * 2, 1.7)
    ctx.restore()

    ctx.fillStyle = c.skyline
    for (let i = 0; i < 14; i++) {
      const bw = 22 + ((i * 31 + 17) % 52)
      const bh = 20 + ((i * 47) % 68)
      const bx = ((i * 59 - this.ambientCam * 0.14) % (w + 120) + w + 120) % (w + 120) - 60
      ctx.fillRect(bx, groundY - bh, bw, bh)
      ctx.fillStyle = rgba(c.primary, 0.24)
      ctx.fillRect(bx, groundY - bh, bw, 1.2)
      if (i % 3 === 0) {
        ctx.fillStyle = rgba(c.primary, 0.34)
        ctx.fillRect(bx + 8, groundY - bh + 17, 4, 2)
      }
      ctx.fillStyle = c.skyline
    }

    const floorGlow = ctx.createLinearGradient(0, groundY - 16, 0, groundY + 42)
    floorGlow.addColorStop(0, rgba(c.primary, 0.24))
    floorGlow.addColorStop(1, rgba(c.primary, 0))
    ctx.fillStyle = floorGlow
    ctx.fillRect(0, groundY - 16, w, 58)

    ctx.save()
    ctx.translate(0, groundY - GROUND * scale)
    ctx.scale(scale, scale)
    const camX = p.x - 250 / scale
    ctx.translate(-camX, 0)

    ctx.fillStyle = c.floor
    ctx.fillRect(camX, GROUND, w / scale + 50, (h - groundY) / scale + 40)
    ctx.strokeStyle = rgba(c.grid, 0.58)
    ctx.lineWidth = 1
    const offset = ((camX % 84) + 84) % 84
    for (let x = -offset; x < w / scale + 84; x += 84) {
      ctx.beginPath()
      ctx.moveTo(camX + x, GROUND)
      ctx.lineTo(camX + x - 50, GROUND + 150)
      ctx.stroke()
    }
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = rgba(c.grid, 0.34 - i * 0.05)
      ctx.beginPath()
      ctx.moveTo(camX, GROUND + 22 + i * 24)
      ctx.lineTo(camX + w / scale, GROUND + 22 + i * 24)
      ctx.stroke()
    }
    ctx.strokeStyle = rgba(c.primary, 0.95)
    ctx.lineWidth = 2.4
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 12
    ctx.beginPath()
    ctx.moveTo(camX, GROUND)
    ctx.lineTo(camX + w / scale, GROUND)
    ctx.stroke()
    ctx.shadowBlur = 0

    for (const o of this.level.objects) {
      if (o.t === 'marker') continue
      if (o.x < camX - 200 || o.x > camX + w / scale + 300) continue
      if (o.t === 'gem' && this.usedGems.has(o.id)) continue
      this.drawMiniObject(ctx, o, this.time)
    }

    if (p.trail.length > 1) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = p.trail.length - 1; i > 0; i--) {
        const a = (1 - i / p.trail.length) * 0.22
        const q = p.trail[i]
        ctx.fillStyle = rgba(c.primary, a)
        ctx.fillRect(q.x - 18, q.y - 18, 36, 36)
      }
      ctx.restore()
    }

    if (p.dust) {
      for (const d of p.dust) {
        d.life -= 0.016
        d.x += d.vx * 0.016
        d.y += d.vy * 0.016
        ctx.fillStyle = rgba(c.primary, Math.max(0, d.life) * 0.5)
        ctx.fillRect(d.x, d.y, 2, 2)
      }
      p.dust = p.dust.filter((d) => d.life > 0)
    }

    ctx.save()
    ctx.translate(p.x + PLAYER_SIZE / 2, p.y + PLAYER_SIZE / 2)
    ctx.rotate(p.rotation)
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 20
    ctx.fillStyle = '#071321'
    ctx.strokeStyle = c.primary
    ctx.lineWidth = 3
    cutRect(ctx, -PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = c.primary
    ctx.fillRect(-8, -8, 16, 16)
    ctx.fillStyle = '#071321'
    ctx.fillRect(-4, -4, 8, 8)
    ctx.restore()
    ctx.restore()

    const fade = ctx.createLinearGradient(0, 0, 0, h)
    fade.addColorStop(0, 'rgba(4,7,18,0.05)')
    fade.addColorStop(0.55, 'rgba(4,7,18,0)')
    fade.addColorStop(1, 'rgba(4,7,18,0.5)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, w, h)
  }

  drawMiniObject(ctx, o, time) {
    const c = this.level.colors
    if (o.t === 'spike') {
      const grad = ctx.createLinearGradient(0, o.y, 0, o.y + o.h)
      grad.addColorStop(0, rgba(c.primary, 0.95))
      grad.addColorStop(1, rgba(c.primary, 0.18))
      ctx.fillStyle = grad
      ctx.strokeStyle = c.primary
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(o.x, o.y + o.h)
      ctx.lineTo(o.x + o.w / 2, o.y)
      ctx.lineTo(o.x + o.w, o.y + o.h)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else if (o.t === 'block') {
      ctx.fillStyle = 'rgba(5,12,24,0.9)'
      ctx.strokeStyle = rgba(c.primary, 0.8)
      ctx.lineWidth = 2
      ctx.fillRect(o.x, o.y, o.w, o.h)
      ctx.strokeRect(o.x, o.y, o.w, o.h)
      ctx.strokeStyle = rgba(c.primary, 0.18)
      for (let y = o.y + 20; y < o.y + o.h; y += 28) {
        ctx.beginPath()
        ctx.moveTo(o.x + 6, y)
        ctx.lineTo(o.x + o.w - 6, y)
        ctx.stroke()
      }
    } else if (o.t === 'saw') {
      ctx.save()
      ctx.translate(o.x, o.y)
      ctx.rotate(time * 4)
      ctx.strokeStyle = rgba(c.secondary, 0.9)
      ctx.fillStyle = 'rgba(14,10,25,0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2
        const r = i % 2 ? o.r * 0.72 : o.r
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, o.r * 0.28, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    } else if (o.t === 'pad') {
      ctx.fillStyle = c.primary
      ctx.shadowColor = c.primary
      ctx.shadowBlur = 14
      ctx.fillRect(o.x - 28, GROUND - 8, 56, 6)
      ctx.shadowBlur = 0
    } else if (o.t === 'orb') {
      const pulse = 1 + Math.sin(time * 5) * 0.1
      ctx.strokeStyle = c.primary
      ctx.lineWidth = 3
      ctx.shadowColor = c.primary
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.arc(o.x, o.y, o.r * pulse, 0, Math.PI * 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    } else if (o.t === 'gem') {
      ctx.save()
      ctx.translate(o.x, o.y)
      ctx.rotate(time * 1.4)
      ctx.fillStyle = c.primary
      ctx.shadowColor = c.primary
      ctx.shadowBlur = 15
      ctx.beginPath()
      ctx.moveTo(0, -13)
      ctx.lineTo(9, 0)
      ctx.lineTo(0, 13)
      ctx.lineTo(-9, 0)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    } else if (o.t === 'portal') {
      ctx.save()
      ctx.strokeStyle = rgba(o.kind === 'ship' ? c.secondary : c.primary, 0.85)
      ctx.lineWidth = 3
      ctx.shadowColor = o.kind === 'ship' ? c.secondary : c.primary
      ctx.shadowBlur = 18
      ctx.beginPath()
      ctx.ellipse(o.x, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  /* ─────────────────────────── rendering ─────────────────────────── */

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth
    const height = window.innerHeight
    this.canvas.width = Math.max(1, Math.floor(width * dpr))
    this.canvas.height = Math.max(1, Math.floor(height * dpr))
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.dpr = dpr
    this.scale = height / VIEW_H
    this.viewW = width / this.scale
    this.viewH = VIEW_H
    this.anchorX = clamp(this.viewW * 0.29, 235, 390)
    this.buildGradients()
    this.resizeCardCanvases()
  }

  resizeCardCanvases() {
    this.cardCanvases.forEach((canvas) => {
      canvas.width = 620
      canvas.height = 300
    })
  }

  buildGradients() {
    const ctx = this.ctx
    const c = this.level.colors
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND)
    sky.addColorStop(0, c.bgTop)
    sky.addColorStop(0.52, c.bgMid)
    sky.addColorStop(1, c.bgBottom)
    this.skyGrad = sky
    const floor = ctx.createLinearGradient(0, GROUND, 0, this.viewH)
    floor.addColorStop(0, c.floor)
    floor.addColorStop(1, '#010208')
    this.floorGrad = floor
    const glow = ctx.createLinearGradient(0, GROUND, 0, GROUND + 42)
    glow.addColorStop(0, rgba(c.primary, 0.26))
    glow.addColorStop(1, rgba(c.primary, 0))
    this.floorGlow = glow
    const haze = ctx.createRadialGradient(this.viewW * 0.69, GROUND * 0.55, 0, this.viewW * 0.69, GROUND * 0.55, this.viewW * 0.55)
    haze.addColorStop(0, rgba(c.haze, 0.42))
    haze.addColorStop(0.5, rgba(c.haze, 0.13))
    haze.addColorStop(1, rgba(c.haze, 0))
    this.hazeGrad = haze
  }

  render() {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const scale = this.dpr * this.scale
    ctx.setTransform(scale, 0, 0, scale, 0, 0)

    const inGame = this.view === 'game'
    const cam = inGame ? this.camX : this.ambientCam
    const bpm = inGame ? this.level?.bpm || 120 : 108
    const beatT = (this.time * bpm / 60) % 1
    const pulse = this.reducedMotion ? 0.2 : Math.pow(1 - beatT, 4)

    this.drawBackdrop(cam, pulse, inGame)
    if (inGame) {
      ctx.save()
      ctx.translate(-cam + this.shakeX, this.shakeY)
      this.drawWorldMarkers(cam)
      this.drawFinish()
      this.drawObjects(cam)
      if (this.state !== 'dead' || this.deathTimer < 0.035) this.drawTrail()
      this.drawPlayer()
      this.drawParticles()
      if (this.settings.hitboxes) this.drawHitboxes()
      ctx.restore()
      this.drawForeground()
    } else {
      this.drawAmbientGeometry(cam)
    }
    if (this.flash.alpha > 0) {
      ctx.fillStyle = rgba(this.flash.color, Math.min(0.8, this.flash.alpha))
      ctx.fillRect(0, 0, this.viewW, this.viewH)
    }
  }

  drawBackdrop(cam, pulse) {
    const ctx = this.ctx
    const c = this.level.colors
    const viewW = this.viewW
    const viewH = this.viewH
    ctx.fillStyle = this.skyGrad
    ctx.fillRect(0, 0, viewW, viewH)
    ctx.fillStyle = this.hazeGrad
    ctx.fillRect(0, 0, viewW, viewH)

    const sunX = viewW * 0.72 - Math.sin(this.ambientCam * 0.0002) * 8
    const sunY = viewH * 0.31
    const sunR = viewH * 0.155 * (1 + pulse * 0.014)
    ctx.save()
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.8)
    glow.addColorStop(0, rgba(c.sun, 0.28 + pulse * 0.08))
    glow.addColorStop(0.42, rgba(c.sun, 0.09))
    glow.addColorStop(1, rgba(c.sun, 0))
    ctx.fillStyle = glow
    ctx.fillRect(sunX - sunR * 3, sunY - sunR * 3, sunR * 6, sunR * 6)
    const disc = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR)
    disc.addColorStop(0, rgba(c.sun, 0.9))
    disc.addColorStop(0.55, rgba(c.sun2, 0.86))
    disc.addColorStop(1, rgba(c.sun2, 0.13))
    ctx.fillStyle = disc
    ctx.beginPath()
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.beginPath()
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = rgba(c.bgMid, 0.52)
    for (let y = sunY - sunR; y < sunY + sunR; y += 6.5) ctx.fillRect(sunX - sunR, y, sunR * 2, 1.8)
    ctx.restore()
    ctx.strokeStyle = rgba(c.sun, 0.22)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(sunX, sunY, sunR * 1.14, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    const rand = mulberry32(91)
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i]
      const twinkle = 0.66 + Math.sin(this.time * (1.1 + s.depth) + s.phase) * 0.25
      const sx = ((s.x * viewW - cam * s.depth * 0.12) % (viewW + 20) + viewW + 20) % (viewW + 20) - 10
      const sy = s.y * viewH
      const size = s.size * (s.bright ? 1.55 : 1)
      ctx.fillStyle = `rgba(220,245,255,${twinkle * (0.25 + s.depth * 0.7)})`
      if (s.bright) {
        ctx.fillRect(sx - size, sy, size * 3, 0.7)
        ctx.fillRect(sx, sy - size, 0.7, size * 3)
      }
      ctx.fillRect(sx, sy, size, size)
    }

    this.drawDecorativeGeometry(cam)
    this.drawSkyline(this.buildingsFar, cam, 0.065, c.skyline, c, this.time, 0.55)
    this.drawSkyline(this.buildingsNear, cam, 0.17, c.skyline2, c, this.time, 1)
    this.drawFloor(cam, pulse)
  }

  drawDecorativeGeometry(cam) {
    const ctx = this.ctx
    const c = this.level.colors
    const w = this.viewW
    const h = this.viewH
    const items = [
      { x: w * 0.1, y: h * 0.2, r: 82, speed: 0.00022, kind: 'ring', depth: 0.03 },
      { x: w * 0.88, y: h * 0.56, r: 50, speed: -0.00035, kind: 'diamond', depth: 0.055 },
      { x: w * 0.46, y: h * 0.16, r: 25, speed: 0.0005, kind: 'diamond', depth: 0.03 },
      { x: w * 0.28, y: h * 0.52, r: 36, speed: -0.00028, kind: 'ring', depth: 0.045 }
    ]
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const item of items) {
      const x = ((item.x - cam * item.depth) % (w + 200) + w + 200) % (w + 200) - 100
      ctx.save()
      ctx.translate(x, item.y)
      ctx.rotate(this.time * item.speed + item.x)
      ctx.strokeStyle = rgba(c.tertiary, this.reducedMotion ? 0.1 : 0.16)
      ctx.lineWidth = 1
      if (item.kind === 'ring') {
        ctx.beginPath()
        ctx.arc(0, 0, item.r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = rgba(c.primary, 0.06)
        ctx.beginPath()
        ctx.arc(0, 0, item.r * 0.72, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(0, -item.r)
        ctx.lineTo(item.r * 0.74, 0)
        ctx.lineTo(0, item.r)
        ctx.lineTo(-item.r * 0.74, 0)
        ctx.closePath()
        ctx.stroke()
      }
      ctx.restore()
    }
    ctx.restore()
  }

  drawSkyline(layer, cam, parallax, color, c, time, alpha) {
    const ctx = this.ctx
    const w = this.viewW
    const span = layer.span
    const offset = ((cam * parallax) % span + span) % span
    ctx.save()
    ctx.globalAlpha = alpha
    for (let repeat = -1; repeat <= 2; repeat++) {
      for (const b of layer.buildings) {
        const x = b.x - offset + repeat * span
        if (x > w + 20 || x + b.w < -20) continue
        const y = GROUND - b.h
        ctx.fillStyle = color
        ctx.fillRect(x, y, b.w, b.h + 12)
        ctx.fillStyle = rgba(c.primary, 0.16)
        ctx.fillRect(x, y, b.w, 1.4)
        if (b.antenna) {
          ctx.strokeStyle = rgba(c.secondary, 0.2)
          ctx.beginPath()
          ctx.moveTo(x + b.w * 0.65, y)
          ctx.lineTo(x + b.w * 0.65, y - 18)
          ctx.stroke()
          ctx.fillStyle = rgba(c.secondary, 0.55)
          ctx.fillRect(x + b.w * 0.65 - 1, y - 19, 2, 2)
        }
        ctx.fillStyle = rgba(c.primary, 0.26)
        for (const win of b.windows) {
          if (this.reducedMotion || win.p < 0.5 || (win.p + time * 0.03) % 1 > 0.22) {
            ctx.fillRect(x + win.x, y + win.y, win.w, win.h)
          }
        }
      }
    }
    ctx.restore()
  }

  drawFloor(cam, pulse) {
    const ctx = this.ctx
    const c = this.level.colors
    const w = this.viewW
    const h = this.viewH
    ctx.fillStyle = this.floorGrad
    ctx.fillRect(0, GROUND, w, h - GROUND)
    ctx.fillStyle = this.floorGlow
    ctx.fillRect(0, GROUND - 2, w, 46)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = rgba(c.grid, 0.52)
    ctx.lineWidth = 1
    const offset = ((cam % 86) + 86) % 86
    for (let x = -offset; x < w + 86; x += 86) {
      ctx.beginPath()
      ctx.moveTo(x, GROUND)
      ctx.lineTo(x - 64, h)
      ctx.stroke()
    }
    for (let i = 0; i < 7; i++) {
      const y = GROUND + 18 + i * 28
      ctx.strokeStyle = rgba(c.grid, 0.25 - i * 0.022)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    const streakOffset = ((cam * 1.2) % 240 + 240) % 240
    for (let x = -streakOffset; x < w; x += 240) {
      ctx.fillStyle = rgba(c.primary, 0.08 + pulse * 0.03)
      ctx.beginPath()
      ctx.moveTo(x, GROUND + 12)
      ctx.lineTo(x + 105, GROUND + 12)
      ctx.lineTo(x + 62, GROUND + 23)
      ctx.lineTo(x - 43, GROUND + 23)
      ctx.closePath()
      ctx.fill()
    }

    ctx.strokeStyle = rgba(c.primary, 0.85)
    ctx.lineWidth = 2
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 18
    ctx.beginPath()
    ctx.moveTo(0, GROUND)
    ctx.lineTo(w, GROUND)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,.6)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(0, GROUND - 1.5)
    ctx.lineTo(w, GROUND - 1.5)
    ctx.stroke()
    ctx.restore()
  }

  drawWorldMarkers(cam) {
    const ctx = this.ctx
    for (const marker of this.level.markers || []) {
      if (marker.x < cam - 400 || marker.x > cam + this.viewW + 400) continue
      const dist = Math.abs(marker.x - (cam + this.anchorX))
      const alpha = clamp(1 - dist / 520, 0, 0.72)
      if (alpha <= 0) continue
      const c = this.level.colors
      ctx.save()
      ctx.globalAlpha = alpha * 0.65
      ctx.strokeStyle = rgba(c.primary, 0.55)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(marker.x, GROUND)
      ctx.lineTo(marker.x, GROUND - 265)
      ctx.stroke()
      ctx.fillStyle = rgba(c.primary, 0.9)
      ctx.fillRect(marker.x - 3, GROUND - 285, 6, 6)
      ctx.strokeRect(marker.x - 7, GROUND - 289, 14, 14)
      ctx.textAlign = 'left'
      ctx.font = '500 8px Orbitron, sans-serif'
      ctx.fillStyle = rgba(c.primary, 0.72)
      ctx.fillText(marker.sub || '', marker.x + 16, GROUND - 288)
      ctx.font = '700 11px Orbitron, sans-serif'
      ctx.fillStyle = 'rgba(240,252,255,.8)'
      ctx.fillText(marker.title || '', marker.x + 16, GROUND - 274)
      ctx.restore()
    }
  }

  drawObjects(cam) {
    const ctx = this.ctx
    const start = cam - 160
    const end = cam + this.viewW + 180
    const layer = (o) => {
      if (o.t === 'portal') return 1
      if (o.t === 'gem' || o.t === 'orb' || o.t === 'pad') return 3
      return 2
    }
    const objects = this.level.objects.filter((o) => o.t !== 'marker' && o.x > start && o.x < end).sort((a, b) => layer(a) - layer(b))
    for (const o of objects) {
      if (o.t === 'gem' && this.usedGems.has(o.id)) continue
      if (o.t === 'spike') this.drawSpike(o)
      else if (o.t === 'block') this.drawBlock(o)
      else if (o.t === 'saw') this.drawSaw(o)
      else if (o.t === 'pad') this.drawPad(o)
      else if (o.t === 'orb') this.drawOrb(o)
      else if (o.t === 'gem') this.drawGem(o)
      else if (o.t === 'portal') this.drawPortal(o)
    }
    if (this.usedPortals.size) {
      // Portals stay visible; the set only prevents repeat activation.
    }
    ctx.globalAlpha = 1
  }

  drawSpike(o) {
    const ctx = this.ctx
    const c = this.level.colors
    const grad = ctx.createLinearGradient(0, o.y + o.h, 0, o.y)
    grad.addColorStop(0, rgba(c.primary, 0.12))
    grad.addColorStop(0.5, rgba(c.primary, 0.42))
    grad.addColorStop(1, rgba(c.primary, 0.95))
    ctx.save()
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 15
    ctx.fillStyle = grad
    ctx.strokeStyle = rgba(c.primary, 0.95)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(o.x + 4, o.y + o.h)
    ctx.lineTo(o.x + o.w / 2, o.y + 1)
    ctx.lineTo(o.x + o.w - 4, o.y + o.h)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,.4)'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(o.x + o.w / 2, o.y + 7)
    ctx.lineTo(o.x + o.w / 2 + 7, o.y + o.h - 4)
    ctx.stroke()
    ctx.fillStyle = 'rgba(3,9,20,.58)'
    ctx.beginPath()
    ctx.moveTo(o.x + 12, o.y + o.h - 3)
    ctx.lineTo(o.x + o.w / 2, o.y + 16)
    ctx.lineTo(o.x + o.w - 12, o.y + o.h - 3)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  drawBlock(o) {
    const ctx = this.ctx
    const c = this.level.colors
    ctx.save()
    ctx.shadowColor = rgba(c.primary, 0.24)
    ctx.shadowBlur = 10
    const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h)
    grad.addColorStop(0, 'rgba(19,31,50,.98)')
    grad.addColorStop(0.5, 'rgba(7,14,26,.98)')
    grad.addColorStop(1, 'rgba(4,9,18,.99)')
    ctx.fillStyle = grad
    ctx.strokeStyle = rgba(c.primary, 0.42)
    ctx.lineWidth = 1.3
    cutRect(ctx, o.x, o.y, o.w, o.h, Math.min(10, o.w * 0.15))
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.strokeStyle = rgba(c.primary, 0.66)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(o.x + 5, o.y + 2)
    ctx.lineTo(o.x + o.w - 5, o.y + 2)
    ctx.stroke()
    ctx.strokeStyle = rgba(c.primary, 0.12)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(o.x + 7, o.y + 43)
    ctx.lineTo(o.x + o.w - 7, o.y + 43)
    ctx.stroke()
    for (let y = o.y + 43; y < o.y + o.h; y += 46) {
      ctx.beginPath()
      ctx.moveTo(o.x + 7, y)
      ctx.lineTo(o.x + o.w - 7, y)
      ctx.stroke()
    }
    ctx.fillStyle = rgba(c.primary, 0.35)
    for (const [bx, by] of [[10, 10], [o.w - 10, 10], [10, o.h - 10], [o.w - 10, o.h - 10]]) {
      if (o.w > 24 && o.h > 24) ctx.fillRect(o.x + bx - 1, o.y + by - 1, 2, 2)
    }
    ctx.strokeStyle = rgba(c.primary, 0.18)
    ctx.beginPath()
    ctx.moveTo(o.x + 14, o.y + o.h - 15)
    ctx.lineTo(o.x + (o.w * 0.45), o.y + 18)
    ctx.stroke()
    ctx.restore()
  }

  drawSaw(o) {
    const ctx = this.ctx
    const c = this.level.colors
    ctx.save()
    ctx.translate(o.x, o.y)
    ctx.rotate(this.time * (this.reducedMotion ? 1.2 : 4.6) + o.x * 0.01)
    ctx.shadowColor = c.secondary
    ctx.shadowBlur = 20
    ctx.fillStyle = 'rgba(8,9,20,.94)'
    ctx.strokeStyle = rgba(c.secondary, 0.92)
    ctx.lineWidth = 1.7
    ctx.beginPath()
    const teeth = 14
    for (let i = 0; i < teeth * 2; i++) {
      const angle = i / (teeth * 2) * Math.PI * 2
      const radius = i % 2 ? o.r * 0.7 : o.r
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = rgba(c.primary, 0.35)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(0, 0, o.r * 0.55, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 0, o.r * 0.28, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = c.primary
    ctx.beginPath()
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  drawPad(o) {
    const ctx = this.ctx
    const c = this.level.colors
    const pulse = 0.7 + Math.sin(this.time * 4.5 + o.x * 0.01) * 0.3
    ctx.save()
    ctx.translate(o.x, GROUND)
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 18 + pulse * 10
    ctx.fillStyle = rgba(c.primary, 0.22)
    ctx.beginPath()
    ctx.ellipse(0, -2, 34, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = rgba(c.primary, 0.9)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(0, -4, 27, 5.5, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = rgba(c.primary, 0.75 + pulse * 0.25)
    ctx.lineWidth = 2
    for (let i = 0; i < 2; i++) {
      ctx.beginPath()
      ctx.moveTo(-9, -14 - i * 8)
      ctx.lineTo(0, -21 - i * 8)
      ctx.lineTo(9, -14 - i * 8)
      ctx.stroke()
    }
    ctx.restore()
  }

  drawOrb(o) {
    const ctx = this.ctx
    const c = this.level.colors
    const pulse = 1 + Math.sin(this.time * 5 + o.x) * 0.08
    ctx.save()
    ctx.translate(o.x, o.y)
    ctx.scale(pulse, pulse)
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 25
    ctx.strokeStyle = rgba(c.primary, 0.9)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, o.r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = rgba(c.primary, 0.3)
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(0, 0, o.r - 3, this.time * 1.8, this.time * 1.8 + Math.PI * 1.25)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = rgba(c.primary, 0.12)
    ctx.beginPath()
    ctx.arc(0, 0, o.r - 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.save()
    ctx.rotate(Math.PI / 4)
    ctx.fillRect(-3.5, -3.5, 7, 7)
    ctx.restore()
    ctx.strokeStyle = rgba(c.primary, 0.45)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(-o.r - 7, 0)
    ctx.lineTo(-o.r + 1, 0)
    ctx.moveTo(o.r - 1, 0)
    ctx.lineTo(o.r + 7, 0)
    ctx.stroke()
    ctx.restore()
  }

  drawGem(o) {
    const ctx = this.ctx
    const c = this.level.colors
    ctx.save()
    ctx.translate(o.x, o.y + Math.sin(this.time * 2.6 + o.x) * 4)
    ctx.rotate(this.time * 1.25)
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 26
    const grad = ctx.createLinearGradient(0, -18, 0, 18)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.35, c.primary)
    grad.addColorStop(1, c.secondary)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(0, -18)
    ctx.lineTo(12, 0)
    ctx.lineTo(0, 18)
    ctx.lineTo(-12, 0)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(3,10,20,.55)'
    ctx.beginPath()
    ctx.moveTo(0, -9)
    ctx.lineTo(6, 0)
    ctx.lineTo(0, 9)
    ctx.lineTo(-6, 0)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,.65)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(-12, 0)
    ctx.lineTo(12, 0)
    ctx.moveTo(0, -18)
    ctx.lineTo(0, 18)
    ctx.stroke()
    ctx.restore()
    const px = o.x
    const py = o.y + Math.sin(this.time * 2.6 + o.x) * 4
    ctx.save()
    ctx.globalAlpha = 0.16 + Math.sin(this.time * 3) * 0.08
    ctx.strokeStyle = c.primary
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(px, py, 30, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  drawPortal(o) {
    const ctx = this.ctx
    const c = this.level.colors
    const color = o.kind === 'ship' ? c.secondary : c.primary
    const cx = o.x
    const cy = o.y + o.h / 2
    const rx = o.w / 2
    const ry = o.h / 2
    const pulse = 0.7 + Math.sin(this.time * 3 + o.x) * 0.3
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = 24
    ctx.strokeStyle = rgba(color, 0.25)
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = rgba(color, 0.95)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = rgba(color, 0.23 + pulse * 0.18)
    ctx.lineWidth = 1
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx - i * 6, ry - i * 8, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    const grad = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry)
    grad.addColorStop(0, rgba(color, 0.02))
    grad.addColorStop(0.5, rgba(color, 0.12))
    grad.addColorStop(1, rgba(color, 0.02))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx - 3, ry - 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '700 10px Orbitron, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = rgba(color, 0.92)
    ctx.fillText(o.kind === 'ship' ? 'SHIP' : 'CUBE', cx, cy + 3)
    ctx.font = '500 7px Chakra Petch, sans-serif'
    ctx.fillStyle = rgba(color, 0.52)
    ctx.fillText(o.kind === 'ship' ? 'HOLD' : 'JUMP', cx, cy + 15)
    ctx.restore()
  }

  drawFinish() {
    const ctx = this.ctx
    const c = this.level.colors
    const x = this.finishX
    const pulse = 0.68 + Math.sin(this.time * 4) * 0.32
    if (x < this.camX - 200 || x > this.camX + this.viewW + 300) return
    ctx.save()
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 30
    ctx.strokeStyle = rgba(c.primary, 0.25)
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.moveTo(x, GROUND)
    ctx.lineTo(x, 190)
    ctx.stroke()
    ctx.strokeStyle = rgba(c.primary, 0.9)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x, GROUND)
    ctx.lineTo(x, 190)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = rgba(c.primary, 0.35 + pulse * 0.2)
    ctx.lineWidth = 1
    for (let i = 0; i < 9; i++) {
      const y = 215 + i * 44
      ctx.beginPath()
      ctx.moveTo(x - 42, y)
      ctx.lineTo(x + 42, y)
      ctx.stroke()
    }
    ctx.fillStyle = rgba(c.primary, 0.08)
    ctx.fillRect(x - 60, 190, 120, GROUND - 190)
    ctx.fillStyle = '#07101d'
    ctx.fillRect(x - 68, 172, 136, 26)
    ctx.strokeStyle = rgba(c.primary, 0.55)
    ctx.strokeRect(x - 68, 172, 136, 26)
    ctx.font = '700 11px Orbitron, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#f5ffff'
    ctx.fillText('FINISH', x, 190)
    ctx.fillStyle = rgba(c.primary, 0.5)
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(x - 48 + i * 12, 552 + (i % 2) * 8, 10, 8)
    }
    ctx.fillStyle = c.primary
    ctx.font = '500 8px Orbitron, sans-serif'
    ctx.fillText('SIGNAL END', x, 610)
    ctx.restore()
  }

  drawTrail() {
    if (!this.trail.length) return
    const ctx = this.ctx
    const c = this.level.colors
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < this.trail.length; i++) {
      const point = this.trail[i]
      const alpha = clamp(point.life / point.max, 0, 1) * (i / this.trail.length) * 0.35
      if (point.mode === 'cube') {
        ctx.save()
        ctx.translate(point.x, point.y)
        ctx.rotate(point.rot)
        ctx.fillStyle = rgba(point.color, alpha)
        const s = 26 - (1 - i / this.trail.length) * 4
        ctx.fillRect(-s / 2, -s / 2, s, s)
        ctx.restore()
      }
    }
    ctx.lineCap = 'round'
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1]
      const b = this.trail[i]
      const alpha = clamp(b.life / b.max, 0, 1) * (i / this.trail.length) * 0.5
      ctx.strokeStyle = rgba(b.color, alpha)
      ctx.lineWidth = 2 + (i / this.trail.length) * 5
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  drawPlayer() {
    if (this.state === 'dead') return
    const ctx = this.ctx
    const p = this.player
    const c = this.level.colors
    const cx = p.x + p.w / 2
    const cy = p.y + p.h / 2

    if (p.mode === 'ship') {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(p.rotation)
      ctx.shadowColor = c.primary
      ctx.shadowBlur = 26
      const grad = ctx.createLinearGradient(-26, 0, 26, 0)
      grad.addColorStop(0, '#0a1d2b')
      grad.addColorStop(0.55, '#164154')
      grad.addColorStop(1, '#0a1827')
      ctx.fillStyle = grad
      ctx.strokeStyle = c.primary
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(28, 0)
      ctx.lineTo(-4, -17)
      ctx.lineTo(-19, -10)
      ctx.lineTo(-15, 0)
      ctx.lineTo(-19, 10)
      ctx.lineTo(-4, 17)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.fillStyle = c.primary
      ctx.beginPath()
      ctx.moveTo(12, 0)
      ctx.lineTo(-2, -5)
      ctx.lineTo(-2, 5)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = rgba(c.primary, 0.5)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(-17, 0)
      ctx.lineTo(-4, 0)
      ctx.stroke()
      ctx.restore()
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const flame = 16 + Math.sin(this.time * 32) * 7
      const fg = ctx.createLinearGradient(cx - 20, cy, cx - 20 - flame, cy)
      fg.addColorStop(0, rgba(c.primary, 0.85))
      fg.addColorStop(0.5, rgba(c.secondary, 0.5))
      fg.addColorStop(1, rgba(c.secondary, 0))
      ctx.fillStyle = fg
      ctx.beginPath()
      ctx.moveTo(cx - 18, cy - 6)
      ctx.lineTo(cx - 20 - flame, cy)
      ctx.lineTo(cx - 18, cy + 6)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      return
    }

    const s = p.w
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(2 - p.squash, p.squash)
    ctx.rotate(p.rotation)
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 44)
    halo.addColorStop(0, rgba(c.primary, 0.18))
    halo.addColorStop(1, rgba(c.primary, 0))
    ctx.fillStyle = halo
    ctx.fillRect(-48, -48, 96, 96)
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 24
    const body = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2)
    body.addColorStop(0, '#0d2238')
    body.addColorStop(0.5, '#071421')
    body.addColorStop(1, '#0b2032')
    ctx.fillStyle = body
    ctx.strokeStyle = c.primary
    ctx.lineWidth = 2.2
    cutRect(ctx, -s / 2, -s / 2, s, s, 8)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.strokeStyle = rgba(c.primary, 0.26)
    ctx.lineWidth = 1
    cutRect(ctx, -s / 2 + 5, -s / 2 + 5, s - 10, s - 10, 5)
    ctx.stroke()

    ctx.fillStyle = rgba(c.primary, 0.09)
    ctx.beginPath()
    ctx.moveTo(-s / 2 + 9, -s / 2)
    ctx.lineTo(-s / 2 + 18, -s / 2)
    ctx.lineTo(-s / 2, -s / 2 + 18)
    ctx.lineTo(-s / 2, -s / 2 + 9)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = c.primary
    const bolt = [
      [-5, -13], [5, -13], [0.5, -3], [7, -3], [-6, 13], [-1, 1], [-8, 1]
    ]
    ctx.shadowColor = c.primary
    ctx.shadowBlur = 11
    ctx.beginPath()
    bolt.forEach(([x, y], i) => { i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,.8)'
    ctx.fillRect(-11, -11, 2, 2)
    ctx.fillRect(9, 9, 2, 2)
    ctx.restore()

    if (p.onGround && this.state === 'playing') {
      ctx.save()
      ctx.globalAlpha = 0.25
      ctx.fillStyle = c.primary
      ctx.beginPath()
      ctx.ellipse(cx, GROUND + 2, 26, 4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  drawParticles() {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.particles) {
      const t = clamp(p.life / p.max, 0, 1)
      if (p.kind === 'ring') {
        const progress = 1 - t
        ctx.strokeStyle = rgba(p.color, t * 0.75)
        ctx.lineWidth = 2 + t * 4
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (0.25 + progress * 0.95), 0, Math.PI * 2)
        ctx.stroke()
      } else if (p.kind === 'confetti') {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = rgba(p.color, t)
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55)
        ctx.restore()
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = rgba(p.color, t)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.vx * 0.014, p.y - p.vy * 0.014)
        ctx.stroke()
      } else {
        ctx.fillStyle = rgba(p.color, t * 0.9)
        ctx.fillRect(p.x, p.y, p.size, p.size)
      }
    }
    ctx.restore()
  }

  drawHitboxes() {
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = 'rgba(255,70,100,.65)'
    ctx.lineWidth = 1
    for (const o of this.level.objects) {
      if (o.x < this.camX - 100 || o.x > this.camX + this.viewW + 100) continue
      if (o.t === 'spike') ctx.strokeRect(o.x + 10, o.y + 17, o.w - 20, o.h - 17)
      else if (o.t === 'block') ctx.strokeRect(o.x, o.y, o.w, o.h)
      else if (o.t === 'saw') {
        ctx.beginPath()
        ctx.arc(o.x, o.y, o.r * 0.84, 0, Math.PI * 2)
        ctx.stroke()
      } else if (o.t === 'orb') {
        ctx.beginPath()
        ctx.arc(o.x, o.y, 58, 0, Math.PI * 2)
        ctx.stroke()
      } else if (o.t === 'gem') {
        ctx.beginPath()
        ctx.arc(o.x, o.y, 36, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    const p = this.player
    ctx.strokeStyle = 'rgba(70,255,150,.7)'
    ctx.strokeRect(p.x + 4, p.y + 4, p.w - 8, p.h - 8)
    ctx.restore()
  }

  drawForeground() {
    const ctx = this.ctx
    const c = this.level.colors
    if (this.player.mode === 'ship' && !this.reducedMotion) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 7; i++) {
        const seed = Math.sin(this.time * 2.7 + i * 7.1) * 0.5 + 0.5
        const y = 120 + seed * 440
        const len = 40 + seed * 110
        ctx.strokeStyle = rgba(c.primary, 0.05 + seed * 0.08)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(len, y)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(this.viewW, y + 40)
        ctx.lineTo(this.viewW - len * 0.8, y + 40)
        ctx.stroke()
      }
      ctx.restore()
    }
    const beat = (this.levelTime * this.level.bpm / 60) % 1
    if (!this.reducedMotion && beat < 0.08) {
      const alpha = (1 - beat / 0.08) * 0.035
      ctx.fillStyle = rgba(c.primary, alpha)
      ctx.fillRect(0, 0, this.viewW, this.viewH)
    }
  }

  drawAmbientGeometry(cam) {
    const ctx = this.ctx
    const c = this.level.colors
    const w = this.viewW
    const h = this.viewH
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 4; i++) {
      const x = ((i * 430 - cam * 0.3) % (w + 500) + w + 500) % (w + 500) - 250
      const y = h * (0.32 + i * 0.08)
      const s = 20 + i * 12
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(this.time * 0.08 * (i % 2 ? 1 : -1))
      ctx.strokeStyle = rgba(i % 2 ? c.secondary : c.primary, 0.07)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, -s)
      ctx.lineTo(s, 0)
      ctx.lineTo(0, s)
      ctx.lineTo(-s, 0)
      ctx.closePath()
      ctx.stroke()
      ctx.restore()
    }
    ctx.restore()
  }
}

window.neonDash = new NeonDash()

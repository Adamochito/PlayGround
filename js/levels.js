export const GROUND = 620
export const BEAT = 200
export const PLAYER_SIZE = 42

let objectId = 0
const nextId = (prefix) => `${prefix}-${++objectId}`

const spike = (beat, elevation = 0, offset = 0) => ({
  id: nextId('spike'), t: 'spike', x: beat * BEAT + offset, y: GROUND - 46 - elevation,
  w: 44, h: 46, beat
})

const block = (beat, height, width = 120) => ({
  id: nextId('block'), t: 'block', x: beat * BEAT, y: GROUND - height,
  w: width, h: height, beat
})

const hanging = (beat, bottom, height = 170, width = 120) => ({
  id: nextId('block'), t: 'block', x: beat * BEAT, y: bottom - height,
  w: width, h: height, beat, hanging: true
})

const saw = (beat, elevation = 60, radius = 31) => ({
  id: nextId('saw'), t: 'saw', x: beat * BEAT, y: GROUND - elevation,
  r: radius, beat
})

const pad = (beat) => ({
  id: nextId('pad'), t: 'pad', x: beat * BEAT, y: GROUND,
  w: 64, h: 12, beat
})

const orb = (beat, elevation = 160) => ({
  id: nextId('orb'), t: 'orb', x: beat * BEAT, y: GROUND - elevation,
  r: 25, beat
})

const portal = (beat, kind) => ({
  id: nextId('portal'), t: 'portal', x: beat * BEAT, y: GROUND - 220,
  w: 58, h: 220, kind, beat
})

const gem = (beat, elevation = 130, offset = 0) => ({
  id: nextId('gem'), t: 'gem', x: beat * BEAT + offset, y: GROUND - elevation,
  r: 15, beat
})

const marker = (beat, title, sub) => ({ id: nextId('marker'), t: 'marker', x: beat * BEAT, title, sub })

const sp = (beat, elevation, offset) => spike(beat, elevation, offset)
const dbl = (beat, elevation = 0) => [spike(beat, elevation), spike(beat, elevation, 44)]
const triple = (beat, elevation = 0) => [spike(beat, elevation), spike(beat, elevation, 44), spike(beat, elevation, 88)]

export const levels = [
  {
    id: 'first-pulse',
    index: 0,
    name: 'FIRST PULSE',
    tag: 'SYNTHWAVE',
    difficulty: 'EASY',
    difficultyLevel: 1,
    stars: 2,
    bpm: 120,
    speed: 400,
    finishBeat: 107,
    tagline: 'Learn the frequency.',
    description: 'A clean signal through the neon district. The perfect place to find your hands.',
    lengthLabel: '0:53',
    shardCount: 3,
    colors: {
      bgTop: '#020615', bgMid: '#0a0c33', bgBottom: '#1b0b46',
      sun: '#39e7ff', sun2: '#9b55ff', haze: '#341679',
      skyline: '#080a27', skyline2: '#11123e',
      primary: '#4deaff', secondary: '#ff4ed8', tertiary: '#8a6bff',
      floor: '#05061a', floorGlow: '#45dfff', grid: '#31246d',
      text: '#effcff'
    },
    markers: [
      marker(1, 'IGNITION', 'SECTOR 01'),
      marker(50, 'SHIP ONLINE', 'HOLD TO THRUST'),
      marker(69, 'CUBE RESTORED', 'STAY ON BEAT'),
      marker(101, 'FINAL PUSH', 'NO SECOND CHANCES')
    ],
    objects: [
      marker(0.5, 'FIRST PULSE', 'NEON DISTRICT'),
      gem(4, 95),
      sp(7), sp(9.5),
      ...dbl(12),
      sp(15), sp(17),
      ...triple(19.5),
      block(22, 72, 180),
      gem(22.9, 165),
      sp(25), sp(27), sp(29),
      saw(31, 62),
      sp(33.5),
      pad(35),
      gem(35.6, 248),
      sp(37.2),
      sp(39.5),
      ...dbl(41.5),
      orb(44, 160),
      sp(44.8),
      sp(47),
      sp(49),
      portal(50, 'ship'),
      gem(57.7, 305),
      block(53, 150, 110),
      hanging(56, 360, 180, 110),
      block(59, 190, 110),
      hanging(62, 320, 160, 110),
      block(65, 160, 110),
      portal(68, 'cube'),
      sp(71), ...dbl(73.5), sp(76),
      saw(78.5, 68),
      sp(80.5), ...triple(82.5), ...dbl(85.5),
      pad(88), sp(90.3),
      sp(92), ...dbl(94.5), ...triple(97.5),
      ...dbl(100.5), sp(103)
    ]
  },
  {
    id: 'solar-flare',
    index: 1,
    name: 'SOLAR FLARE',
    tag: 'OVERDRIVE',
    difficulty: 'HARD',
    difficultyLevel: 2,
    stars: 5,
    bpm: 132,
    speed: 440,
    finishBeat: 114,
    tagline: 'Burn the timeline.',
    description: 'A collapsing star, a tightening corridor, and no room for hesitation.',
    lengthLabel: '0:52',
    shardCount: 3,
    colors: {
      bgTop: '#12030b', bgMid: '#3a091f', bgBottom: '#5c1027',
      sun: '#ffb347', sun2: '#ff3f75', haze: '#7b1832',
      skyline: '#16040e', skyline2: '#290817',
      primary: '#ffb347', secondary: '#ff3f75', tertiary: '#ff7438',
      floor: '#100208', floorGlow: '#ff9a3d', grid: '#5e2037',
      text: '#fff6ed'
    },
    markers: [
      marker(1, 'SOLAR FLARE', 'SECTOR 02'),
      marker(50, 'SHIP ONLINE', 'TIGHTEN UP'),
      marker(68, 'CUBE RESTORED', 'BURN IT DOWN'),
      marker(106, 'REDLINE', 'DO NOT BLINK')
    ],
    objects: [
      marker(0.5, 'SOLAR FLARE', 'OVERDRIVE'),
      gem(3.4, 105),
      sp(6), ...dbl(8), sp(10), sp(12),
      ...triple(14),
      block(17, 92, 160),
      gem(17.8, 185),
      saw(20, 74),
      sp(22), ...dbl(24),
      pad(26), sp(29.3),
      orb(30.5, 175), sp(31.2),
      ...triple(33),
      block(35.5, 120, 140),
      gem(36.3, 210),
      sp(38.2),
      saw(40.2, 126),
      ...dbl(42), sp(44),
      orb(46, 170), sp(46.7),
      portal(50, 'ship'),
      gem(60.9, 300),
      block(53, 170, 110),
      hanging(55.5, 315, 180, 110),
      block(58, 210, 110),
      hanging(60.5, 300, 160, 110),
      block(63, 150, 110),
      hanging(65.5, 340, 170, 110),
      portal(68, 'cube'),
      ...triple(72), ...dbl(75),
      saw(78.5, 70), sp(80.5), ...dbl(82.5),
      block(85, 78, 150),
      ...triple(88),
      pad(90.5), sp(93.2),
      ...dbl(94.5), sp(97), ...triple(100),
      ...dbl(103), sp(106)
    ]
  },
  {
    id: 'void-signal',
    index: 2,
    name: 'VOID SIGNAL',
    tag: 'SINGULARITY',
    difficulty: 'INSANE',
    difficultyLevel: 3,
    stars: 9,
    bpm: 144,
    speed: 480,
    finishBeat: 118,
    tagline: 'Dance at the event horizon.',
    description: 'The final transmission. Faster, meaner, and beautiful enough to hurt.',
    lengthLabel: '0:49',
    shardCount: 3,
    colors: {
      bgTop: '#01070a', bgMid: '#071a25', bgBottom: '#11113d',
      sun: '#9dff4d', sun2: '#7550ff', haze: '#153b3d',
      skyline: '#030b10', skyline2: '#08151f',
      primary: '#b6ff4d', secondary: '#a56dff', tertiary: '#3dffd3',
      floor: '#02070a', floorGlow: '#9dff4d', grid: '#21484b',
      text: '#f3fff6'
    },
    markers: [
      marker(1, 'VOID SIGNAL', 'SECTOR 03'),
      marker(41, 'SHIP ONLINE', 'HOLD THE LINE'),
      marker(66, 'CUBE RESTORED', 'BREAK THE VOID'),
      marker(111, 'EVENT HORIZON', 'LAST CHANCE')
    ],
    objects: [
      marker(0.5, 'VOID SIGNAL', 'SINGULARITY'),
      gem(3, 105),
      sp(5), ...dbl(7), sp(9), ...triple(11),
      sp(13), ...dbl(15),
      pad(17), sp(18.2),
      gem(19.1, 260),
      sp(21),
      saw(23.2, 58),
      ...triple(24), ...dbl(26.5), sp(28),
      orb(29.5, 180), sp(30.2),
      ...triple(32),
      block(34.2, 104, 150),
      gem(35, 190),
      sp(36.5), ...dbl(38),
      saw(39.5, 78),
      portal(41, 'ship'),
      gem(53.5, 300),
      block(43.5, 180, 110),
      hanging(45, 300, 160, 110),
      block(46.5, 220, 110),
      hanging(48, 280, 160, 110),
      block(49.5, 130, 110),
      hanging(51, 340, 180, 110),
      block(52.5, 200, 110),
      hanging(54, 320, 160, 110),
      block(55.5, 160, 110),
      hanging(57, 360, 180, 110),
      block(59, 190, 110),
      hanging(61, 330, 170, 110),
      block(63, 150, 110),
      portal(66, 'cube'),
      ...triple(68), ...dbl(70),
      saw(72, 70), sp(74), ...dbl(76),
      pad(78),
      ...triple(80.7), ...dbl(82.5),
      orb(84.5, 170), sp(85.3),
      block(87.5, 88, 150),
      ...dbl(90),
      saw(92, 68),
      ...triple(94), ...dbl(97), ...triple(100),
      pad(103),
      ...dbl(107), ...triple(109),
      sp(112)
    ]
  }
]

export const totalShards = levels.reduce((sum, level) => sum + level.shardCount, 0)

export function levelLength(level) {
  return level.finishBeat * BEAT
}

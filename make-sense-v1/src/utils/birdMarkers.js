/**
 * Compact flock glyphs inspired by murmuration / boids demos:
 * tiny chevrons + short folding wings (not long plane-like strokes).
 *
 * Local space: +x = forward (heading), ±y = wing span.
 * Visual abstraction — not anatomically exact.
 */

/** @type {Record<string, { shape: string, size: number, flapHz: number }>} */
export const MARKER_BY_SPECIES = {
  // Size contrast kept; wings stay short on every species.
  'barn-swallow': { shape: 'swallow', size: 8.4, flapHz: 2.1 },
  'european-bee-eater': { shape: 'bee-eater', size: 7.4, flapHz: 1.85 },
  'common-crane': { shape: 'crane', size: 12, flapHz: 1.05 },
  'eurasian-blackcap': { shape: 'blackcap', size: 5.6, flapHz: 2.35 },
  'blackpoll-warbler': { shape: 'warbler', size: 4.8, flapHz: 2.5 },
}

export function markerForSpecies(speciesId) {
  return (
    MARKER_BY_SPECIES[speciesId] ?? {
      shape: 'swallow',
      size: 6,
      flapHz: 1.2,
    }
  )
}

/**
 * Screen-space heading (radians) from trail, else formation direction, else default.
 * Matches canvas rotate(): 0 = east (+x).
 */
export function headingFromTrail(map, bird) {
  const trail = bird.trail
  if (map && trail && trail.length >= 2) {
    const a = trail[Math.max(0, trail.length - 5)]
    const b = trail[trail.length - 1]
    const pa = map.project([a.lng, a.lat])
    const pb = map.project([b.lng, b.lat])
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    if (dx * dx + dy * dy >= 0.35) return Math.atan2(dy, dx)
  }

  if (
    map &&
    Number.isFinite(bird.formationDirLng) &&
    Number.isFinite(bird.formationDirLat) &&
    Number.isFinite(bird.lng) &&
    Number.isFinite(bird.lat)
  ) {
    const pa = map.project([bird.lng, bird.lat])
    const pb = map.project([
      bird.lng + bird.formationDirLng * 0.35,
      bird.lat + bird.formationDirLat * 0.35,
    ])
    return Math.atan2(pb.y - pa.y, pb.x - pa.x)
  }

  return bird.heading ?? -Math.PI / 2
}

/**
 * Draw one bird marker at (x, y), rotated by heading.
 * Uses short chevron / wedge wings (murmuration particle style).
 */
export function drawBirdMarker(ctx, x, y, opts) {
  const {
    color = '#e10600',
    shape = 'swallow',
    size = 6,
    heading = -Math.PI / 2,
    phase = 0,
  } = opts

  const flap = Math.sin(phase)
  // Large angle swing, short wing length — reads as a flap, not a jet.
  const bob = Math.sin(phase * 0.5) * size * 0.08

  ctx.save()
  ctx.translate(x, y + bob)
  ctx.rotate(heading)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (shape) {
    case 'crane':
      drawCrane(ctx, size, flap)
      break
    case 'bee-eater':
      drawBeeEater(ctx, size, flap)
      break
    case 'blackcap':
      drawBlackcap(ctx, size, flap)
      break
    case 'warbler':
      drawWarbler(ctx, size, flap)
      break
    case 'swallow':
    default:
      drawSwallow(ctx, size, flap)
      break
  }

  ctx.restore()
}

/**
 * Short filled wings that sweep open and closed.
 * `flap` is -1..1. Wing length stays compact; the angle change is what reads as flapping.
 */
function drawFlappingBird(ctx, s, flap, {
  wingScale = 0.62,
  nose = 0.38,
  fork = 0,
} = {}) {
  const wingLen = s * wingScale
  // Folded (~0.28 rad, swept back) → raised (~1.25 rad).
  const open = 0.28 + (flap * 0.5 + 0.5) * 0.97

  for (const side of [-1, 1]) {
    ctx.save()
    // Same short wing, mirrored by rotation so the stroke opens and closes.
    ctx.rotate(side * open)
    ctx.beginPath()
    ctx.moveTo(s * 0.08, 0)
    ctx.quadraticCurveTo(-wingLen * 0.35, -wingLen * 0.22, -wingLen, -wingLen * 0.06)
    ctx.quadraticCurveTo(-wingLen * 0.45, wingLen * 0.08, -s * 0.02, 0)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  ctx.beginPath()
  ctx.moveTo(s * nose, 0)
  ctx.lineTo(-s * 0.22, s * 0.16)
  ctx.lineTo(-s * 0.22, -s * 0.16)
  ctx.closePath()
  ctx.fill()

  if (fork > 0) {
    ctx.lineWidth = Math.max(1, s * 0.12)
    ctx.beginPath()
    ctx.moveTo(-s * 0.16, -s * 0.04)
    ctx.lineTo(-s * (0.38 + fork), -s * (0.16 + fork * 0.2))
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-s * 0.16, s * 0.04)
    ctx.lineTo(-s * (0.38 + fork), s * (0.16 + fork * 0.2))
    ctx.stroke()
  }
}

/** Forked tail — Barn Swallow. */
function drawSwallow(ctx, s, flap) {
  drawFlappingBird(ctx, s, flap, { wingScale: 0.64, nose: 0.4, fork: 0.22 })
}

/** Slightly longer body — Bee-eater. */
function drawBeeEater(ctx, s, flap) {
  drawFlappingBird(ctx, s, flap, { wingScale: 0.6, nose: 0.46, fork: 0 })
  ctx.lineWidth = Math.max(1, s * 0.12)
  ctx.beginPath()
  ctx.moveTo(-s * 0.2, 0)
  ctx.lineTo(-s * 0.48, 0)
  ctx.stroke()
}

/** Larger, slower wings + short neck — Common Crane. */
function drawCrane(ctx, s, flap) {
  drawFlappingBird(ctx, s, flap, { wingScale: 0.7, nose: 0.48, fork: 0 })
  ctx.lineWidth = Math.max(1.1, s * 0.12)
  ctx.beginPath()
  ctx.moveTo(s * 0.32, 0)
  ctx.lineTo(s * 0.58, -s * 0.05)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(s * 0.62, -s * 0.05, Math.max(1, s * 0.07), 0, Math.PI * 2)
  ctx.fill()
}

/** Compact — Eurasian Blackcap. */
function drawBlackcap(ctx, s, flap) {
  drawFlappingBird(ctx, s, flap, { wingScale: 0.58, nose: 0.34, fork: 0 })
}

/** Smallest — Blackpoll Warbler. */
function drawWarbler(ctx, s, flap) {
  drawFlappingBird(ctx, s, flap, { wingScale: 0.55, nose: 0.32, fork: 0 })
}

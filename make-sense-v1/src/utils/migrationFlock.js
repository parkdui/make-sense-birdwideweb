import { FLOCK } from '../config.js'

/**
 * Flock visualization:
 * - Dot count scales with GBIF monthly occurrence (minDots…maxDots)
 * - Positions come from that month's local sample (with jitter if needed)
 *
 * Visual abstraction — not tracked individuals or migration routes.
 */

function monthPositions(yearRecords, month) {
  return yearRecords
    .filter((r) => r.month === month)
    .map((r) => ({
      lng: r.decimalLongitude,
      lat: r.decimalLatitude,
      gbifID: r.gbifID,
    }))
    .sort((a, b) => a.lat - b.lat)
}

function expandPositions(pool, flockSize) {
  if (!pool.length || flockSize <= 0) return []
  const out = []
  for (let i = 0; i < flockSize; i += 1) {
    const src = pool[i % pool.length]
    const copyIndex = Math.floor(i / pool.length)
    const jitter = copyIndex === 0 ? 0 : 0.35 + copyIndex * 0.15
    const angle = (i * 2.399) % (Math.PI * 2)
    out.push({
      lng: src.lng + Math.cos(angle) * jitter,
      lat: src.lat + Math.sin(angle) * jitter,
      gbifID: src.gbifID,
    })
  }
  return out
}

/**
 * Common cranes travel as one or more V skeins.
 * The point of the V faces the direction of flight. Spacing is in degrees
 * so the chevron still reads on the overview map.
 */
function vMetrics(flockSize) {
  // One skein, like a real crane flock. Extra dots would fill the V into a wedge.
  const count = Math.max(3, Math.min(flockSize, 11))
  return { birdsPerV: count, backStep: 2.15, sideStep: 1.7 }
}

export function formationDirection(from, to, fallback = { dirLng: 0, dirLat: 1 }) {
  if (!from || !to) return fallback
  const dirLng = to.lng - from.lng
  const dirLat = to.lat - from.lat
  const len = Math.hypot(dirLng, dirLat)
  if (len < 0.05) return fallback
  return { dirLng: dirLng / len, dirLat: dirLat / len }
}

/** Shortest-turn blend so a skein rotates onto its new course without spinning the long way. */
export function lerpFormationDirection(from, to, t) {
  const aAng = Math.atan2(from.dirLng, from.dirLat)
  const bAng = Math.atan2(to.dirLng, to.dirLat)
  let delta = bAng - aAng
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  const ang = aAng + delta * t
  return { dirLng: Math.sin(ang), dirLat: Math.cos(ang) }
}

export function monthAnchor(yearRecords, month) {
  const pool = monthPositions(yearRecords, month)
  if (!pool.length) return null
  return pool[Math.floor((pool.length - 1) / 2)]
}

export function layoutVFormation(tip, dir, flockSize, gbifID) {
  const { birdsPerV, backStep, sideStep } = vMetrics(flockSize)
  const count = Math.min(flockSize, birdsPerV)
  const perpLng = -dir.dirLat
  const perpLat = dir.dirLng
  const out = []
  for (let k = 0; k < count; k += 1) {
    const wing = k === 0 ? 0 : k % 2 === 1 ? -1 : 1
    const rank = k === 0 ? 0 : Math.ceil(k / 2)
    const back = rank * backStep
    const side = wing * rank * sideStep
    out.push({
      lng: tip.lng - dir.dirLng * back + perpLng * side,
      lat: tip.lat - dir.dirLat * back + perpLat * side,
      gbifID,
      formationDirLng: dir.dirLng,
      formationDirLat: dir.dirLat,
    })
  }
  return out
}

function expandAsVFormation(pool, flockSize, direction) {
  if (!pool.length || flockSize <= 0) return []
  const tip = pool[Math.floor((pool.length - 1) / 2)]
  const dir =
    direction ??
    formationDirection(pool[0], pool[pool.length - 1], { dirLng: 0, dirLat: 1 })
  return layoutVFormation(tip, dir, flockSize, tip.gbifID)
}

function expandForFormation(pool, flockSize, formation, direction) {
  if (formation === 'v') return expandAsVFormation(pool, flockSize, direction)
  return expandPositions(pool, flockSize)
}

/**
 * Map a raw GBIF monthly occurrence count → visible dot count [minDots, maxDots].
 * Uses a shared log scale so species and seasons stay comparable.
 */
export function dotsFromOccurrenceCount(count) {
  const { minDots, maxDots, occurrenceCountFloor, occurrenceCountCeil } = FLOCK
  if (!Number.isFinite(count) || count <= 0) return minDots

  const lo = Math.log10(occurrenceCountFloor)
  const hi = Math.log10(occurrenceCountCeil)
  const clamped = Math.min(
    occurrenceCountCeil,
    Math.max(occurrenceCountFloor, count),
  )
  const t = (Math.log10(clamped) - lo) / (hi - lo)
  return Math.round(minDots + t * (maxDots - minDots))
}

/** Look up GBIF year×month count from dataset meta (if present). */
export function gbifMonthCount(meta, year, month) {
  const row = meta?.gbifYearMonthCounts?.[String(year)]
  if (!row) return null
  const n = row[String(month)] ?? row[month]
  return Number.isFinite(n) ? n : null
}

/** @deprecated Prefer dotsFromOccurrenceCount */
export function desiredFlockSize(januaryCount) {
  if (januaryCount <= 0) return 0
  if (januaryCount < FLOCK.minJanuaryForNoBoost) return januaryCount * 2
  return januaryCount
}

/** @param {Array} yearRecords */
export function getJanuaryPositions(yearRecords) {
  return monthPositions(yearRecords, 1)
}

/**
 * Build a flock of the requested size from a month's occurrence sample.
 * @param {{ formation?: 'scatter' | 'v' }} [options]
 */
export function buildFlock(yearRecords, month, flockSize, options = {}) {
  const formation = options.formation ?? 'scatter'
  const pool = monthPositions(yearRecords, month)
  if (!pool.length) {
    // Fall back to any month in the year so the map is never empty.
    const any = yearRecords
      .map((r) => ({
        lng: r.decimalLongitude,
        lat: r.decimalLatitude,
        gbifID: r.gbifID,
      }))
      .sort((a, b) => a.lat - b.lat)
    if (!any.length) return []
    return expandForFormation(any, flockSize, formation).map((p, i) => ({
      id: `bird-${i}`,
      ...p,
      trail: [],
    }))
  }

  return expandForFormation(pool, flockSize, formation).map((p, i) => ({
    id: `bird-${i}`,
    ...p,
    trail: [],
  }))
}

/** @deprecated Prefer buildFlock(yearRecords, 1, size) */
export function buildFlockFromJanuary(yearRecords) {
  const base = getJanuaryPositions(yearRecords)
  return buildFlock(yearRecords, 1, desiredFlockSize(base.length))
}

/**
 * Grow/shrink an existing flock toward a new size, keeping current positions
 * when possible so month transitions stay continuous.
 */
export function resizeFlock(birds, yearRecords, month, flockSize) {
  if (flockSize <= 0) return []
  if (!birds?.length) return buildFlock(yearRecords, month, flockSize)

  if (birds.length === flockSize) return birds

  if (birds.length > flockSize) {
    return birds.slice(0, flockSize)
  }

  const extras = buildFlock(yearRecords, month, flockSize - birds.length)
  const next = birds.slice()
  for (let i = 0; i < extras.length; i += 1) {
    const donor = birds[i % birds.length]
    next.push({
      ...extras[i],
      id: `bird-${birds.length + i}`,
      lng: donor.lng,
      lat: donor.lat,
      trail: [{ lng: donor.lng, lat: donor.lat }],
    })
  }
  return next
}

/**
 * Pick N target positions from a month's records.
 * Sorted by latitude so flock motion stays coherent.
 * @param {{ formation?: 'scatter' | 'v' }} [options]
 */
export function getMonthTargets(yearRecords, month, flockSize, options = {}) {
  const pool = monthPositions(yearRecords, month)
  if (!pool.length || flockSize <= 0) return null
  return expandForFormation(
    pool,
    flockSize,
    options.formation ?? 'scatter',
    options.direction,
  )
}

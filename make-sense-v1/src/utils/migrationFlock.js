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
 * Arrange birds into one or more V formations (Common Crane style).
 * Tip points roughly south / SSW; arms trail behind.
 * Offsets are in degrees so the V reads at continental zoom.
 */
function expandAsVFormation(pool, flockSize) {
  if (!pool.length || flockSize <= 0) return []

  const birdsPerV =
    flockSize <= 7
      ? flockSize
      : Math.min(11, Math.max(7, Math.round(flockSize / Math.ceil(flockSize / 9))))
  const numFlocks = Math.ceil(flockSize / birdsPerV)
  const out = []

  for (let f = 0; f < numFlocks; f += 1) {
    const lead = pool[Math.floor((f / numFlocks) * pool.length) % pool.length]
    const count = Math.min(birdsPerV, flockSize - out.length)
    // Bearing from north (rad): π = south; slight SSW/SSE variety per sub-flock.
    const bearing = Math.PI + (f % 2 === 0 ? -0.28 : 0.28)
    const dirLng = Math.sin(bearing)
    const dirLat = Math.cos(bearing)
    const perpLng = -dirLat
    const perpLat = dirLng
    const backStep = 0.52
    const sideStep = 0.4

    for (let k = 0; k < count; k += 1) {
      let dlng = 0
      let dlat = 0
      if (k > 0) {
        const wing = k % 2 === 1 ? -1 : 1
        const rank = Math.ceil(k / 2)
        const back = rank * backStep
        const side = rank * sideStep
        // Behind the tip = opposite of travel direction
        dlng = -dirLng * back + perpLng * wing * side
        dlat = -dirLat * back + perpLat * wing * side
      }
      out.push({
        lng: lead.lng + dlng,
        lat: lead.lat + dlat,
        gbifID: lead.gbifID,
        formationDirLng: dirLng,
        formationDirLat: dirLat,
      })
    }
  }

  return out
}

function expandForFormation(pool, flockSize, formation) {
  if (formation === 'v') return expandAsVFormation(pool, flockSize)
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
  return expandForFormation(pool, flockSize, options.formation ?? 'scatter')
}

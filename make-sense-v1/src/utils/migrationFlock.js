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
 */
export function buildFlock(yearRecords, month, flockSize) {
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
    return expandPositions(any, flockSize).map((p, i) => ({
      id: `bird-${i}`,
      ...p,
      trail: [],
    }))
  }

  return expandPositions(pool, flockSize).map((p, i) => ({
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
 */
export function getMonthTargets(yearRecords, month, flockSize) {
  const pool = monthPositions(yearRecords, month)
  if (!pool.length || flockSize <= 0) return null
  return expandPositions(pool, flockSize)
}

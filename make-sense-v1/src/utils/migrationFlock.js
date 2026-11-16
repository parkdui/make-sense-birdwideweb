import { FLOCK } from '../config.js'

/**
 * Build a simple flock visualization:
 * - Dot count = January records × sizeMultiplier
 * - Each month, dots move toward that month's occurrence positions
 *
 * This is a visual abstraction, not tracked individual birds.
 */

/** @param {Array} yearRecords */
export function getJanuaryPositions(yearRecords) {
  return yearRecords
    .filter((r) => r.month === 1)
    .map((r) => ({
      lng: r.decimalLongitude,
      lat: r.decimalLatitude,
      gbifID: r.gbifID,
    }))
    .sort((a, b) => a.lat - b.lat)
}

export function desiredFlockSize(januaryCount) {
  if (januaryCount <= 0) return 0
  if (januaryCount < FLOCK.minJanuaryForNoBoost) return januaryCount * 2
  return januaryCount
}

/**
 * Expand January positions to the desired flock size.
 * Extra birds get a tiny geographic jitter so they are not perfectly stacked.
 */
export function buildFlockFromJanuary(yearRecords) {
  const base = getJanuaryPositions(yearRecords)
  if (base.length === 0) return []

  const targetSize = desiredFlockSize(base.length)
  const flock = []

  for (let i = 0; i < targetSize; i += 1) {
    const src = base[i % base.length]
    const copyIndex = Math.floor(i / base.length)
    // Small spread for duplicated birds (degrees).
    const jitter = copyIndex === 0 ? 0 : 0.35 + copyIndex * 0.15
    const angle = (i * 2.399) % (Math.PI * 2)
    flock.push({
      id: `bird-${i}`,
      lng: src.lng + Math.cos(angle) * jitter,
      lat: src.lat + Math.sin(angle) * jitter,
      gbifID: src.gbifID,
      trail: [],
    })
  }

  return flock
}

/**
 * Pick N target positions from a month's records.
 * Sorted by latitude so flock motion stays coherent.
 */
export function getMonthTargets(yearRecords, month, flockSize) {
  const pool = yearRecords
    .filter((r) => r.month === month)
    .map((r) => ({
      lng: r.decimalLongitude,
      lat: r.decimalLatitude,
      gbifID: r.gbifID,
    }))
    .sort((a, b) => a.lat - b.lat)

  if (pool.length === 0 || flockSize <= 0) return null

  const targets = []
  for (let i = 0; i < flockSize; i += 1) {
    const src = pool[i % pool.length]
    const copyIndex = Math.floor(i / pool.length)
    const jitter = copyIndex === 0 ? 0 : 0.35 + copyIndex * 0.15
    const angle = (i * 2.399) % (Math.PI * 2)
    targets.push({
      lng: src.lng + Math.cos(angle) * jitter,
      lat: src.lat + Math.sin(angle) * jitter,
      gbifID: src.gbifID,
    })
  }
  return targets
}

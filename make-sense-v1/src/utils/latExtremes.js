/**
 * Northernmost / southernmost occurrence latitudes for a year×month sample.
 * Based on local occurrence points only — not a migration route.
 */

/**
 * @param {Array<{ month?: number, decimalLatitude?: number, decimalLongitude?: number }>} yearRecords
 * @param {number} month 1–12
 * @returns {{ northLat: number, southLat: number, northLng: number, southLng: number } | null}
 */
export function getMonthLatExtremes(yearRecords, month) {
  const pool = (yearRecords ?? []).filter(
    (r) =>
      r.month === month &&
      Number.isFinite(r.decimalLatitude) &&
      Number.isFinite(r.decimalLongitude),
  )
  if (!pool.length) return null

  let north = pool[0]
  let south = pool[0]
  for (let i = 1; i < pool.length; i += 1) {
    const r = pool[i]
    if (r.decimalLatitude > north.decimalLatitude) north = r
    if (r.decimalLatitude < south.decimalLatitude) south = r
  }

  return {
    northLat: north.decimalLatitude,
    southLat: south.decimalLatitude,
    northLng: north.decimalLongitude,
    southLng: south.decimalLongitude,
  }
}

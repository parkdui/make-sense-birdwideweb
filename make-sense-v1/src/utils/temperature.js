/** Decode and sample local GISTEMP series + HadCRUT5 map grid. */

const MONTH_KEY = (year, month) =>
  `${year}-${String(month).padStart(2, '0')}`

/**
 * White → yellow → red for cooler → warmer anomalies.
 * Fixed scale keeps month-to-month motion readable.
 */
export function anomalyToRgba(anomaly, { vmin = -1.2, vmax = 2.4, alpha = 0.55 } = {}) {
  if (!Number.isFinite(anomaly)) return [0, 0, 0, 0]

  const t = Math.min(1, Math.max(0, (anomaly - vmin) / (vmax - vmin)))
  let r
  let g
  let b
  if (t < 0.5) {
    const u = t / 0.5
    r = 255
    g = 255
    b = Math.round(255 * (1 - u))
  } else {
    const u = (t - 0.5) / 0.5
    r = 255
    g = Math.round(255 * (1 - u))
    b = 0
  }
  return [r, g, b, Math.round(alpha * 255)]
}

/** Precompute RGBA LUT for scaled Int16 anomalies (value = °C / scale). */
function buildColorLut({ scale, vmin, vmax, alpha }) {
  const a = Math.round(alpha * 255)
  // Cover ±5°C at scale 0.01 → ±500
  const span = 500
  const lut = new Uint8ClampedArray((span * 2 + 1) * 4)
  for (let i = -span; i <= span; i += 1) {
    const [r, g, b] = anomalyToRgba(i * scale, { vmin, vmax, alpha: 1 })
    const o = (i + span) * 4
    lut[o] = r
    lut[o + 1] = g
    lut[o + 2] = b
    lut[o + 3] = a
  }
  return { lut, span }
}

const lutCache = new Map()

function getLut(key, opts) {
  let hit = lutCache.get(key)
  if (!hit) {
    hit = buildColorLut(opts)
    lutCache.set(key, hit)
  }
  return hit
}

export function decodeTemperaturePayload(payload) {
  const grid = payload?.grid
  if (!grid?.data || !grid.keys?.length) {
    throw new Error('Temperature grid missing')
  }

  const binary = atob(grid.data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const values = new Int16Array(bytes.buffer)

  const { nLat, nLon, scale, missing } = grid
  const cells = nLat * nLon
  const indexByKey = new Map(grid.keys.map((k, i) => [k, i]))

  return {
    meta: payload.meta,
    series: payload.series ?? {},
    gridMeta: {
      nLat,
      nLon,
      latMin: grid.latMin,
      latMax: grid.latMax,
      lonMin: grid.lonMin,
      lonMax: grid.lonMax,
      scale,
      missing,
      keys: grid.keys,
    },
    getSeriesAnomaly(year, month) {
      const v = payload.series?.[MONTH_KEY(year, month)]
      return Number.isFinite(v) ? v : null
    },
    getGridSlice(year, month) {
      const idx = indexByKey.get(MONTH_KEY(year, month))
      if (idx == null) return null
      return values.subarray(idx * cells, idx * cells + cells)
    },
  }
}

/**
 * Paint one month into an ImageData (north-up).
 * Upsample with nearest-neighbor for smoother map coverage.
 */
export function paintTemperatureImage(
  slice,
  gridMeta,
  {
    upsample = 4,
    vmin = -1.2,
    vmax = 2.4,
    alpha = 0.55,
  } = {},
) {
  const { nLat, nLon, scale, missing } = gridMeta
  const w = nLon * upsample
  const h = nLat * upsample
  const image = new ImageData(w, h)
  const { data } = image
  const lutKey = `${scale}|${vmin}|${vmax}|${alpha}`
  const { lut, span } = getLut(lutKey, { scale, vmin, vmax, alpha })

  for (let srcRow = 0; srcRow < nLat; srcRow += 1) {
    const y0 = (nLat - 1 - srcRow) * upsample
    for (let srcCol = 0; srcCol < nLon; srcCol += 1) {
      const raw = slice[srcRow * nLon + srcCol]
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      if (raw !== missing) {
        const idx = Math.min(span, Math.max(-span, raw)) + span
        const o = idx * 4
        r = lut[o]
        g = lut[o + 1]
        b = lut[o + 2]
        a = lut[o + 3]
      }
      const x0 = srcCol * upsample
      for (let dy = 0; dy < upsample; dy += 1) {
        let i = ((y0 + dy) * w + x0) * 4
        for (let dx = 0; dx < upsample; dx += 1) {
          data[i] = r
          data[i + 1] = g
          data[i + 2] = b
          data[i + 3] = a
          i += 4
        }
      }
    }
  }

  return image
}

/** Web Mercator cannot place ±90° — clamp or the image warp collapses. */
const MERCATOR_MAX_LAT = 85

export function gridCoordinates(gridMeta) {
  const { lonMin, lonMax, latMin, latMax } = gridMeta
  const north = Math.min(MERCATOR_MAX_LAT, latMax)
  const south = Math.max(-MERCATOR_MAX_LAT, latMin)
  return [
    [lonMin, north],
    [lonMax, north],
    [lonMax, south],
    [lonMin, south],
  ]
}

export { MONTH_KEY }

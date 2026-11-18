import { TEMPERATURE } from '../config.js'

/** Decode and sample local GISTEMP series + NCEP map grid. */

const MONTH_KEY = (year, month) =>
  `${year}-${String(month).padStart(2, '0')}`

/** Web Mercator cannot place ±90° — paint and place within this band. */
export const MERCATOR_MAX_LAT = 85

function hexToRgb(hex) {
  const raw = hex.replace('#', '')
  const n = Number.parseInt(raw, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Absolute air temperature (°C) → RGBA.
 * Uses TEMPERATURE.colorStops — the same ramp as the legend.
 */
export function absoluteToRgba(
  tempC,
  { vmin = -20, vmax = 40, alpha = 0.55 } = {},
) {
  if (!Number.isFinite(tempC)) return [0, 0, 0, 0]

  const stops = TEMPERATURE.colorStops.map((stop) => ({
    t: stop.t,
    c: hexToRgb(stop.color),
  }))

  const t = Math.min(vmax, Math.max(vmin, tempC))

  let r
  let g
  let b
  if (tempC <= stops[0].t) {
    ;[r, g, b] = stops[0].c
  } else if (tempC >= stops[stops.length - 1].t) {
    ;[r, g, b] = stops[stops.length - 1].c
  } else {
    let i = 0
    while (i < stops.length - 1 && t > stops[i + 1].t) i += 1
    const aStop = stops[i]
    const bStop = stops[i + 1]
    const u = (t - aStop.t) / (bStop.t - aStop.t)
    r = Math.round(aStop.c[0] + (bStop.c[0] - aStop.c[0]) * u)
    g = Math.round(aStop.c[1] + (bStop.c[1] - aStop.c[1]) * u)
    b = Math.round(aStop.c[2] + (bStop.c[2] - aStop.c[2]) * u)
  }

  return [r, g, b, Math.round(alpha * 255)]
}

/** @deprecated use absoluteToRgba — kept as alias for older call sites */
export const anomalyToRgba = absoluteToRgba

/** LUT indexed by tenths of a degree from lutMin..lutMax. */
function buildColorLut({ vmin, vmax, alpha, lutMin = -40, lutMax = 50 }) {
  const a = Math.round(alpha * 255)
  const n = Math.round((lutMax - lutMin) * 10) + 1
  const lut = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i += 1) {
    const tempC = lutMin + i * 0.1
    const [r, g, b] = absoluteToRgba(tempC, { vmin, vmax, alpha: 1 })
    const o = i * 4
    lut[o] = r
    lut[o + 1] = g
    lut[o + 2] = b
    lut[o + 3] = a
  }
  return { lut, lutMin, lutMax }
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

/**
 * @param {object} payload temperature.json
 * @param {ArrayBuffer} [binBuffer] raw Int16 LE grid (preferred)
 */
export function decodeTemperaturePayload(payload, binBuffer) {
  const grid = payload?.grid
  if (!grid?.keys?.length) {
    throw new Error('Temperature grid missing')
  }

  let values
  if (binBuffer) {
    values = new Int16Array(binBuffer)
  } else if (grid.data) {
    // Legacy base64 fallback
    const binary = atob(grid.data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    values = new Int16Array(bytes.buffer)
  } else {
    throw new Error('Temperature grid binary missing')
  }

  const { nLat, nLon, scale, missing } = grid
  const cells = nLat * nLon
  const expected = cells * grid.keys.length
  if (values.length < expected) {
    throw new Error(
      `Temperature grid size mismatch (${values.length} < ${expected})`,
    )
  }
  const indexByKey = new Map(grid.keys.map((k, i) => [k, i]))

  const latMin = grid.latMin
  const latMax = grid.latMax
  const lonMin = grid.lonMin
  const lonMax = grid.lonMax
  const dLat = (latMax - latMin) / nLat
  const dLon = (lonMax - lonMin) / nLon
  const latCenters = new Float64Array(nLat)
  const lonCenters = new Float64Array(nLon)
  for (let i = 0; i < nLat; i += 1) latCenters[i] = latMin + (i + 0.5) * dLat
  for (let j = 0; j < nLon; j += 1) lonCenters[j] = lonMin + (j + 0.5) * dLon

  return {
    meta: payload.meta,
    series: payload.series ?? {},
    gridMeta: {
      nLat,
      nLon,
      latMin,
      latMax,
      lonMin,
      lonMax,
      dLat,
      dLon,
      latCenters,
      lonCenters,
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

/** Int16 scaled slice → Float32 °C (NaN = missing). */
export function sliceToCelsius(slice, gridMeta) {
  const { scale, missing } = gridMeta
  const out = new Float32Array(slice.length)
  for (let i = 0; i < slice.length; i += 1) {
    const raw = slice[i]
    out[i] = raw === missing ? Number.NaN : raw * scale
  }
  return out
}

/** Lerp two °C fields. */
export function lerpCelsius(fromField, toField, t) {
  const u = Math.min(1, Math.max(0, t))
  const n = toField.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const a = fromField?.[i]
    const b = toField[i]
    const aOk = Number.isFinite(a)
    const bOk = Number.isFinite(b)
    if (aOk && bOk) out[i] = a * (1 - u) + b * u
    else if (bOk) out[i] = b
    else if (aOk) out[i] = a
    else out[i] = Number.NaN
  }
  return out
}

/**
 * Bilinear sample of a Float32 °C field at geographic lon/lat.
 */
export function sampleCelsius(field, gridMeta, lon, lat) {
  const { nLat, nLon, latCenters, lonCenters, dLat, dLon } = gridMeta

  let xLon = lon
  const halfLon = dLon / 2
  while (xLon < lonCenters[0] - halfLon) xLon += 360
  while (xLon > lonCenters[nLon - 1] + halfLon) xLon -= 360

  const fy = (lat - latCenters[0]) / dLat
  const fx = (xLon - lonCenters[0]) / dLon
  if (fy < -0.5 || fy > nLat - 0.5) return null

  const y0 = Math.floor(fy)
  const x0 = Math.floor(fx)
  const ty = fy - y0
  const tx = fx - x0

  const read = (row, col) => {
    if (row < 0 || row >= nLat) return null
    let c = col % nLon
    if (c < 0) c += nLon
    const v = field[row * nLon + c]
    return Number.isFinite(v) ? v : null
  }

  const r00 = read(y0, x0)
  const r10 = read(y0, x0 + 1)
  const r01 = read(y0 + 1, x0)
  const r11 = read(y0 + 1, x0 + 1)

  let wSum = 0
  let vSum = 0
  if (r00 != null) {
    const w = (1 - tx) * (1 - ty)
    wSum += w
    vSum += r00 * w
  }
  if (r10 != null) {
    const w = tx * (1 - ty)
    wSum += w
    vSum += r10 * w
  }
  if (r01 != null) {
    const w = (1 - tx) * ty
    wSum += w
    vSum += r01 * w
  }
  if (r11 != null) {
    const w = tx * ty
    wSum += w
    vSum += r11 * w
  }
  if (wSum <= 0) return null
  return vSum / wSum
}

/**
 * Paint temperature into a screen-space canvas.
 *
 * Lon/lat are unprojected only on a sparse control grid, then bilinear-
 * interpolated per sample pixel — much cheaper than unproject-per-pixel,
 * while still tracking the map projection closely.
 */
export function paintTemperatureViewport(
  map,
  celsiusField,
  gridMeta,
  canvas,
  {
    vmin = -20,
    vmax = 38,
    alpha = 0.55,
    step = 2,
    cellsX = 24,
    cellsY = 14,
  } = {},
) {
  if (!map || !canvas || !celsiusField || !gridMeta) return

  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  if (cssW < 2 || cssH < 2) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const stride = Math.max(1, step)
  const sampleW = Math.max(2, Math.ceil(cssW / stride))
  const sampleH = Math.max(2, Math.ceil(cssH / stride))

  if (!paintTemperatureViewport._buf) {
    paintTemperatureViewport._buf = document.createElement('canvas')
  }
  const buffer = paintTemperatureViewport._buf
  if (buffer.width !== sampleW || buffer.height !== sampleH) {
    buffer.width = sampleW
    buffer.height = sampleH
  }

  const bufKey = `${sampleW}x${sampleH}`
  if (
    !paintTemperatureViewport._img ||
    paintTemperatureViewport._imgKey !== bufKey
  ) {
    paintTemperatureViewport._img = new ImageData(sampleW, sampleH)
    paintTemperatureViewport._imgKey = bufKey
  }
  const image = paintTemperatureViewport._img
  const { data } = image
  // Clear alpha quickly when reusing ImageData
  data.fill(0)

  // Version prefix busts stale LUTs after colormap changes (HMR / same vmin/vmax)
  const lutKey = `abs-v3|${vmin}|${vmax}|${alpha}|${TEMPERATURE.colorStops.map((s) => s.color).join(',')}`
  const { lut, lutMin, lutMax } = getLut(lutKey, { vmin, vmax, alpha })

  // Sparse geographic control grid (cellsX × cellsY cells → (cellsX+1)×(cellsY+1) points)
  const gx = Math.max(2, cellsX)
  const gy = Math.max(2, cellsY)
  const lonGrid = new Float64Array((gx + 1) * (gy + 1))
  const latGrid = new Float64Array((gx + 1) * (gy + 1))
  for (let j = 0; j <= gy; j += 1) {
    const y = (j / gy) * cssH
    for (let i = 0; i <= gx; i += 1) {
      const x = (i / gx) * cssW
      const ll = map.unproject([x, y])
      const idx = j * (gx + 1) + i
      lonGrid[idx] = ll.lng
      latGrid[idx] = ll.lat
    }
  }

  const cellW = sampleW / gx
  const cellH = sampleH / gy

  for (let sy = 0; sy < sampleH; sy += 1) {
    const fy = sy / cellH
    const j0 = Math.min(gy - 1, Math.max(0, Math.floor(fy)))
    const ty = fy - j0
    for (let sx = 0; sx < sampleW; sx += 1) {
      const fx = sx / cellW
      const i0 = Math.min(gx - 1, Math.max(0, Math.floor(fx)))
      const tx = fx - i0

      const i00 = j0 * (gx + 1) + i0
      const i10 = i00 + 1
      const i01 = i00 + (gx + 1)
      const i11 = i01 + 1

      // Interpolate lon carefully across the antimeridian
      let lon =
        lonGrid[i00] * (1 - tx) * (1 - ty) +
        lonGrid[i10] * tx * (1 - ty) +
        lonGrid[i01] * (1 - tx) * ty +
        lonGrid[i11] * tx * ty
      const lat =
        latGrid[i00] * (1 - tx) * (1 - ty) +
        latGrid[i10] * tx * (1 - ty) +
        latGrid[i01] * (1 - tx) * ty +
        latGrid[i11] * tx * ty

      // Fix rare antimeridian blend blow-ups by falling back to nearest control
      if (!Number.isFinite(lon) || Math.abs(lon) > 720) {
        lon = lonGrid[i00]
      }

      const tempC = sampleCelsius(celsiusField, gridMeta, lon, lat)
      const i = (sy * sampleW + sx) * 4
      if (tempC == null || !Number.isFinite(tempC)) continue
      const tenths = Math.round(
        (Math.min(lutMax, Math.max(lutMin, tempC)) - lutMin) * 10,
      )
      const o = tenths * 4
      data[i] = lut[o]
      data[i + 1] = lut[o + 1]
      data[i + 2] = lut[o + 2]
      data[i + 3] = lut[o + 3]
    }
  }

  const bctx = buffer.getContext('2d', { alpha: true })
  bctx.putImageData(image, 0, 0)

  const targetW = Math.floor(cssW * dpr)
  const targetH = Math.floor(cssH * dpr)
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, targetW, targetH)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(buffer, 0, 0, targetW, targetH)
}

export { MONTH_KEY }

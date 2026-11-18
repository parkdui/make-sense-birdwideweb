import { useEffect, useRef } from 'react'
import { MAP, TEMPERATURE } from '../config.js'
import { drawBirdMarker, markerForSpecies } from '../utils/birdMarkers.js'

function temperatureRamp() {
  const { vmin, vmax, colorStops } = TEMPERATURE
  const span = vmax - vmin
  const parts = colorStops.map((stop) => {
    const pct = ((stop.t - vmin) / span) * 100
    return `${stop.color} ${pct}%`
  })
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

function formatAnomaly(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}°C`
}

function SpeciesMark({ speciesId, color }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = 22
    const h = 16
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const marker = markerForSpecies(speciesId)
    drawBirdMarker(ctx, w * 0.55, h * 0.55, {
      color,
      shape: marker.shape,
      size: Math.min(marker.size * 0.7, 7),
      heading: -0.4,
      phase: 0.6,
    })
  }, [speciesId, color])

  return (
    <canvas
      ref={canvasRef}
      className="legend__bird"
      aria-hidden="true"
    />
  )
}

export default function Legend({
  speciesList = [],
  flockSize = 0,
  globalAnomaly = null,
}) {
  return (
    <div className="legend" aria-label="Map legend">
      {speciesList.length > 0 ? (
        speciesList.map((s) => (
          <div className="legend__row" key={s.id}>
            <SpeciesMark speciesId={s.id} color={s.color} />
            <span>{s.commonName}</span>
          </div>
        ))
      ) : (
        <div className="legend__row">
          <span
            className="legend__swatch"
            style={{ backgroundColor: MAP.pointColor }}
          />
          <span>Bird + trail</span>
        </div>
      )}
      <div className="legend__row">
        <span
          className="legend__line"
          style={{ color: MAP.northLineColor }}
        />
        <span>Northernmost lat</span>
      </div>
      <div className="legend__row">
        <span
          className="legend__line"
          style={{ color: MAP.southLineColor }}
        />
        <span>Southernmost lat</span>
      </div>
      <div className="legend__temp" aria-hidden="true">
        <p className="legend__temp-title">Absolute air temp (°C)</p>
        <span
          className="legend__ramp legend__ramp--absolute"
          style={{ background: temperatureRamp() }}
        />
        <span className="legend__ramp-labels legend__ramp-labels--abs">
          <span>{TEMPERATURE.vmin}°</span>
          <span>0°</span>
          <span>20°</span>
          <span>{TEMPERATURE.vmax}°</span>
        </span>
      </div>
      <p>
        {flockSize > 0 ? `${flockSize} birds in flight` : 'Birds in flight'}
        {Number.isFinite(globalAnomaly)
          ? ` · GISTEMP anomaly ${formatAnomaly(globalAnomaly)}`
          : ''}
      </p>
    </div>
  )
}

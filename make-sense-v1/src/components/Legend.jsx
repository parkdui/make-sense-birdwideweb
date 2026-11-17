import { MAP, TEMPERATURE } from '../config.js'

function formatAnomaly(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}°C`
}

export default function Legend({ flockSize = 0, globalAnomaly = null }) {
  return (
    <div className="legend" aria-label="Map legend">
      <div className="legend__row">
        <span
          className="legend__swatch"
          style={{ backgroundColor: MAP.pointColor }}
        />
        <span>Bird + trail</span>
      </div>
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
        <span className="legend__ramp legend__ramp--absolute" />
        <span className="legend__ramp-labels legend__ramp-labels--abs">
          <span>{TEMPERATURE.vmin}°</span>
          <span>0°</span>
          <span>20°</span>
          <span>{TEMPERATURE.vmax}°</span>
        </span>
      </div>
      <p>
        {flockSize > 0 ? `${flockSize} moving dots` : 'Moving dots'}
        {Number.isFinite(globalAnomaly)
          ? ` · GISTEMP anomaly ${formatAnomaly(globalAnomaly)}`
          : ''}
      </p>
    </div>
  )
}

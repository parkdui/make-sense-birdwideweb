import { MAP } from '../config.js'

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
      <div className="legend__temp" aria-hidden="true">
        <span className="legend__ramp" />
        <span className="legend__ramp-labels">
          <span>cool</span>
          <span>warm</span>
        </span>
      </div>
      <p>
        {flockSize > 0 ? `${flockSize} moving dots` : 'Moving dots'}
        {Number.isFinite(globalAnomaly)
          ? ` · GISTEMP ${formatAnomaly(globalAnomaly)}`
          : ''}
      </p>
    </div>
  )
}

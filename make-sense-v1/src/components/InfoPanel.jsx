import { TIMELINE } from '../config.js'

function formatAnomaly(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)} °C`
}

/**
 * @param {object[]} speciesList selected SPECIES_CATALOG entries
 * @param {object[]} flockStats per-species month stats (optional)
 */
export default function InfoPanel({
  year,
  month,
  visibleCount,
  monthRecordCount,
  yearRecordCount,
  totalCount,
  speciesList = [],
  flockStats = [],
  temperatureMeta,
  globalAnomaly,
  tempStatus,
  status,
}) {
  const monthName = TIMELINE.months[month - 1]
  const multi = speciesList.length > 1
  const title = multi
    ? `${speciesList.length} species`
    : (speciesList[0]?.commonName ?? 'Species')
  const subtitle = multi
    ? 'Compared on the same map & timeline'
    : speciesList[0]?.scientificName ?? ''

  return (
    <aside className="info-panel" aria-label="Species and data information">
      {speciesList.length > 0 && (
        <div className="info-panel__thumbs" aria-hidden={speciesList.length === 0}>
          {speciesList.map((s) =>
            s.imageUrl ? (
              <figure key={s.id} className="info-panel__thumb">
                <img
                  src={s.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span
                  className="info-panel__thumb-dot"
                  style={{ backgroundColor: s.color }}
                />
              </figure>
            ) : null,
          )}
        </div>
      )}

      <header className="info-panel__header">
        <p className="info-panel__eyebrow">Migration visualization</p>
        <h1>{title}</h1>
        {subtitle && (
          <p className="info-panel__scientific">
            {multi ? subtitle : <em>{subtitle}</em>}
          </p>
        )}
      </header>

      {multi && (
        <ul className="info-panel__species-list">
          {speciesList.map((s) => {
            const stat = flockStats.find((f) => f.id === s.id)
            return (
              <li key={s.id}>
                <span
                  className="info-panel__species-swatch"
                  style={{ backgroundColor: s.color }}
                />
                <span className="info-panel__species-name">{s.commonName}</span>
                <span className="info-panel__species-dots">
                  {status === 'ready' && stat
                    ? `${stat.flockSize} dots`
                    : '—'}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <dl className="info-panel__stats">
        <div>
          <dt>Year / month</dt>
          <dd>
            {year} · {monthName}
          </dd>
        </div>
        <div>
          <dt>GISTEMP anomaly</dt>
          <dd>
            {tempStatus === 'ready' ? formatAnomaly(globalAnomaly) : '—'}
          </dd>
        </div>
        <div>
          <dt>Dots on map</dt>
          <dd>{status === 'ready' ? visibleCount.toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt>Local sample</dt>
          <dd>
            {status === 'ready' ? monthRecordCount.toLocaleString() : '—'}
          </dd>
        </div>
      </dl>

      <p className="info-panel__disclaimer">
        Map colors are absolute air temperature (°C). Dot count scales with GBIF
        monthly occurrences per species. Not individual GPS tracks.
      </p>

      <p className="info-panel__source">
        <a href="https://www.gbif.org/" target="_blank" rel="noopener noreferrer">
          GBIF
        </a>
        {' · '}
        <a
          href="https://data.giss.nasa.gov/gistemp/"
          target="_blank"
          rel="noopener noreferrer"
        >
          GISTEMP
        </a>
        {' · '}
        <a
          href="https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          NCEP
        </a>
        {status === 'ready' && (
          <>
            {' · '}
            {yearRecordCount}/{totalCount} records
          </>
        )}
      </p>

      {temperatureMeta && (
        <details className="info-panel__meta">
          <summary>Temperature sources</summary>
          <p>
            Temp series: {temperatureMeta.seriesSource}. Map grid:{' '}
            {temperatureMeta.gridSource}.
          </p>
        </details>
      )}
    </aside>
  )
}

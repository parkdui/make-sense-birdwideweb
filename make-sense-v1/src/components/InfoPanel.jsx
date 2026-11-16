import { SPECIES, TIMELINE } from '../config.js'
import { formatLicenseLabel } from '../utils/occurrences.js'

function formatAnomaly(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)} °C`
}

export default function InfoPanel({
  year,
  month,
  visibleCount,
  januaryCount,
  monthRecordCount,
  yearRecordCount,
  totalCount,
  meta,
  temperatureMeta,
  globalAnomaly,
  tempStatus,
  status,
}) {
  const monthName = TIMELINE.months[month - 1]
  const retrievedAt = meta?.retrievedAt
    ? new Date(meta.retrievedAt).toLocaleString()
    : '—'

  return (
    <aside className="info-panel" aria-label="Species and data information">
      <header className="info-panel__header">
        <p className="info-panel__eyebrow">Migration visualization</p>
        <h1>{SPECIES.commonName}</h1>
        <p className="info-panel__scientific">
          <em>{SPECIES.scientificName}</em>
        </p>
      </header>

      <dl className="info-panel__stats">
        <div>
          <dt>Year / month</dt>
          <dd>
            {year} · {monthName}
          </dd>
        </div>
        <div>
          <dt>Global anomaly</dt>
          <dd>
            {tempStatus === 'ready' ? formatAnomaly(globalAnomaly) : '—'}
          </dd>
        </div>
        <div>
          <dt>Dots on map</dt>
          <dd>{status === 'ready' ? visibleCount.toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt>January records</dt>
          <dd>{status === 'ready' ? januaryCount.toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt>Month sample</dt>
          <dd>
            {status === 'ready' ? monthRecordCount.toLocaleString() : '—'}
          </dd>
        </div>
      </dl>

      <p className="info-panel__disclaimer">
        Temperature layer: white → yellow → red over a grayscale basemap.
        Bird dots move with the monthly timeline. Not individual GPS tracks.
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
          href="https://www.metoffice.gov.uk/hadobs/hadcrut5/"
          target="_blank"
          rel="noopener noreferrer"
        >
          HadCRUT5
        </a>
        {status === 'ready' && (
          <>
            {' · '}
            {yearRecordCount}/{totalCount} records
          </>
        )}
      </p>

      {meta && (
        <details key={meta.retrievedAt || 'meta'} className="info-panel__meta">
          <summary>Dataset metadata</summary>
          <p>
            Retrieved: <time dateTime={meta.retrievedAt}>{retrievedAt}</time>
          </p>
          <p>
            taxonKey: {meta.taxonKey} · {meta.sampling}
          </p>
          {temperatureMeta && (
            <p>
              Temp series: {temperatureMeta.seriesSource}. Map grid:{' '}
              {temperatureMeta.gridSource}.
            </p>
          )}
          {meta.licenses?.length > 0 && (
            <ul className="info-panel__licenses">
              {meta.licenses.map(({ license, count }) => (
                <li key={license}>
                  {formatLicenseLabel(license)} ({count.toLocaleString()})
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </aside>
  )
}

import { TIMELINE } from '../config.js'
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
  monthRecordCount,
  gbifOccurrenceCount,
  yearRecordCount,
  totalCount,
  meta,
  speciesInfo,
  temperatureMeta,
  globalAnomaly,
  tempStatus,
  status,
}) {
  const monthName = TIMELINE.months[month - 1]
  const retrievedAt = meta?.retrievedAt
    ? new Date(meta.retrievedAt).toLocaleString()
    : '—'
  const commonName = speciesInfo?.commonName ?? meta?.commonName ?? 'Species'
  const scientificName =
    speciesInfo?.scientificName ?? meta?.scientificName ?? ''
  const speciesUrl =
    speciesInfo?.gbifSpeciesUrl ??
    meta?.speciesPage ??
    'https://www.gbif.org/'
  const imageUrl = speciesInfo?.imageUrl
  const imageCredit = speciesInfo?.imageCredit

  return (
    <aside className="info-panel" aria-label="Species and data information">
      {imageUrl && (
        <figure className="info-panel__figure">
          <img
            className="info-panel__image"
            src={imageUrl}
            alt={commonName}
            loading="lazy"
            decoding="async"
          />
          {imageCredit && (
            <figcaption className="info-panel__image-credit">
              Photo · {imageCredit}
            </figcaption>
          )}
        </figure>
      )}
      <header className="info-panel__header">
        <p className="info-panel__eyebrow">Migration visualization</p>
        <h1>{commonName}</h1>
        <p className="info-panel__scientific">
          <em>{scientificName}</em>
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
          <dt>GBIF this month</dt>
          <dd>
            {status === 'ready' && gbifOccurrenceCount != null
              ? gbifOccurrenceCount.toLocaleString()
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Local sample</dt>
          <dd>
            {status === 'ready' ? monthRecordCount.toLocaleString() : '—'}
          </dd>
        </div>
      </dl>

      <p className="info-panel__disclaimer">
        Map colors are absolute air temperature (°C): white ≤ −20°C through
        yellow and red to purple ≥ 38°C. The number above is GISTEMP global
        anomaly, not absolute heat. Not individual GPS tracks.
      </p>

      <p className="info-panel__source">
        <a href="https://www.gbif.org/" target="_blank" rel="noopener noreferrer">
          GBIF
        </a>
        {' · '}
        <a href={speciesUrl} target="_blank" rel="noopener noreferrer">
          species
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

import { GBIF } from '../config.js'

const ABSENT_STATUSES = new Set(['ABSENT', 'NOT_DETECTED'])

export function normalizeOccurrence(raw) {
  if (!raw || typeof raw !== 'object') return null

  const gbifID = raw.gbifID ?? raw.key
  if (gbifID == null) return null

  const lat = Number(raw.decimalLatitude)
  const lng = Number(raw.decimalLongitude)

  let month = raw.month != null ? Number(raw.month) : null
  let year = raw.year != null ? Number(raw.year) : null
  const eventDate = typeof raw.eventDate === 'string' ? raw.eventDate : null

  if (eventDate) {
    const parsed = parseEventDateParts(eventDate)
    if (month == null && parsed.month != null) month = parsed.month
    if (year == null && parsed.year != null) year = parsed.year
  }

  const uncertainty =
    raw.coordinateUncertaintyInMeters != null
      ? Number(raw.coordinateUncertaintyInMeters)
      : null

  return {
    gbifID: String(gbifID),
    decimalLatitude: lat,
    decimalLongitude: lng,
    eventDate,
    year,
    month,
    basisOfRecord: raw.basisOfRecord ?? null,
    coordinateUncertaintyInMeters: Number.isFinite(uncertainty)
      ? uncertainty
      : null,
    countryCode: raw.countryCode ?? null,
    datasetKey: raw.datasetKey ?? null,
    license: raw.license ?? null,
    occurrenceStatus: raw.occurrenceStatus ?? null,
    scientificName: raw.scientificName ?? null,
    continent: raw.continent ?? null,
  }
}

export function isValidOccurrence(record) {
  if (!record) return false
  if (ABSENT_STATUSES.has(record.occurrenceStatus)) return false
  if (!Number.isFinite(record.decimalLatitude)) return false
  if (!Number.isFinite(record.decimalLongitude)) return false
  if (record.decimalLatitude < -90 || record.decimalLatitude > 90) return false
  if (record.decimalLongitude < -180 || record.decimalLongitude > 180) return false
  if (!record.eventDate || typeof record.eventDate !== 'string') return false
  if (!Number.isInteger(record.month) || record.month < 1 || record.month > 12) {
    return false
  }
  if (
    record.year != null &&
    (record.year < GBIF.yearStart || record.year > GBIF.yearEnd)
  ) {
    return false
  }
  if (
    record.coordinateUncertaintyInMeters != null &&
    record.coordinateUncertaintyInMeters > GBIF.maxCoordinateUncertaintyMeters
  ) {
    return false
  }
  return true
}

function parseEventDateParts(eventDate) {
  const match = /^(\d{4})-(\d{2})/.exec(eventDate)
  if (!match) return { year: null, month: null }
  return { year: Number(match[1]), month: Number(match[2]) }
}

/**
 * @param {Array} records
 * @param {{ year?: number|null, month?: number|null }} [filter]
 */
export function recordsToGeoJSON(records, filter = {}) {
  const { year = null, month = null } = filter
  const features = []

  for (const r of records) {
    if (year != null && r.year !== year) continue
    if (month != null && r.month !== month) continue

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [r.decimalLongitude, r.decimalLatitude],
      },
      properties: {
        gbifID: r.gbifID,
        eventDate: r.eventDate,
        year: r.year,
        month: r.month,
        countryCode: r.countryCode,
        datasetKey: r.datasetKey,
        license: r.license,
        basisOfRecord: r.basisOfRecord,
        coordinateUncertaintyInMeters: r.coordinateUncertaintyInMeters,
      },
    })
  }

  return { type: 'FeatureCollection', features }
}

export function formatLicenseLabel(license) {
  if (!license || license === 'UNKNOWN') return 'Unknown / not specified'
  if (license.includes('zero') || license.includes('cc0') || license.includes('CC0')) {
    return 'CC0'
  }
  if (license.includes('by-nc') || license.includes('BY-NC')) return 'CC BY-NC'
  if (license.includes('by/') || license.includes('BY_4') || license.includes('by 4')) {
    return 'CC BY'
  }
  return license.replace(/^https?:\/\//, '').slice(0, 60)
}

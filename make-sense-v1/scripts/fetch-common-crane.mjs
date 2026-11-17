#!/usr/bin/env node
/**
 * Manual GBIF dataset builder for Common Crane (Grus grus).
 *
 * Run: npm run fetch:common-crane
 * Writes: public/data/grus-grus.json
 *
 * Same normalize / validate / dedupe / pagination rules as Barn Swallow.
 * World-wide (no continent filter). Year × month stratified sample so the
 * flock timeline stays usable (~16 records/month × 12 × 26 years).
 */

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'data', 'grus-grus.json')

const BASE = 'https://api.gbif.org/v1'
const SCIENTIFIC_NAME = 'Grus grus'
const COMMON_NAME = 'Common Crane'
const YEAR_START = 2000
const YEAR_END = 2025
/** Same monthly density as Barn Swallow (12 EU + 4 AF), but world-wide. */
const RECORDS_PER_MONTH = 16
const PAGE_SIZE = 100
const MAX_UNCERTAINTY_M = 50_000
const REQUEST_GAP_MS = 140
const MAX_RETRIES = 5

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, attempt = 0) {
  await sleep(REQUEST_GAP_MS)
  const res = await fetch(url)
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const wait = REQUEST_GAP_MS * (attempt + 2) ** 2
    console.warn(`429 → retry in ${wait}ms`)
    await sleep(wait)
    return fetchJson(url, attempt + 1)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

function normalize(raw) {
  const gbifID = raw.gbifID ?? raw.key
  if (gbifID == null) return null
  const lat = Number(raw.decimalLatitude)
  const lng = Number(raw.decimalLongitude)
  let month = raw.month != null ? Number(raw.month) : null
  let year = raw.year != null ? Number(raw.year) : null
  const eventDate = typeof raw.eventDate === 'string' ? raw.eventDate : null
  if (eventDate) {
    const m = /^(\d{4})-(\d{2})/.exec(eventDate)
    if (m) {
      if (year == null) year = Number(m[1])
      if (month == null) month = Number(m[2])
    }
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

function isValid(r) {
  if (!r) return false
  if (r.occurrenceStatus === 'ABSENT' || r.occurrenceStatus === 'NOT_DETECTED') {
    return false
  }
  if (!Number.isFinite(r.decimalLatitude) || !Number.isFinite(r.decimalLongitude)) {
    return false
  }
  if (r.decimalLatitude < -90 || r.decimalLatitude > 90) return false
  if (r.decimalLongitude < -180 || r.decimalLongitude > 180) return false
  if (!r.eventDate) return false
  if (!Number.isInteger(r.month) || r.month < 1 || r.month > 12) return false
  if (!Number.isInteger(r.year) || r.year < YEAR_START || r.year > YEAR_END) {
    return false
  }
  if (
    r.coordinateUncertaintyInMeters != null &&
    r.coordinateUncertaintyInMeters > MAX_UNCERTAINTY_M
  ) {
    return false
  }
  return true
}

async function matchSpecies() {
  const data = await fetchJson(
    `${BASE}/species/match?name=${encodeURIComponent(SCIENTIFIC_NAME)}`,
  )
  const taxonKey = data.usageKey ?? data.speciesKey
  if (!taxonKey) throw new Error('Species match failed')
  if (data.matchType !== 'EXACT' && (data.confidence ?? 0) < 90) {
    throw new Error(
      `Weak species match: type=${data.matchType} confidence=${data.confidence}`,
    )
  }
  return {
    taxonKey,
    scientificName: data.scientificName,
    canonicalName: data.canonicalName,
    matchType: data.matchType,
    confidence: data.confidence,
    status: data.status,
  }
}

/**
 * Page through GBIF for one year+month, world-wide (no continent filter).
 */
async function fetchMonth(taxonKey, { year, month, maxRecords, seen }) {
  const collected = []
  let offset = 0
  let end = false
  let scanned = 0

  while (collected.length < maxRecords && !end) {
    const limit = Math.min(PAGE_SIZE, maxRecords - collected.length + 20)
    const params = new URLSearchParams({
      taxonKey: String(taxonKey),
      hasCoordinate: 'true',
      hasGeospatialIssue: 'false',
      year: String(year),
      month: String(month),
      limit: String(Math.min(PAGE_SIZE, limit)),
      offset: String(offset),
    })
    const page = await fetchJson(`${BASE}/occurrence/search?${params}`)
    const results = page.results ?? []
    if (!results.length) break

    for (const raw of results) {
      scanned += 1
      if (collected.length >= maxRecords) break
      const n = normalize(raw)
      if (!isValid(n) || seen.has(n.gbifID)) continue
      if (n.year !== year || n.month !== month) continue
      seen.add(n.gbifID)
      collected.push(n)
    }

    end = Boolean(page.endOfRecords) || results.length < Math.min(PAGE_SIZE, limit)
    offset += results.length
    if (offset >= 30_000) break
  }

  return { records: collected, scanned }
}

function summarize(records, keyFn) {
  const map = new Map()
  for (const r of records) {
    const k = keyFn(r)
    if (k == null || k === '') continue
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

async function main() {
  console.log(`Matching "${SCIENTIFIC_NAME}"…`)
  const species = await matchSpecies()
  console.log(
    `taxonKey=${species.taxonKey} (${species.matchType}, confidence=${species.confidence})`,
  )

  // Quick world count for the report (coordinate + no geospatial issue)
  const countPage = await fetchJson(
    `${BASE}/occurrence/search?${new URLSearchParams({
      taxonKey: String(species.taxonKey),
      hasCoordinate: 'true',
      hasGeospatialIssue: 'false',
      year: `${YEAR_START},${YEAR_END}`,
      limit: '0',
    })}`,
  )
  const gbifCoordinateCount = countPage.count ?? null
  console.log(
    `GBIF world occurrences with coordinates (${YEAR_START}–${YEAR_END}): ${gbifCoordinateCount}`,
  )

  const seen = new Set()
  const all = []
  const yearStats = {}
  let scannedTotal = 0
  let validAccepted = 0

  for (let year = YEAR_START; year <= YEAR_END; year += 1) {
    const byMonth = {}
    let keptYear = 0

    for (let month = 1; month <= 12; month += 1) {
      const { records, scanned } = await fetchMonth(species.taxonKey, {
        year,
        month,
        maxRecords: RECORDS_PER_MONTH,
        seen,
      })
      scannedTotal += scanned
      validAccepted += records.length
      all.push(...records)
      byMonth[month] = records.length
      keptYear += records.length
      process.stdout.write(
        ` ${year}-${String(month).padStart(2, '0')}:${records.length}`,
      )
    }

    yearStats[year] = {
      target: RECORDS_PER_MONTH * 12,
      kept: keptYear,
      byMonth,
    }
    console.log(`\nYear ${year}: ${keptYear} records`)
  }

  const licenses = summarize(all, (r) => r.license || 'UNKNOWN').map(
    ({ key, count }) => ({ license: key, count }),
  )
  const datasets = summarize(all, (r) => r.datasetKey || 'UNKNOWN')
    .filter((d) => d.key !== 'UNKNOWN')
    .slice(0, 12)
    .map(({ key, count }) => ({ datasetKey: key, count }))
  const byContinent = summarize(all, (r) => r.continent || 'UNKNOWN')
  const byCountry = summarize(all, (r) => r.countryCode || 'UNKNOWN').slice(0, 25)

  const payload = {
    meta: {
      retrievedAt: new Date().toISOString(),
      source: 'GBIF Occurrence Search API',
      sourceUrl: 'https://www.gbif.org/',
      speciesPage: `https://www.gbif.org/species/${species.taxonKey}`,
      scientificName: SCIENTIFIC_NAME,
      commonName: COMMON_NAME,
      taxonKey: species.taxonKey,
      recordCount: all.length,
      scannedRawResults: scannedTotal,
      gbifCoordinateCount,
      yearStart: YEAR_START,
      yearEnd: YEAR_END,
      perMonthTarget: RECORDS_PER_MONTH,
      perYearTarget: RECORDS_PER_MONTH * 12,
      scope: ['WORLD'],
      sampling:
        'Year × month stratified world sample (~16/month). No continent filter. Same validation/dedupe as Barn Swallow. No fabricated records; not migration tracks.',
      filters: {
        hasCoordinate: true,
        hasGeospatialIssue: false,
        maxCoordinateUncertaintyMeters: MAX_UNCERTAINTY_M,
        requireEventDate: true,
        excludeOccurrenceStatus: ['ABSENT', 'NOT_DETECTED'],
      },
      yearStats,
      byContinent,
      byCountry,
      licenses,
      datasets,
      disclaimer:
        'Points are occurrence records, not individual migration tracks or confirmed breeding sites. Density reflects sampling effort.',
    },
    species,
    records: all,
  }

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(payload))
  console.log(`\nWrote ${all.length} records → ${OUT}`)
  console.log(`Scanned GBIF page results: ${scannedTotal}`)
  console.log(`Valid kept (after filter/dedupe): ${validAccepted}`)
  console.log('By continent:', byContinent.slice(0, 10))
  console.log('Top countries:', byCountry.slice(0, 10))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

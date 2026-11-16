#!/usr/bin/env node
/**
 * Manual GBIF dataset builder for Barn Swallow (Hirundo rustica).
 *
 * Run: npm run fetch:barn-swallow
 * Writes: public/data/hirundo-rustica.json
 *
 * ~16 records/month × 12 × 26 years ≈ 4,992 records.
 * Within each year+month: try 12 Europe + 4 Africa (top-up if short).
 */

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'data', 'hirundo-rustica.json')

const BASE = 'https://api.gbif.org/v1'
const SCIENTIFIC_NAME = 'Hirundo rustica'
const YEAR_START = 2000
const YEAR_END = 2025
const EUROPE_PER_MONTH = 12
const AFRICA_PER_MONTH = 4
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
  if (!Number.isInteger(r.year) || r.year < YEAR_START || r.year > YEAR_END) return false
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
  return {
    taxonKey,
    scientificName: data.scientificName,
    canonicalName: data.canonicalName,
  }
}

async function fetchScoped(taxonKey, { year, month, continent, maxRecords, seen }) {
  const collected = []
  let offset = 0
  let end = false
  while (collected.length < maxRecords && !end) {
    const limit = Math.min(PAGE_SIZE, maxRecords - collected.length)
    const params = new URLSearchParams({
      taxonKey: String(taxonKey),
      hasCoordinate: 'true',
      hasGeospatialIssue: 'false',
      year: String(year),
      month: String(month),
      continent,
      limit: String(limit),
      offset: String(offset),
    })
    const page = await fetchJson(`${BASE}/occurrence/search?${params}`)
    const results = page.results ?? []
    if (!results.length) break
    for (const raw of results) {
      if (collected.length >= maxRecords) break
      const n = normalize(raw)
      if (!isValid(n) || seen.has(n.gbifID)) continue
      if (n.year !== year || n.month !== month) continue
      seen.add(n.gbifID)
      collected.push(n)
    }
    end = Boolean(page.endOfRecords) || results.length < limit
    offset += results.length
    if (offset >= 30_000) break
  }
  return collected
}

function summarize(records, keyFn) {
  const map = new Map()
  for (const r of records) {
    const k = keyFn(r)
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

async function main() {
  console.log('Matching species…')
  const species = await matchSpecies()
  console.log(`taxonKey=${species.taxonKey}`)

  const seen = new Set()
  const all = []
  const yearStats = {}
  const perMonthTarget = EUROPE_PER_MONTH + AFRICA_PER_MONTH

  for (let year = YEAR_START; year <= YEAR_END; year += 1) {
    const byMonth = {}
    let keptYear = 0

    for (let month = 1; month <= 12; month += 1) {
      const europe = await fetchScoped(species.taxonKey, {
        year,
        month,
        continent: 'EUROPE',
        maxRecords: EUROPE_PER_MONTH,
        seen,
      })
      const africa = await fetchScoped(species.taxonKey, {
        year,
        month,
        continent: 'AFRICA',
        maxRecords: AFRICA_PER_MONTH,
        seen,
      })

      let batch = [...europe, ...africa]
      const shortfall = perMonthTarget - batch.length
      if (shortfall > 0) {
        const extra = await fetchScoped(species.taxonKey, {
          year,
          month,
          continent: 'EUROPE',
          maxRecords: shortfall,
          seen,
        })
        batch = [...batch, ...extra]
      }

      all.push(...batch)
      byMonth[month] = batch.length
      keptYear += batch.length
      process.stdout.write(` ${year}-${String(month).padStart(2, '0')}:${batch.length}`)
    }

    yearStats[year] = { target: perMonthTarget * 12, kept: keptYear, byMonth }
    console.log(`\nYear ${year}: ${keptYear} records`)
  }

  const licenses = summarize(all, (r) => r.license || 'UNKNOWN').map(
    ({ key, count }) => ({ license: key, count }),
  )
  const datasets = summarize(all, (r) => r.datasetKey || 'UNKNOWN')
    .filter((d) => d.key !== 'UNKNOWN')
    .slice(0, 12)
    .map(({ key, count }) => ({ datasetKey: key, count }))

  const payload = {
    meta: {
      retrievedAt: new Date().toISOString(),
      source: 'GBIF Occurrence Search API',
      sourceUrl: 'https://www.gbif.org/',
      speciesPage: `https://www.gbif.org/species/${species.taxonKey}`,
      scientificName: SCIENTIFIC_NAME,
      commonName: 'Barn Swallow',
      taxonKey: species.taxonKey,
      recordCount: all.length,
      yearStart: YEAR_START,
      yearEnd: YEAR_END,
      perMonthTarget,
      perYearTarget: perMonthTarget * 12,
      scope: ['EUROPE', 'AFRICA'],
      sampling:
        'Year × month stratified (~8/month). Prefer 6 Europe + 2 Africa per month; top-up from Europe if short. No fabricated records.',
      filters: {
        hasCoordinate: true,
        hasGeospatialIssue: false,
        maxCoordinateUncertaintyMeters: MAX_UNCERTAINTY_M,
        requireEventDate: true,
        excludeOccurrenceStatus: ['ABSENT', 'NOT_DETECTED'],
      },
      yearStats,
      licenses,
      datasets,
      disclaimer:
        'Points are occurrence records, not individual migration tracks. Density reflects sampling effort.',
    },
    species,
    records: all,
  }

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(payload))
  console.log(`\nWrote ${all.length} records → ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

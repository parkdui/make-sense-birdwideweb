import { GBIF, SPECIES } from '../config.js'
import { isValidOccurrence, normalizeOccurrence } from '../utils/occurrences.js'

const REQUEST_GAP_MS = 220
const MAX_RETRIES = 5

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Match a scientific name to a GBIF taxon.
 * @param {string} scientificName
 */
export async function matchSpecies(scientificName = SPECIES.scientificName) {
  const url = `${GBIF.baseUrl}/species/match?name=${encodeURIComponent(scientificName)}`
  const data = await fetchJson(url)

  if (!data?.usageKey && !data?.speciesKey) {
    throw new Error(
      `GBIF could not match "${scientificName}". No taxonKey was returned.`,
    )
  }

  if (data.matchType === 'NONE' || data.confidence < 80) {
    throw new Error(
      `GBIF species match for "${scientificName}" was too weak (matchType=${data.matchType}, confidence=${data.confidence}).`,
    )
  }

  return {
    taxonKey: data.usageKey ?? data.speciesKey,
    scientificName: data.scientificName ?? scientificName,
    canonicalName: data.canonicalName ?? scientificName,
    rank: data.rank,
    status: data.status,
    confidence: data.confidence,
    matchType: data.matchType,
    kingdom: data.kingdom,
    family: data.family,
    raw: data,
  }
}

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url)

  if (response.status === 429 && attempt < MAX_RETRIES) {
    const retryAfter = Number(response.headers.get('Retry-After'))
    const waitMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : REQUEST_GAP_MS * (attempt + 2) ** 2
    await sleep(waitMs)
    return fetchJson(url, attempt + 1)
  }

  if (!response.ok) {
    throw new Error(
      `GBIF request failed (${response.status} ${response.statusText}) for ${url}`,
    )
  }

  return response.json()
}

/**
 * Fetch one page of occurrence records.
 */
async function fetchOccurrencePage({
  taxonKey,
  offset,
  limit,
  continent,
  month,
}) {
  const params = new URLSearchParams({
    taxonKey: String(taxonKey),
    hasCoordinate: 'true',
    hasGeospatialIssue: 'false',
    year: `${GBIF.yearStart},${GBIF.yearEnd}`,
    limit: String(limit),
    offset: String(offset),
  })

  if (continent) params.set('continent', continent)
  if (month != null) params.set('month', String(month))

  const url = `${GBIF.baseUrl}/occurrence/search?${params.toString()}`
  await sleep(REQUEST_GAP_MS)
  return fetchJson(url)
}

/**
 * Paginate until quota is met or records end.
 */
async function fetchScopedOccurrences({
  taxonKey,
  maxRecords,
  continent,
  month,
  seenIds,
  onProgress,
}) {
  const collected = []
  let offset = 0
  let endOfRecords = false
  let reportedCount = null

  while (collected.length < maxRecords && !endOfRecords) {
    const pageLimit = Math.min(GBIF.pageSize, maxRecords - collected.length)
    const page = await fetchOccurrencePage({
      taxonKey,
      offset,
      limit: pageLimit,
      continent,
      month,
    })

    if (typeof page.count === 'number') {
      reportedCount = page.count
    }

    const results = Array.isArray(page.results) ? page.results : []
    if (results.length === 0) {
      endOfRecords = true
      break
    }

    for (const raw of results) {
      if (collected.length >= maxRecords) break

      const normalized = normalizeOccurrence(raw)
      if (!normalized) continue
      if (!isValidOccurrence(normalized)) continue
      if (seenIds.has(normalized.gbifID)) continue

      seenIds.add(normalized.gbifID)
      collected.push(normalized)
    }

    endOfRecords = Boolean(page.endOfRecords) || results.length < pageLimit
    offset += results.length

    onProgress?.({
      phase: `M${month}/${continent ?? 'WORLD'}`,
      retrieved: collected.length,
      target: maxRecords,
      offset,
      reportedCount,
    })

    if (offset >= 100_000) break
  }

  return { records: collected, reportedCount }
}

function splitQuota(total, parts) {
  const base = Math.floor(total / parts)
  const remainder = total % parts
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * Retrieve a configurable sample of Barn Swallow occurrences.
 *
 * Strategy:
 * - Even sample across months 1–12 (needed for seasonal timeline)
 * - Within each month: Europe + Africa, then worldwide top-up
 * - Rate-limited + 429 retries (no fabricated data on failure)
 */
export async function fetchBarnSwallowOccurrences(options = {}) {
  const maxRecords = options.maxRecords ?? GBIF.maxRecords
  const onProgress = options.onProgress
  const retrievedAt = new Date().toISOString()

  onProgress?.({
    phase: 'species-match',
    retrieved: 0,
    target: maxRecords,
    totalRetrieved: 0,
    overallTarget: maxRecords,
  })

  const species = await matchSpecies(SPECIES.scientificName)
  const taxonKey = species.taxonKey

  const monthQuotas = splitQuota(maxRecords, 12)
  const seenIds = new Set()
  const allRecords = []
  const regionStats = {}
  const monthStats = {}

  for (let month = 1; month <= 12; month += 1) {
    const monthTarget = monthQuotas[month - 1]
    if (monthTarget <= 0) continue

    // Fewer request streams: Europe + Africa only, then one world top-up.
    const europeTarget = Math.floor(monthTarget * GBIF.regionQuotas.EUROPE)
    const africaTarget = monthTarget - europeTarget

    const regions = [
      { continent: 'EUROPE', target: europeTarget },
      { continent: 'AFRICA', target: africaTarget },
    ]

    let keptThisMonth = 0

    for (const region of regions) {
      if (region.target <= 0) continue

      const { records, reportedCount } = await fetchScopedOccurrences({
        taxonKey,
        maxRecords: region.target,
        continent: region.continent,
        month,
        seenIds,
        onProgress: (info) =>
          onProgress?.({
            ...info,
            totalRetrieved: allRecords.length + info.retrieved,
            overallTarget: maxRecords,
          }),
      })

      if (!regionStats[region.continent]) {
        regionStats[region.continent] = {
          requested: 0,
          kept: 0,
          gbifReportedCount: reportedCount,
        }
      }
      regionStats[region.continent].requested += region.target
      regionStats[region.continent].kept += records.length

      allRecords.push(...records)
      keptThisMonth += records.length
    }

    const shortfall = monthTarget - keptThisMonth
    if (shortfall > 0) {
      const { records } = await fetchScopedOccurrences({
        taxonKey,
        maxRecords: shortfall,
        continent: undefined,
        month,
        seenIds,
        onProgress: (info) =>
          onProgress?.({
            ...info,
            phase: `M${month}/top-up`,
            totalRetrieved: allRecords.length + info.retrieved,
            overallTarget: maxRecords,
          }),
      })
      allRecords.push(...records)
      keptThisMonth += records.length
      regionStats.WORLD = regionStats.WORLD ?? { requested: 0, kept: 0 }
      regionStats.WORLD.requested += shortfall
      regionStats.WORLD.kept += records.length
    }

    monthStats[month] = { requested: monthTarget, kept: keptThisMonth }
  }

  if (allRecords.length === 0) {
    throw new Error(
      'No valid GBIF occurrence records were available for Hirundo rustica with the requested filters (coordinates, dates, 2000–2025).',
    )
  }

  return {
    species,
    records: allRecords,
    meta: {
      retrievedAt,
      maxRecords,
      yearStart: GBIF.yearStart,
      yearEnd: GBIF.yearEnd,
      taxonKey,
      recordCount: allRecords.length,
      regionStats,
      monthStats,
      licenses: summarizeLicenses(allRecords),
      datasets: summarizeDatasets(allRecords),
      parameters: {
        scientificName: SPECIES.scientificName,
        hasCoordinate: true,
        hasGeospatialIssue: false,
        year: `${GBIF.yearStart},${GBIF.yearEnd}`,
        maxCoordinateUncertaintyMeters: GBIF.maxCoordinateUncertaintyMeters,
        regions: Object.keys(regionStats),
        months: '1-12 (even sample)',
        pageSize: GBIF.pageSize,
      },
    },
  }
}

function summarizeLicenses(records) {
  const counts = new Map()
  for (const r of records) {
    const key = r.license || 'UNKNOWN'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([license, count]) => ({ license, count }))
    .sort((a, b) => b.count - a.count)
}

function summarizeDatasets(records) {
  const counts = new Map()
  for (const r of records) {
    if (!r.datasetKey) continue
    counts.set(r.datasetKey, (counts.get(r.datasetKey) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([datasetKey, count]) => ({ datasetKey, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
}

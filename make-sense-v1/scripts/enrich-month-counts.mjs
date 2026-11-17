#!/usr/bin/env node
/**
 * Attach GBIF year×month occurrence counts to local species JSON files.
 * Used to scale visible dots (10–100) without downloading every occurrence.
 *
 * Run: node scripts/enrich-month-counts.mjs
 */

import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const BASE = 'https://api.gbif.org/v1'
const YEAR_START = 2000
const YEAR_END = 2025
const REQUEST_GAP_MS = 180
const MAX_RETRIES = 5

const DATASETS = [
  {
    file: path.join(ROOT, 'public', 'data', 'hirundo-rustica.json'),
    taxonKey: 9515886,
    label: 'Barn Swallow',
  },
  {
    file: path.join(ROOT, 'public', 'data', 'merops-apiaster.json'),
    taxonKey: 2475443,
    label: 'European Bee-eater',
  },
  {
    file: path.join(ROOT, 'public', 'data', 'grus-grus.json'),
    taxonKey: 2474950,
    label: 'Common Crane',
  },
  {
    file: path.join(ROOT, 'public', 'data', 'sylvia-atricapilla.json'),
    taxonKey: 2492956,
    label: 'Eurasian Blackcap',
  },
  {
    file: path.join(ROOT, 'public', 'data', 'setophaga-striata.json'),
    taxonKey: 6092935,
    label: 'Blackpoll Warbler',
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchMonthCounts(taxonKey, year, attempt = 0) {
  await sleep(REQUEST_GAP_MS)
  const params = new URLSearchParams({
    taxonKey: String(taxonKey),
    year: String(year),
    hasCoordinate: 'true',
    hasGeospatialIssue: 'false',
    limit: '0',
    facet: 'month',
    facetLimit: '12',
  })
  const res = await fetch(`${BASE}/occurrence/search?${params}`)
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const wait = REQUEST_GAP_MS * (attempt + 2) ** 2
    console.warn(`  429 on ${year} → retry in ${wait}ms`)
    await sleep(wait)
    return fetchMonthCounts(taxonKey, year, attempt + 1)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (year ${year})`)
  const data = await res.json()
  const months = Object.fromEntries(
    (data.facets?.find((f) => f.field === 'MONTH')?.counts ?? []).map((c) => [
      String(Number(c.name)),
      c.count,
    ]),
  )
  const row = {}
  for (let m = 1; m <= 12; m += 1) {
    row[String(m)] = months[String(m)] ?? 0
  }
  return { total: data.count, row }
}

async function enrichOne({ file, taxonKey, label }) {
  console.log(`\n${label} (taxonKey ${taxonKey})`)
  const raw = JSON.parse(await readFile(file, 'utf8'))
  const gbifYearMonthCounts = {}
  const yearTotals = {}

  for (let year = YEAR_START; year <= YEAR_END; year += 1) {
    const { total, row } = await fetchMonthCounts(taxonKey, year)
    gbifYearMonthCounts[String(year)] = row
    yearTotals[String(year)] = total
    const peak = Math.max(...Object.values(row))
    console.log(`  ${year}: ${total.toLocaleString()} (peak month ${peak.toLocaleString()})`)
  }

  raw.meta = {
    ...raw.meta,
    gbifYearMonthCounts,
    gbifYearTotals: yearTotals,
    flockScaling:
      'Visible dots = log-scaled GBIF year×month coordinate count, clamped to 10–100. Shared domain across species.',
  }

  await writeFile(file, JSON.stringify(raw))
  console.log(`  Wrote ${file}`)
}

const filter = process.argv.slice(2).map((s) => s.toLowerCase())
const selected = filter.length
  ? DATASETS.filter((ds) =>
      filter.some(
        (f) =>
          ds.label.toLowerCase().includes(f) ||
          path.basename(ds.file).includes(f) ||
          String(ds.taxonKey) === f,
      ),
    )
  : DATASETS

if (!selected.length) {
  console.error('No matching datasets for filter:', filter.join(', '))
  process.exit(1)
}

for (const ds of selected) {
  try {
    await access(ds.file)
  } catch {
    console.warn(`Skip missing file: ${ds.file}`)
    continue
  }
  await enrichOne(ds)
}
console.log('\nDone.')

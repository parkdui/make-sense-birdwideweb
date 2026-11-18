#!/usr/bin/env node
/**
 * Northernmost occurrence in each local GBIF sample,
 * for every species, year, and month.
 *
 * Run: node scripts/extract-northernmost.mjs
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA = path.join(ROOT, 'public', 'data')

const DATASETS = [
  { file: 'hirundo-rustica.json', id: 'barn-swallow' },
  { file: 'merops-apiaster.json', id: 'european-bee-eater' },
  { file: 'grus-grus.json', id: 'common-crane' },
  { file: 'sylvia-atricapilla.json', id: 'eurasian-blackcap' },
  { file: 'setophaga-striata.json', id: 'blackpoll-warbler' },
]

function northernmostByYear(records) {
  /** @type {Map<string, { count: number, best: object }>} */
  const buckets = new Map()

  for (const record of records) {
    const lat = Number(record.decimalLatitude)
    const lng = Number(record.decimalLongitude)
    const year = Number(record.year)
    const month = Number(record.month)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (!Number.isInteger(year) || !Number.isInteger(month)) continue
    if (month < 1 || month > 12) continue

    const key = `${year}-${month}`
    const current = buckets.get(key)
    if (!current) {
      buckets.set(key, { count: 1, best: record })
      continue
    }
    current.count += 1
    if (lat > Number(current.best.decimalLatitude)) current.best = record
  }

  const years = [...new Set([...buckets.keys()].map((key) => Number(key.split('-')[0])))]
  years.sort((a, b) => a - b)

  return years.map((year) => ({
    year,
    months: Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      const bucket = buckets.get(`${year}-${month}`)
      if (!bucket) {
        return { month, coordinate: null, sampleSize: 0 }
      }
      const best = bucket.best
      return {
        month,
        sampleSize: bucket.count,
        coordinate: {
          decimalLatitude: Number(best.decimalLatitude),
          decimalLongitude: Number(best.decimalLongitude),
        },
        gbifID: best.gbifID ?? null,
        eventDate: best.eventDate ?? null,
        countryCode: best.countryCode ?? null,
      }
    }),
  }))
}

const species = []
for (const dataset of DATASETS) {
  const json = JSON.parse(await readFile(path.join(DATA, dataset.file), 'utf8'))
  const records = Array.isArray(json.records) ? json.records : []
  species.push({
    id: dataset.id,
    commonName: json.meta?.commonName ?? null,
    scientificName: json.species?.canonicalName ?? json.meta?.scientificName ?? null,
    taxonKey: json.meta?.taxonKey ?? json.species?.taxonKey ?? null,
    sourceFile: dataset.file,
    recordCount: records.length,
    years: northernmostByYear(records),
  })
}

const payload = {
  description:
    'Northernmost occurrence in the local GBIF sample for each species, year, and month. Coordinates are copied from that sample. They are not a breeding site or a migration route.',
  generatedAt: new Date().toISOString(),
  species,
}

const outPath = path.join(DATA, 'northernmost.json')
await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`)

const points = species.reduce(
  (sum, item) =>
    sum +
    item.years.reduce(
      (yearSum, year) =>
        yearSum + year.months.filter((month) => month.coordinate).length,
      0,
    ),
  0,
)
console.log(`Wrote ${path.relative(ROOT, outPath)} (${points} northernmost points)`)

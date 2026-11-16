#!/usr/bin/env node
/**
 * Fetch local temperature inputs, then build public/data/temperature.json
 *
 * - NASA GISTEMP v4 Direct CSV → global monthly anomaly series
 * - HadCRUT5 NetCDF → 5° map grid (NetCDF4 / HDF5; converted via Python)
 *
 * Run: npm run fetch:temperature
 */

import { spawnSync } from 'node:child_process'
import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TMP = path.join(ROOT, 'tmp', 'gistemp')
const CSV_URL =
  'https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv'
const HADCRUT_URL =
  'https://www.metoffice.gov.uk/hadobs/hadcrut5/data/HadCRUT.5.0.2.0/analysis/HadCRUT.5.0.2.0.analysis.anomalies.ensemble_mean.nc'

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function download(url, dest, { force = false } = {}) {
  if (!force && (await exists(dest))) {
    console.log(`Keep cached ${path.basename(dest)}`)
    return
  }
  console.log(`Downloading ${url}`)
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'make-sense-v1/0.0.0 (educational local cache; contact via project README)',
      Accept: '*/*',
    },
  })
  if (!res.ok) {
    throw new Error(`Download failed ${res.status} ${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  console.log(`Saved ${dest} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`)
}

function runPythonBuild() {
  const script = path.join(ROOT, 'scripts', 'build-temperature-data.py')
  const result = spawnSync('python3', [script], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error('Python build failed — need python3 + netCDF4 (pip install netCDF4)')
  }
}

async function main() {
  await mkdir(TMP, { recursive: true })
  const force = process.argv.includes('--force')

  try {
    await download(CSV_URL, path.join(TMP, 'GLB.Ts+dSST.csv'), { force })
  } catch (err) {
    if (!(await exists(path.join(TMP, 'GLB.Ts+dSST.csv')))) {
      throw err
    }
    console.warn(`CSV download failed (${err.message}); using cached file`)
  }

  await download(HADCRUT_URL, path.join(TMP, 'HadCRUT5.nc'), { force })
  runPythonBuild()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

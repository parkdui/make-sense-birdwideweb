import brief from '../data/migrationBrief.js'

const COUNTRY = {
  AE: 'the United Arab Emirates',
  AO: 'Angola',
  AT: 'Austria',
  BA: 'Bosnia and Herzegovina',
  BE: 'Belgium',
  BG: 'Bulgaria',
  BR: 'Brazil',
  BS: 'the Bahamas',
  BW: 'Botswana',
  CA: 'Canada',
  CF: 'the Central African Republic',
  CH: 'Switzerland',
  CI: 'Côte d’Ivoire',
  CO: 'Colombia',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  EC: 'Ecuador',
  EE: 'Estonia',
  EG: 'Egypt',
  ES: 'Spain',
  ET: 'Ethiopia',
  FI: 'Finland',
  FR: 'France',
  GB: 'the United Kingdom',
  GF: 'French Guiana',
  GM: 'The Gambia',
  GP: 'Guadeloupe',
  GR: 'Greece',
  GY: 'Guyana',
  HU: 'Hungary',
  IE: 'Ireland',
  IL: 'Israel',
  IN: 'India',
  IQ: 'Iraq',
  IR: 'Iran',
  IS: 'Iceland',
  IT: 'Italy',
  KE: 'Kenya',
  KW: 'Kuwait',
  KY: 'the Cayman Islands',
  LI: 'Liechtenstein',
  LV: 'Latvia',
  MA: 'Morocco',
  MM: 'Myanmar',
  MN: 'Mongolia',
  MX: 'Mexico',
  MZ: 'Mozambique',
  NA: 'Namibia',
  NL: 'the Netherlands',
  NO: 'Norway',
  PE: 'Peru',
  PL: 'Poland',
  PR: 'Puerto Rico',
  PT: 'Portugal',
  RO: 'Romania',
  RS: 'Serbia',
  RU: 'Russia',
  SA: 'Saudi Arabia',
  SE: 'Sweden',
  SK: 'Slovakia',
  SN: 'Senegal',
  TH: 'Thailand',
  TR: 'Turkey',
  TT: 'Trinidad and Tobago',
  TZ: 'Tanzania',
  UG: 'Uganda',
  US: 'the United States',
  VE: 'Venezuela',
  ZA: 'South Africa',
  ZM: 'Zambia',
  ZW: 'Zimbabwe',
}

function lat(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) return 'the equator'
  const body = Math.abs(value).toFixed(1)
  return value > 0 ? `${body}°N` : `${body}°S`
}

function place(code) {
  const name = COUNTRY[code]
  return name ? ` in ${name}` : ''
}

/** How `now` sits relative to a 2000–2004 reference latitude. */
function against(now, base, noun) {
  const d = now - base
  if (Math.abs(d) < 1) return `close to the ${noun} of ${lat(base)}`
  const dir = d > 0 ? 'further north' : 'further south'
  return `${Math.abs(d).toFixed(1)}° ${dir} than the ${noun} of ${lat(base)}`
}

function seasonGroups(shifts, key) {
  const north = []
  const south = []
  const same = []
  for (const item of shifts) {
    if (item[key] > 1) north.push(item.name)
    else if (item[key] < -1) south.push(item.name)
    else same.push(item.name)
  }
  return { north, south, same }
}

function shiftsFor(year) {
  const out = []
  for (const species of brief.species) {
    const row = species.years[String(year)]
    if (!row) continue
    out.push({
      name: species.name,
      summer: row.summer.med - species.baseline.summer.med,
      winter: row.winter.med - species.baseline.winter.med,
    })
  }
  return out
}

function shortSeason(label, groups) {
  const { north, south, same } = groups
  const total = north.length + south.length + same.length
  if (!total) return ''
  if (north.length === total) return `${label} centers sat further north than in 2000–2004.`
  if (south.length === total) return `${label} centers sat further south than in 2000–2004.`
  if (!north.length && !south.length) return `${label} centers stayed near their 2000–2004 latitudes.`
  return `${label} centers were mixed.`
}

/** Standing temperature line, plus how the five species moved in the selected year. */
export function overallCopy(year) {
  const anomaly = brief.temperature[String(year)]
  const previous = brief.temperature[String(year - 1)]
  let change = ''
  if (Number.isFinite(previous)) {
    const delta = anomaly - previous
    if (Math.abs(delta) < 0.015) change = `, level with ${year - 1}`
    else if (delta > 0) change = `, ${delta.toFixed(2)}°C warmer than ${year - 1}`
    else change = `, ${Math.abs(delta).toFixed(2)}°C cooler than ${year - 1}`
  }
  const temperature = `In ${year} the global temperature was ${anomaly.toFixed(2)}°C above the 1951–1980 average${change}.`

  const shifts = shiftsFor(year)
  const migration = [
    shortSeason('Summer', seasonGroups(shifts, 'summer')),
    shortSeason('Winter', seasonGroups(shifts, 'winter')),
  ]
    .filter(Boolean)
    .join(' ')
  return { temperature, migration }
}

function summerLines(year, row, base) {
  const center = row.summer
  const early = base.summer
  return [
    `In ${year}, summer sightings centered at ${lat(center.med)}${place(center.medCountry)}, ${against(center.med, early.med, '2000–2004 center')}.`,
    `The northernmost summer sighting reached ${lat(center.north)}, ${against(center.north, early.north, 'early northern edge')}, and the southernmost was ${lat(center.south)}.`,
  ]
}

function winterLines(year, row, base) {
  const center = row.winter
  const early = base.winter
  return [
    `In ${year}, winter sightings centered at ${lat(center.med)}${place(center.medCountry)}, ${against(center.med, early.med, '2000–2004 center')}.`,
    `The southernmost winter sighting was ${lat(center.south)}, ${against(center.south, early.south, 'early southern edge')}.`,
  ]
}

function generalLines(year, row, base) {
  const spanDelta = row.span - base.span
  let spanWord = 'about the same as'
  if (spanDelta >= 2) spanWord = `${spanDelta.toFixed(1)}° wider than`
  else if (spanDelta <= -2) spanWord = `${Math.abs(spanDelta).toFixed(1)}° narrower than`
  return [
    `In ${year}, records ran from ${lat(row.south)} to ${lat(row.north)}. That span is ${spanWord} the 2000–2004 average of ${base.span.toFixed(1)}°.`,
    `Summer sightings centered at ${lat(row.summer.med)}, ${against(row.summer.med, base.summer.med, 'early summer center')}. Winter sightings centered at ${lat(row.winter.med)}, ${against(row.winter.med, base.winter.med, 'early winter center')}.`,
  ]
}

/** Two sentences for one species, shaped by the season filter. */
export function speciesCopy(id, year, mode) {
  const species = brief.species.find((item) => item.id === id)
  const row = species?.years[String(year)]
  if (!species || !row) return ''
  const lines =
    mode === 'summer'
      ? summerLines(year, row, species.baseline)
      : mode === 'winter'
        ? winterLines(year, row, species.baseline)
        : generalLines(year, row, species.baseline)
  return lines.join(' ')
}

export function copyMode(summer, winter) {
  if (summer && !winter) return 'summer'
  if (winter && !summer) return 'winter'
  return 'general'
}

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

function monthMedian(records, year, month) {
  const lats = []
  for (const record of records) {
    if (record.year !== year || record.month !== month) continue
    if (!Number.isFinite(record.decimalLatitude)) continue
    lats.push(record.decimalLatitude)
  }
  if (!lats.length) return null
  lats.sort((a, b) => a - b)
  return lats[Math.floor((lats.length - 1) / 2)]
}

/** Months each species is on the move or settled. Overlaps are real. */
const SEASONS = {
  'barn-swallow': {
    spring: [2, 3, 4, 5],
    breed: [4, 5, 6, 7, 8],
    autumn: [8, 9, 10],
    winter: [9, 10, 11, 12, 1, 2],
  },
  'european-bee-eater': {
    spring: [3, 4],
    breed: [5, 6, 7],
    autumn: [8, 9],
    // Southern African birds can stay through spring. March–May stays winter
    // only when the sightings are still in the south.
    winter: [11, 12, 1, 2],
    lateWinter: [3, 4, 5],
  },
  'common-crane': {
    spring: [2, 3, 4],
    breed: [5, 6, 7, 8],
    autumn: [9, 10],
    winter: [11, 12, 1, 2],
  },
  'eurasian-blackcap': {
    spring: [3, 4, 5],
    breed: [5, 6, 7, 8],
    autumn: [8, 9, 10, 11],
    winter: [11, 12, 1, 2],
  },
  'blackpoll-warbler': {
    spring: [4, 5],
    breed: [5, 6, 7, 8],
    autumn: [9, 10],
    winter: [11, 12, 1, 2, 3],
  },
}

function has(months, month) {
  return months?.includes(month) ?? false
}

/** 'north' when this month's sightings sit nearer the summer center. */
function grounds(here, row) {
  if (here == null || !row?.summer || !row?.winter) return null
  const south = Math.abs(here - row.winter.med)
  const north = Math.abs(here - row.summer.med)
  if (Math.abs(south - north) < 3) return null
  return south < north ? 'south' : 'north'
}

function phaseFor(id, month, heading, here, row) {
  const calendar = SEASONS[id]
  if (!calendar) return 'breed'
  const spring = has(calendar.spring, month)
  const breed = has(calendar.breed, month)
  const autumn = has(calendar.autumn, month)
  const winter = has(calendar.winter, month)
  const place = grounds(here, row)

  if (has(calendar.lateWinter, month) && place === 'south' && heading !== 'north') {
    return 'winter'
  }
  if (heading === 'north' && spring) return 'spring'
  if (heading === 'south' && autumn) return 'autumn'
  if (breed && place !== 'south' && !(heading === 'south' && autumn)) return 'breed'
  if (autumn && winter && place == null) {
    if (heading === 'south' || month <= 10) return 'autumn'
    return 'winter'
  }
  if (autumn && place !== 'south') return 'autumn'
  if (winter && place !== 'north') return 'winter'
  if (spring) return 'spring'
  if (autumn) return 'autumn'
  if (breed) return 'breed'
  return 'winter'
}

function temperatureLine(year, furtherNorth) {
  const now = brief.temperature[String(year)]
  const previous = brief.temperature[String(year - 1)]
  if (!Number.isFinite(now)) return ''
  if (!Number.isFinite(previous)) {
    return now >= 0 ? 'Warmer than the old average.' : 'Cooler than the old average.'
  }
  const delta = now - previous
  if (Math.abs(delta) < 0.015) return 'Same warmth as last year.'
  if (delta > 0 && furtherNorth) return 'Warmer than before.'
  if (delta > 0) return 'Getting warmer.'
  return 'Cooler than last year.'
}

function seasonLine(phase, heading, shift) {
  if (phase === 'spring') {
    if (heading === 'north') return "I'm heading north to breed."
    if (heading === 'south') return "I'm still moving south."
    return "I'm on the spring flight."
  }
  if (phase === 'breed') {
    if (heading === 'north') return "I'm heading further north."
    if (heading === 'south') return "I'm heading further south."
    if (shift === 'north') return "I'm breeding further north."
    if (shift === 'south') return "I'm breeding further south."
    return "I'm here to breed."
  }
  if (phase === 'autumn') {
    if (heading === 'south') return "I'm heading south to winter."
    if (heading === 'north') return "I'm heading further north."
    return "I'm on the autumn flight."
  }
  if (heading === 'north' || shift === 'north') return "I'm wintering further north."
  if (heading === 'south' || shift === 'south') return "I'm wintering further south."
  return "I'm wintering here."
}

/**
 * Short first-person line for the bird currently being followed.
 * The season comes from that species' calendar, then the month's sightings.
 * Warmth comes from this year against the year before.
 */
export function followSpeech(id, year, month, records) {
  const species = brief.species.find((item) => item.id === id)
  if (!species || !records?.length || !Number.isFinite(year) || !Number.isFinite(month)) {
    return ''
  }

  const here = monthMedian(records, year, month)
  const previousMonth = month > 1 ? month - 1 : 12
  const previousYearForMonth = month > 1 ? year : year - 1
  const before = monthMedian(records, previousYearForMonth, previousMonth)
  const lastYear = monthMedian(records, year - 1, month)

  let heading = 'hold'
  if (here != null && before != null) {
    const delta = here - before
    if (delta >= 5) heading = 'north'
    else if (delta <= -5) heading = 'south'
  }

  let shift = 'same'
  if (here != null && lastYear != null) {
    const delta = here - lastYear
    if (delta >= 2) shift = 'north'
    else if (delta <= -2) shift = 'south'
  }

  const row = species.years[String(year)]
  const phase = phaseFor(id, month, heading, here, row)
  const season = seasonLine(phase, heading, shift)
  const temperature = temperatureLine(year, shift === 'north')
  return [season, temperature].filter(Boolean).join(' ')
}

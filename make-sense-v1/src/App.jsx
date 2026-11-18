import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import SpeciesSelector from './components/SpeciesSelector.jsx'
import Timeline, { PlayButton } from './components/Timeline.jsx'
import { FLOCK, SPECIES_CATALOG, TEMPERATURE, TIMELINE } from './config.js'
import { useSpeciesDatasets } from './hooks/useSpeciesDatasets.js'
import { useTemperatureData } from './hooks/useTemperatureData.js'
import {
  dotsFromOccurrenceCount,
  gbifMonthCount,
} from './utils/migrationFlock.js'
import './App.css'

const DEFAULT_SELECTED = [SPECIES_CATALOG[0].id, SPECIES_CATALOG[1].id]

/** Bar runs from under −20°C (top) to over 40°C (bottom). */
const TEMP_SCALE_TOP = -20
const TEMP_SCALE_BOTTOM = 40
const TEMP_SCALE_MARKS = [
  { t: -20, label: '<−20' },
  { t: -10, label: '−10' },
  { t: 0, label: '0' },
  { t: 10, label: '10' },
  { t: 20, label: '20' },
  { t: 30, label: '30' },
  { t: 40, label: '>40' },
]

function temperatureBarGradient() {
  const span = TEMP_SCALE_BOTTOM - TEMP_SCALE_TOP
  const stops = TEMPERATURE.colorStops
  const parts = stops.map((stop) => {
    const pct = ((stop.t - TEMP_SCALE_TOP) / span) * 100
    return `${stop.color} ${pct}%`
  })
  const last = stops[stops.length - 1]
  if (last && last.t < TEMP_SCALE_BOTTOM) parts.push(`${last.color} 100%`)
  return `linear-gradient(to bottom, ${parts.join(', ')})`
}

/** Months kept in play when a season filter is on. Null means every month. */
function seasonMonths(summer, winter) {
  if (!summer && !winter) return null
  const months = []
  if (winter) months.push(1)
  if (summer) months.push(7, 8)
  if (winter) months.push(12)
  return months
}

export default function App() {
  const [selectedIds, setSelectedIds] = useState(DEFAULT_SELECTED)
  const [followId, setFollowId] = useState(null)

  const toggleSpecies = useCallback((id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev
        return prev.filter((x) => x !== id)
      }
      return [...prev, id]
    })
  }, [])

  const toggleFollow = useCallback((id) => {
    setFollowId((prev) => (prev === id ? null : id))
  }, [])

  const followOnlyId =
    followId && !selectedIds.includes(followId) ? followId : null

  const selectedSpecies = useMemo(
    () =>
      selectedIds
        .map((id) => SPECIES_CATALOG.find((s) => s.id === id))
        .filter(Boolean),
    [selectedIds],
  )

  const { selectedEntries, loading, ready, errors, reload } =
    useSpeciesDatasets(selectedIds)
  const followQuery = useSpeciesDatasets(followOnlyId ? [followOnlyId] : [])
  const followEntry = followOnlyId ? followQuery.selectedEntries[0] : null
  const { pack: temperaturePack } = useTemperatureData()

  const [year, setYear] = useState(null)
  const [month, setMonth] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [summer, setSummer] = useState(false)
  const [winter, setWinter] = useState(false)
  /** Time already spent in the current month while playback was running. */
  const monthElapsedRef = useRef(0)
  /** Year step requested by a season filter, so the year change keeps that month. */
  const seasonStepRef = useRef(null)
  /** This year change should glide, not snap, because a season filter advanced it. */
  const seasonGlideRef = useRef(false)

  const availableYears = useMemo(() => {
    const set = new Set()
    for (const entry of selectedEntries) {
      if (entry.status !== 'ready' || !entry.data?.records) continue
      for (const r of entry.data.records) {
        if (r.year) set.add(r.year)
      }
    }
    return [...set].sort((a, b) => a - b)
  }, [selectedEntries])

  // Keep year when selection changes if still valid; otherwise reset preference.
  useEffect(() => {
    if (availableYears.length === 0) return
    if (year != null && availableYears.includes(year)) return
    const preferred = availableYears.includes(2015)
      ? 2015
      : availableYears[Math.floor(availableYears.length / 2)]
    setYear(preferred)
    setMonth(1)
  }, [availableYears, year])

  const activeYear = year ?? availableYears[0] ?? 2000
  const focusMonths = seasonMonths(summer, winter)
  const yearsRef = useRef(availableYears)
  yearsRef.current = availableYears

  useEffect(() => {
    seasonGlideRef.current = false
  })

  useEffect(() => {
    if (year == null || !ready) return
    monthElapsedRef.current = 0
    setPlaying(true)
    const step = seasonStepRef.current
    if (step && step.year === year) {
      seasonStepRef.current = null
      setMonth(step.month)
      return
    }
    const months = seasonMonths(summer, winter)
    setMonth(months ? months[0] : 1)
  }, [year, ready])

  // Turning a filter on leaves the current month when it still belongs,
  // otherwise glides to the next month that filter allows.
  useEffect(() => {
    const months = seasonMonths(summer, winter)
    if (!months || months.includes(month)) return
    const later = months.find((value) => value > month)
    monthElapsedRef.current = 0
    if (later) {
      setMonth(later)
      return
    }
    if (!availableYears.length) return
    const index = availableYears.indexOf(activeYear)
    const nextYear = availableYears[(index + 1) % availableYears.length]
    seasonStepRef.current = { year: nextYear, month: months[0] }
    seasonGlideRef.current = nextYear !== activeYear
    if (nextYear !== activeYear) setYear(nextYear)
    setMonth(months[0])
  }, [summer, winter])

  // Pause keeps the leftover time in this month, so play continues the same flight.
  useEffect(() => {
    if (!playing || !ready) return undefined
    const started = performance.now()
    const remaining = Math.max(
      0,
      TIMELINE.monthMs - monthElapsedRef.current,
    )
    let completed = false
    const id = window.setTimeout(() => {
      completed = true
      monthElapsedRef.current = 0
      const months = seasonMonths(summer, winter)
      if (!months) {
        setMonth((prev) => (prev >= 12 ? 1 : prev + 1))
        return
      }
      const index = months.indexOf(month)
      if (index >= 0 && index < months.length - 1) {
        setMonth(months[index + 1])
        return
      }
      if (!yearsRef.current.length) return
      const yearIndex = yearsRef.current.indexOf(activeYear)
      const nextYear = yearsRef.current[(yearIndex + 1) % yearsRef.current.length]
      seasonStepRef.current = { year: nextYear, month: months[0] }
      seasonGlideRef.current = nextYear !== activeYear
      if (nextYear !== activeYear) setYear(nextYear)
      setMonth(months[0])
    }, remaining)
    return () => {
      window.clearTimeout(id)
      if (!completed) {
        monthElapsedRef.current += performance.now() - started
      }
    }
  }, [playing, ready, month, activeYear, summer, winter])

  /** Keep flocks dense even when several species share the map. */
  const perSpeciesMaxDots = useMemo(() => {
    const n = Math.max(1, selectedIds.length)
    if (n === 1) return FLOCK.maxDots
    return Math.max(FLOCK.minDots, Math.round(FLOCK.maxDots * 0.85))
  }, [selectedIds.length])

  const flockSpecs = useMemo(() => {
    const entries = selectedEntries.filter(
      (e) => e.status === 'ready' && e.data && e.species,
    )
    if (
      followEntry &&
      followEntry.status === 'ready' &&
      followEntry.data &&
      followEntry.species &&
      !entries.some((e) => e.id === followEntry.id)
    ) {
      entries.push(followEntry)
    }

    return entries.map((entry) => {
        const records = entry.data.records
        const yearRecords = records.filter((r) => r.year === activeYear)
        const monthRecordCount = yearRecords.filter(
          (r) => r.month === month,
        ).length
        const gbifOccurrenceCount = gbifMonthCount(
          entry.data.meta,
          activeYear,
          month,
        )

        let flockSize = FLOCK.minDots
        if (gbifOccurrenceCount != null) {
          flockSize = dotsFromOccurrenceCount(gbifOccurrenceCount)
        } else if (monthRecordCount > 0) {
          flockSize = Math.min(
            FLOCK.maxDots,
            Math.max(FLOCK.minDots, monthRecordCount),
          )
        }
        flockSize = Math.min(flockSize, perSpeciesMaxDots)

        return {
          id: entry.id,
          color: entry.species.color,
          species: entry.species,
          meta: entry.data.meta,
          records,
          yearRecords,
          monthRecordCount,
          gbifOccurrenceCount,
          flockSize,
          yearRecordCount: yearRecords.length,
          totalCount: records.length,
        }
      })
  }, [selectedEntries, followEntry, activeYear, month, perSpeciesMaxDots])

  const mapFlocks = useMemo(
    () =>
      flockSpecs.map((f) => ({
        id: f.id,
        color: f.color,
        yearRecords: f.yearRecords,
        flockSize: f.flockSize,
      })),
    [flockSpecs],
  )

  const status = loading ? 'loading' : ready ? 'ready' : errors.length ? 'error' : 'idle'
  const errorMessage = errors.map((e) => e.error).filter(Boolean).join(' · ')

  const controlsDisabled = !ready && flockSpecs.length === 0

  return (
    <div className="app">
      <aside className="side">
        <div className="side__brand">
          <img
            className="side__logo"
            src="/logo_ver1.svg"
            alt="Bird Wide Web"
          />
          <p className="side__tagline">Where did the bird go?</p>
        </div>
        <SpeciesSelector
          selectedIds={selectedIds}
          onToggle={toggleSpecies}
          followId={followId}
          onFollowToggle={toggleFollow}
          disabled={false}
        />
        <a
          className="side__about"
          href="https://www.gbif.org/"
          target="_blank"
          rel="noopener noreferrer"
        >
          About data
        </a>
      </aside>

      <div className="map-slot">
        <MapView
          flocks={mapFlocks}
          year={activeYear}
          month={month}
          playing={playing}
          seasonGlide={seasonGlideRef.current}
          followId={followId}
          temperaturePack={temperaturePack}
        />
        <div className="map-controls">
          <div className="map-controls__stack">
            <PlayButton
              playing={playing}
              disabled={controlsDisabled}
              onToggle={() => setPlaying((value) => !value)}
            />
            <div
              className="temp-scale"
              role="img"
              aria-label="Temperature colors, from under −20 degrees Celsius at the top to over 40 degrees at the bottom"
            >
              <span
                className="temp-scale__bar"
                style={{ background: temperatureBarGradient() }}
              />
              <span className="temp-scale__marks">
                {TEMP_SCALE_MARKS.map((mark, index) => {
                  const pct =
                    ((mark.t - TEMP_SCALE_TOP) /
                      (TEMP_SCALE_BOTTOM - TEMP_SCALE_TOP)) *
                    100
                  const atEnd = index === 0 || index === TEMP_SCALE_MARKS.length - 1
                  return (
                    <span
                      key={mark.label}
                      className="temp-scale__mark"
                      style={{
                        top: `${pct}%`,
                        transform: atEnd
                          ? index === 0
                            ? 'none'
                            : 'translateY(-100%)'
                          : 'translateY(-50%)',
                      }}
                    >
                      {mark.label}
                    </span>
                  )
                })}
              </span>
            </div>
          </div>
          <div className="map-time">
            {TIMELINE.months[month - 1] ?? ''} {activeYear}
          </div>
          <button
            type="button"
            className={`map-season${summer ? ' is-on' : ''}`}
            aria-pressed={summer}
            disabled={controlsDisabled}
            onClick={() => setSummer((value) => !value)}
          >
            Summer
          </button>
          <button
            type="button"
            className={`map-season${winter ? ' is-on' : ''}`}
            aria-pressed={winter}
            disabled={controlsDisabled}
            onClick={() => setWinter((value) => !value)}
          >
            Winter
          </button>
        </div>
      </div>

      <div className="year-dock">
        <Timeline
          year={activeYear}
          onYearChange={setYear}
          month={month}
          availableYears={availableYears}
          selectedIds={selectedIds}
          focusMonths={focusMonths}
          disabled={controlsDisabled}
        />
      </div>

      {loading && (
        <div className="status-banner status-banner--loading" role="status">
          <strong>Loading local datasets</strong>
          <span>
            Reading {selectedSpecies.map((s) => s.commonName).join(', ')}…
          </span>
        </div>
      )}

      {status === 'error' && errors.length > 0 && flockSpecs.length === 0 && (
        <div className="status-banner status-banner--error" role="alert">
          <strong>Could not load local data</strong>
          <span>{errorMessage}</span>
          <button type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

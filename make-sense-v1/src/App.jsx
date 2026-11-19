import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import Splash from './components/Splash.jsx'
import SpeciesSelector from './components/SpeciesSelector.jsx'
import Timeline, { PlayButton, PlaySpeed } from './components/Timeline.jsx'
import { FLOCK, SPECIES_CATALOG, TEMPERATURE, TIMELINE } from './config.js'
import { copyMode, followSpeech, overallCopy, speciesCopy } from './utils/migrationCopy.js'
import { useGentleHover } from './hooks/useGentleHover.js'
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

const BIRDCAST_EXPAND_MS = 340

function useTypewriter(text, active) {
  const [shown, setShown] = useState('')

  useEffect(() => {
    if (!active) {
      setShown('')
      return undefined
    }
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || !text) {
      setShown(text)
      return undefined
    }
    let index = 0
    setShown('')
    const timer = window.setInterval(() => {
      index += 1
      setShown(text.slice(0, index))
      if (index >= text.length) window.clearInterval(timer)
    }, 16)
    return () => window.clearInterval(timer)
  }, [text, active])

  return shown
}

function SideFold({ label, children }) {
  const buttonRef = useGentleHover(false)
  const shellRef = useRef(null)
  const innerRef = useRef(null)
  const closedSize = useRef({ w: 0, h: 0 })
  const [open, setOpen] = useState(false)
  const [grown, setGrown] = useState(false)

  useEffect(() => {
    if (open) setGrown(true)
  }, [open])

  useLayoutEffect(() => {
    const shell = shellRef.current
    const inner = innerRef.current
    if (!shell || !inner) return undefined
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!grown) {
      inner.style.width = ''
      shell.style.width = ''
      shell.style.height = ''
      closedSize.current = { w: shell.offsetWidth, h: shell.offsetHeight }
      const restore = window.setTimeout(() => {
        if (shellRef.current) shellRef.current.style.transition = ''
      }, 0)
      return () => window.clearTimeout(restore)
    }

    const parentW = shell.parentElement?.clientWidth ?? shell.offsetWidth

    if (!open) {
      shell.style.transition = 'none'
      setGrown(false)
      return undefined
    }

    if (reduced) {
      inner.style.width = `${parentW}px`
      shell.style.width = `${parentW}px`
      shell.style.height = 'auto'
      return undefined
    }

    shell.style.transition = 'none'
    inner.style.width = `${parentW}px`
    shell.style.width = `${parentW}px`
    shell.style.height = 'auto'
    const fullH = shell.offsetHeight
    const startW = closedSize.current.w || shell.offsetWidth
    const startH = closedSize.current.h || shell.offsetHeight
    shell.style.width = `${startW}px`
    shell.style.height = `${startH}px`
    shell.offsetHeight
    shell.style.transition = ''
    const frame = window.requestAnimationFrame(() => {
      shell.style.width = `${parentW}px`
      shell.style.height = `${fullH}px`
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, grown])

  return (
    <div className={`side-fold${grown ? ' is-open' : ''}`} ref={shellRef}>
      <div className="side-fold__inner" ref={innerRef}>
        <button
          type="button"
          ref={buttonRef}
          className={`side-fold__button${open ? ' is-on' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {label}
        </button>
        <div className="side-fold__body">{children}</div>
      </div>
    </div>
  )
}

function BirdCast({ open, disabled, text, bird, onToggle }) {
  const toggleRef = useGentleHover(disabled)
  const shellRef = useRef(null)
  const innerRef = useRef(null)
  const closedSize = useRef({ w: 0, h: 0 })
  const wasGrown = useRef(false)
  const targetHRef = useRef(0)
  const [grown, setGrown] = useState(false)
  const [armed, setArmed] = useState(false)
  const typed = useTypewriter(text, open && armed)

  useEffect(() => {
    if (!open) {
      setGrown(false)
      setArmed(false)
      return undefined
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setGrown(true)
      setArmed(true)
      return undefined
    }
    setGrown(true)
    setArmed(false)
    return undefined
  }, [open])

  useLayoutEffect(() => {
    const shell = shellRef.current
    const inner = innerRef.current
    if (!shell || !inner) return undefined

    if (!grown) {
      inner.style.width = ''
      shell.style.width = ''
      shell.style.height = ''
      closedSize.current = { w: shell.offsetWidth, h: shell.offsetHeight }
      wasGrown.current = false
      return undefined
    }

    const parent = shell.parentElement?.clientWidth ?? 460
    const targetW = Math.min(460, Math.max(closedSize.current.w, parent - 32))
    shell.style.transition = 'none'
    inner.style.width = `${targetW}px`
    shell.style.width = `${targetW}px`
    shell.style.height = 'auto'

    const maxH = Math.max(
      closedSize.current.h,
      (shell.parentElement?.clientHeight ?? targetW) - 32,
    )
    const fullH = Math.min(shell.offsetHeight, maxH)
    targetHRef.current = fullH

    if (wasGrown.current) {
      const locked = shell.getBoundingClientRect().height
      shell.style.height = `${locked}px`
      shell.offsetHeight
      shell.style.transition = ''
      const frame = window.requestAnimationFrame(() => {
        shell.style.height = `${fullH}px`
      })
      return () => window.cancelAnimationFrame(frame)
    }

    wasGrown.current = true
    shell.style.width = `${closedSize.current.w}px`
    shell.style.height = `${closedSize.current.h}px`
    shell.offsetHeight
    shell.style.transition = ''
    let played = false
    const frame = window.requestAnimationFrame(() => {
      played = true
      shell.style.width = `${targetW}px`
      shell.style.height = `${fullH}px`
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (!played) wasGrown.current = false
    }
  }, [grown, text, bird])

  useEffect(() => {
    if (!open || !grown) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setArmed(true)
      return undefined
    }
    const shell = shellRef.current
    if (!shell) return undefined
    let settled = false
    const finish = () => {
      if (settled || !shellRef.current) return
      const height = shellRef.current.getBoundingClientRect().height
      const goal = targetHRef.current
      if (goal > 0 && height < goal - 2) return
      settled = true
      setArmed(true)
    }
    const onEnd = (event) => {
      if (event.target === shell && event.propertyName === 'height') finish()
    }
    shell.addEventListener('transitionend', onEnd)
    const poll = window.setInterval(finish, 40)
    const giveUp = window.setTimeout(() => {
      if (settled) return
      settled = true
      setArmed(true)
    }, 800)
    return () => {
      shell.removeEventListener('transitionend', onEnd)
      window.clearInterval(poll)
      window.clearTimeout(giveUp)
    }
  }, [open, grown])

  return (
    <div className={`map-birdcast${grown ? ' is-open' : ''}`} ref={shellRef}>
      <div className="map-birdcast__inner" ref={innerRef}>
        <div className="map-birdcast__bar">
          <button
            type="button"
            ref={toggleRef}
            className={`map-season map-birdcast__toggle${open ? ' is-on' : ''}`}
            aria-pressed={open}
            aria-expanded={open}
            disabled={disabled}
            onClick={onToggle}
          >
            bird-cast
          </button>
          {grown && bird && (
            <div className="map-birdcast__name" style={{ backgroundColor: bird.color }}>
              {bird.commonName}
            </div>
          )}
        </div>
        <div className="map-birdcast__body">
          <p className="map-birdcast__text">
            <span className="map-birdcast__typed">{typed}</span>
            <span className="map-birdcast__reserve" aria-hidden="true">
              {text}
            </span>
          </p>
        </div>
      </div>
    </div>
  )
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
    const turningOn = followId !== id
    setFollowId(turningOn ? id : null)
    if (!turningOn) return
    setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [followId])

  // Loop that bird's call while the photo follow is on; stop when follow ends.
  useEffect(() => {
    if (!followId) return undefined
    const soundUrl = SPECIES_CATALOG.find((species) => species.id === followId)
      ?.soundUrl
    if (!soundUrl) return undefined
    const audio = new Audio(soundUrl)
    audio.loop = true
    audio.play().catch(() => {})
    return () => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [followId])

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
  const [playSpeed, setPlaySpeed] = useState(1)
  const [summer, setSummer] = useState(false)
  const [winter, setWinter] = useState(false)
  const [birdCast, setBirdCast] = useState(true)
  const [showSplash, setShowSplash] = useState(true)
  /** Time already spent in the current month while playback was running. */
  const monthElapsedRef = useRef(0)
  /** Year step requested by a season filter, so the year change keeps that month. */
  const seasonStepRef = useRef(null)
  /** Month chosen on the slider, so a year change does not snap back to January. */
  const scrubRef = useRef(null)
  /** This year change should glide, not snap, because playback advanced into it. */
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
  const mode = copyMode(summer, winter)
  const overall = useMemo(() => overallCopy(activeYear), [activeYear])
  const castText = followId
    ? speciesCopy(followId, activeYear, mode)
    : [overall.temperature, overall.migration].filter(Boolean).join(' ')
  const followedBird = followId
    ? SPECIES_CATALOG.find((species) => species.id === followId) ?? null
    : null
  const yearsRef = useRef(availableYears)
  yearsRef.current = availableYears

  useEffect(() => {
    seasonGlideRef.current = false
  })

  useEffect(() => {
    if (year == null || !ready) return
    monthElapsedRef.current = 0
    setPlaying(true)
    const scrub = scrubRef.current
    if (scrub && scrub.year === year) {
      scrubRef.current = null
      setMonth(scrub.month)
      return
    }
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
    const speed = playSpeed
    const remaining = Math.max(
      0,
      (TIMELINE.monthMs - monthElapsedRef.current) / speed,
    )
    let completed = false
    const id = window.setTimeout(() => {
      completed = true
      monthElapsedRef.current = 0
      const months = seasonMonths(summer, winter)
      if (!months) {
        if (month < 12) {
          setMonth(month + 1)
          return
        }
        const years = yearsRef.current
        const yearIndex = years.indexOf(activeYear)
        const nextYear =
          yearIndex < 0 ? activeYear : years[(yearIndex + 1) % years.length]
        if (!years.length || nextYear === activeYear) {
          setMonth(1)
          return
        }
        seasonStepRef.current = { year: nextYear, month: 1 }
        seasonGlideRef.current = true
        setYear(nextYear)
        setMonth(1)
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
        monthElapsedRef.current += (performance.now() - started) * speed
      }
    }
  }, [playing, ready, month, activeYear, summer, winter, playSpeed])

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
        name: f.species?.commonName ?? '',
      })),
    [flockSpecs],
  )

  const followLine = useMemo(() => {
    if (!followId) return ''
    const spec = flockSpecs.find((flock) => flock.id === followId)
    return followSpeech(followId, activeYear, month, spec?.records)
  }, [followId, activeYear, month, flockSpecs])

  const status = loading ? 'loading' : ready ? 'ready' : errors.length ? 'error' : 'idle'
  const errorMessage = errors.map((e) => e.error).filter(Boolean).join(' · ')

  const controlsDisabled = !ready && flockSpecs.length === 0
  const summerHoverRef = useGentleHover(controlsDisabled)
  const winterHoverRef = useGentleHover(controlsDisabled)

  return (
    <div className="app">
      {showSplash && <Splash onDone={() => setShowSplash(false)} />}
      <aside className="side">
        <div className="side__brand">
          <div className="side__lockup">
            <img
              className="side__logo"
              src="/logo_ver1.svg"
              alt="Bird Wide Web"
            />
            <img className="side__mark" src="/favicon.svg" alt="" />
          </div>
          {/* <p className="side__tagline">Where did the bird go?</p> */}
        </div>
        <div className="side__notes">
          <p className="side__intro">
            Birds&apos; migration pattern is changing. One of the reasons is global
            warming, as the temperature is increasing. In Bird Wide Web, see how
            they went north or south compared with previous years.
          </p>
          <SideFold label="How to interact">
            <p>
              Click the circle checkbox at the top right of the bird card to see
              birds on the map. You can also click the image to follow them.
            </p>
          </SideFold>
          <SideFold label="About the source">
            <p>
              The website does not include the exact migration routes. Rather,
              the visualization is based on the occurrences.
            </p>
            <p>
              The records come from GBIF, 2000 to 2025. {' '} <a href="https://www.gbif.org/" target="_blank" rel="noopener noreferrer">GBIF</a> holds 25,529,876
              coordinate records for these five species. That full set is not
              on the map. It was trimmed to an even sample of about 16
              sightings a month: 24,826 records for barn swallow, European
              bee-eater, common crane, Eurasian blackcap, and blackpoll
              warbler. Each month is that sample, not a tracked route.
            </p>
            <p>
              The map is {' '} <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a>, with Esri street tiles. The heat colors come
              from temperature.json: NCEP/NCAR monthly mean air temperature, in
              degrees Celsius. The year-to-year temperature in the writing is
              NASA GISTEMP v4, compared with the 1951–1980 average.
            </p>
            <p>
              The photographs on the bird cards are from{' '}
              <a
                href="https://ebird.org/home"
                target="_blank"
                rel="noopener noreferrer"
              >
                eBird
              </a>
              .
            </p>
          </SideFold>
        </div>
        <SpeciesSelector
          selectedIds={selectedIds}
          onToggle={toggleSpecies}
          followId={followId}
          onFollowToggle={toggleFollow}
          disabled={false}
        />
        <p className="side__about">This website was created during Pascal Wicht's 4-day long workshop "Make Sense", November 16-19 2026, at ECAL DXD, in Lausanne, Switzerland. As a pigeon lover, nature lover, designer, I wanted to show how temperatures affected occurences of birds. For more information about me, click my <a href="https://www.instagram.com/pkg_one/">instagram</a>.</p>
        
      </aside>

      <div className="stage">
      <div className="map-slot">
        <MapView
          flocks={mapFlocks}
          year={activeYear}
          month={month}
          playing={playing}
          playSpeed={playSpeed}
          seasonGlide={seasonGlideRef.current}
          followId={followId}
          followSpeech={followLine}
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
          <PlaySpeed
            speed={playSpeed}
            disabled={controlsDisabled}
            onChange={setPlaySpeed}
          />
          <div className="map-time">
            {TIMELINE.months[month - 1] ?? ''} {activeYear}
        </div>
        <button
            type="button"
            ref={summerHoverRef}
            className={`map-season${summer ? ' is-on' : ''}`}
            aria-pressed={summer}
            disabled={controlsDisabled}
            onClick={() => setSummer((value) => !value)}
          >
            <img className="map-season__icon" src="/icon_summer.svg" alt="" />
            Summer
          </button>
          <button
            type="button"
            ref={winterHoverRef}
            className={`map-season${winter ? ' is-on' : ''}`}
            aria-pressed={winter}
            disabled={controlsDisabled}
            onClick={() => setWinter((value) => !value)}
          >
            <img className="map-season__icon" src="/icon_winter.svg" alt="" />
            Winter
          </button>
        </div>
        <BirdCast
          open={birdCast}
          disabled={controlsDisabled}
          text={castText}
          bird={followedBird}
          onToggle={() => setBirdCast((value) => !value)}
        />
      </div>

      <div className="bottom-dock">
      <p className="bottom-dock__title">The shift in the northernmost line</p>
      <div className="year-dock">
        <Timeline
          year={activeYear}
          month={month}
          onTimeChange={(nextYear, nextMonth) => {
            monthElapsedRef.current = 0
            if (nextYear === activeYear) {
              setMonth(nextMonth)
              return
            }
            scrubRef.current = { year: nextYear, month: nextMonth }
            setYear(nextYear)
            setMonth(nextMonth)
          }}
          availableYears={availableYears}
          selectedIds={selectedIds}
          focusMonths={focusMonths}
          disabled={controlsDisabled}
        />
      </div>
      </div>
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

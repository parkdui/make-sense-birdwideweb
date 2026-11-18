import { useEffect, useMemo, useRef, useState } from 'react'
import { GBIF, SPECIES_CATALOG } from '../config.js'
import { useGentleHover } from '../hooks/useGentleHover.js'
import { useNorthernmost } from '../hooks/useNorthernmost.js'

const COLOR_BY_ID = Object.fromEntries(
  SPECIES_CATALOG.map((species) => [species.id, species.color]),
)

function latitudeDomain(pack) {
  let min = Infinity
  let max = -Infinity
  for (const species of pack?.species ?? []) {
    for (const block of species.years ?? []) {
      for (const entry of block.months ?? []) {
        const lat = entry.coordinate?.decimalLatitude
        if (!Number.isFinite(lat)) continue
        if (lat < min) min = lat
        if (lat > max) max = lat
      }
    }
  }
  if (!Number.isFinite(min) || min === max) return { min: 0, max: 1 }
  const pad = (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

/**
 * One dot per month: horizontal position is time, vertical position is
 * how far north that month's northernmost sighting sits.
 */
function NorthernDots({
  pack,
  selectedIds,
  year,
  month,
  first,
  last,
  focusMonths,
}) {
  const domain = useMemo(() => latitudeDomain(pack), [pack])
  const span = Math.max(1, last - first + 1)

  const dots = useMemo(() => {
    if (!pack?.species) return []
    const selected = new Set(selectedIds)
    const out = []
    for (const species of pack.species) {
      if (!selected.has(species.id)) continue
      const color = COLOR_BY_ID[species.id]
      if (!color) continue
      for (const block of species.years ?? []) {
        for (const entry of block.months ?? []) {
          const lat = entry.coordinate?.decimalLatitude
          if (!Number.isFinite(lat)) continue
          const t = (block.year - first + (entry.month - 0.5) / 12) / span
          const north =
            (lat - domain.min) / (domain.max - domain.min)
          out.push({
            key: `${species.id}-${block.year}-${entry.month}`,
            x: Math.min(100, Math.max(0, t * 100)),
            y: Math.min(100, Math.max(0, (1 - north) * 100)),
            color,
            current: block.year === year && entry.month === month,
            quiet: Array.isArray(focusMonths) && !focusMonths.includes(entry.month),
          })
        }
      }
    }
    out.sort((a, b) => Number(a.current) - Number(b.current))
    return out
  }, [pack, selectedIds, year, month, first, span, domain, focusMonths])

  const series = useMemo(() => {
    if (!pack?.species) return []
    const selected = new Set(selectedIds)
    const out = []
    for (const species of pack.species) {
      if (!selected.has(species.id)) continue
      const color = COLOR_BY_ID[species.id]
      if (!color) continue
      const points = []
      const years = [...(species.years ?? [])].sort((a, b) => a.year - b.year)
      for (const block of years) {
        const months = [...(block.months ?? [])].sort((a, b) => a.month - b.month)
        for (const entry of months) {
          const lat = entry.coordinate?.decimalLatitude
          if (!Number.isFinite(lat)) continue
          const t = (block.year - first + (entry.month - 0.5) / 12) / span
          const north = (lat - domain.min) / (domain.max - domain.min)
          points.push({
            x: Math.min(100, Math.max(0, t * 100)),
            y: Math.min(100, Math.max(0, (1 - north) * 100)),
            quiet: Array.isArray(focusMonths) && !focusMonths.includes(entry.month),
          })
        }
      }
      if (points.length > 1) out.push({ id: species.id, color, points })
    }
    return out
  }, [pack, selectedIds, first, span, domain, focusMonths])

  return (
    <div className="timeline__dots" aria-hidden="true">
      <svg
        className="timeline__lines"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {series.map((line) =>
          line.points.slice(1).map((point, index) => {
            const prev = line.points[index]
            const quiet = prev.quiet || point.quiet
            return (
              <line
                key={`${line.id}-${index}`}
                x1={prev.x}
                y1={prev.y}
                x2={point.x}
                y2={point.y}
                stroke={line.color}
                strokeOpacity={quiet ? 0.18 : 0.9}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            )
          }),
        )}
      </svg>
      {dots.map((dot) => (
        <span
          key={dot.key}
          className={`timeline__dot${dot.current ? ' is-current' : ''}${dot.quiet ? ' is-dim' : ''}`}
          style={{
            left: `${dot.x}%`,
            top: `${dot.y}%`,
            background: dot.color,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Year slider under the map. Months advance only while playback is running.
 */
export default function Timeline({
  year,
  onYearChange,
  month,
  availableYears,
  selectedIds = [],
  focusMonths = null,
  disabled = false,
}) {
  const years = useMemo(() => {
    if (availableYears?.length) return availableYears
    const list = []
    for (let y = GBIF.yearStart; y <= GBIF.yearEnd; y += 1) list.push(y)
    return list
  }, [availableYears])

  const first = years[0]
  const last = years[years.length - 1]
  const northernmost = useNorthernmost()

  return (
    <section className="timeline" aria-label="Year timeline">
      <div className="timeline__year-row">
        <div className="timeline__year-start">
          <span className="timeline__lat-index">Latitude N</span>
          <span className="timeline__year-end">{first}</span>
        </div>
        <div className="timeline__plot">
          <NorthernDots
            pack={northernmost}
            selectedIds={selectedIds}
            year={year}
            month={month}
            first={first}
            last={last}
            focusMonths={focusMonths}
          />
          <input
            className="timeline__year-slider"
            type="range"
            min={first}
            max={last}
            step={1}
            value={year}
            disabled={disabled}
            aria-label="Select year"
            aria-valuetext={`${year}, month ${month}`}
            onChange={(e) => onYearChange(Number(e.target.value))}
          />
        </div>
        <span className="timeline__year-end">{last}</span>
      </div>
    </section>
  )
}

export const PLAY_SPEEDS = [0.5, 1, 1.5, 2]

export function PlaySpeed({ speed, disabled, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useGentleHover(disabled)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="map-speed" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="map-speed__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        play speed: {speed.toFixed(1)}x
      </button>
      {open && (
        <ul className="map-speed__menu" role="listbox" aria-label="Play speed">
          {PLAY_SPEEDS.map((value) => (
            <li key={value}>
              <button
                type="button"
                role="option"
                aria-selected={value === speed}
                className={value === speed ? 'is-on' : undefined}
                onClick={() => {
                  onChange(value)
                  setOpen(false)
                }}
              >
                {value.toFixed(1)}x
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function PlayButton({ playing, disabled, onToggle }) {
  const ref = useGentleHover(disabled)
  return (
    <button
      type="button"
      ref={ref}
      className="map-play"
      onClick={onToggle}
      disabled={disabled}
      aria-label={playing ? 'Pause migration animation' : 'Play migration animation'}
      aria-pressed={playing}
    >
      {playing ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5-11-6.5z" />
        </svg>
      )}
    </button>
  )
}

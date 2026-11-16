import { useEffect, useMemo, useState } from 'react'
import { GBIF, TIMELINE } from '../config.js'

/**
 * Year selector + auto-advancing Jan–Dec month slider.
 * Flock size is fixed from January record count for the year.
 */
export default function Timeline({
  year,
  onYearChange,
  month,
  onMonthChange,
  flockSize,
  monthRecordCount,
  yearRecordCount,
  availableYears,
  disabled = false,
}) {
  const [playing, setPlaying] = useState(false)

  const years = useMemo(() => {
    if (availableYears?.length) return availableYears
    const list = []
    for (let y = GBIF.yearStart; y <= GBIF.yearEnd; y += 1) list.push(y)
    return list
  }, [availableYears])

  // Selecting a year restarts the migration animation from January.
  useEffect(() => {
    if (disabled) return
    onMonthChange(1)
    setPlaying(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, disabled])

  useEffect(() => {
    if (!playing || disabled) return undefined

    const id = window.setInterval(() => {
      onMonthChange((prev) => (prev >= 12 ? 1 : prev + 1))
    }, TIMELINE.monthMs)

    return () => window.clearInterval(id)
  }, [playing, disabled, onMonthChange])

  useEffect(() => {
    if (disabled) setPlaying(false)
  }, [disabled])

  const monthName = TIMELINE.months[month - 1]

  const changeYear = (nextYear) => {
    onYearChange(nextYear)
  }

  return (
    <section className="timeline" aria-label="Year and month timeline">
      <div className="timeline__header">
        <div className="timeline__month">
          <span className="timeline__month-label">Selected year</span>
          <strong>{year}</strong>
        </div>
        <div className="timeline__month">
          <span className="timeline__month-label">Month</span>
          <strong>{monthName}</strong>
        </div>
        <div className="timeline__count">
          <span className="timeline__month-label">Dots</span>
          <strong>{flockSize.toLocaleString()}</strong>
        </div>
      </div>

      <div className="timeline__year-row">
        <label className="timeline__year-label" htmlFor="year-select">
          Year
        </label>
        <select
          id="year-select"
          className="timeline__year-select"
          value={year}
          disabled={disabled}
          onChange={(e) => changeYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <input
          className="timeline__year-slider"
          type="range"
          min={years[0]}
          max={years[years.length - 1]}
          step={1}
          value={year}
          disabled={disabled}
          aria-label="Select year"
          onChange={(e) => changeYear(Number(e.target.value))}
        />
      </div>

      <div className="timeline__controls">
        <button
          type="button"
          className="timeline__play"
          onClick={() => setPlaying((p) => !p)}
          disabled={disabled}
          aria-label={playing ? 'Pause migration animation' : 'Play migration animation'}
        >
          {playing ? 'Pause' : 'Play'}
        </button>

        <input
          className="timeline__slider"
          type="range"
          min={1}
          max={12}
          step={1}
          value={month}
          disabled={disabled}
          aria-label="Month slider"
          aria-valuetext={monthName}
          onChange={(e) => {
            setPlaying(false)
            onMonthChange(Number(e.target.value))
          }}
        />
      </div>

      <div className="timeline__months" role="list">
        {TIMELINE.months.map((name, index) => {
          const value = index + 1
          const active = value === month
          return (
            <button
              key={name}
              type="button"
              role="listitem"
              className={`timeline__chip${active ? ' is-active' : ''}`}
              disabled={disabled}
              aria-pressed={active}
              onClick={() => {
                setPlaying(false)
                onMonthChange(value)
              }}
            >
              {name.slice(0, 3)}
            </button>
          )
        })}
      </div>

      <p className="timeline__note">
        {flockSize.toLocaleString()} dots leave red trails toward {monthName} (
        {monthRecordCount} records). Year total:{' '}
        {yearRecordCount.toLocaleString()}.
      </p>
    </section>
  )
}

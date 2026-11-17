import { useEffect, useMemo, useState } from 'react'
import InfoPanel from './components/InfoPanel.jsx'
import Legend from './components/Legend.jsx'
import MapView from './components/MapView.jsx'
import SpeciesSelector from './components/SpeciesSelector.jsx'
import Timeline from './components/Timeline.jsx'
import { FLOCK, SPECIES_CATALOG } from './config.js'
import { useLocalDataset } from './hooks/useLocalDataset.js'
import { useTemperatureData } from './hooks/useTemperatureData.js'
import {
  dotsFromOccurrenceCount,
  gbifMonthCount,
} from './utils/migrationFlock.js'
import './App.css'

export default function App() {
  const [speciesId, setSpeciesId] = useState(SPECIES_CATALOG[0].id)

  const activeSpecies =
    SPECIES_CATALOG.find((s) => s.id === speciesId) ?? SPECIES_CATALOG[0]

  const { status, error, data, reload } = useLocalDataset(
    activeSpecies.datasetUrl,
    activeSpecies.fetchScript,
  )
  const { status: tempStatus, pack: temperaturePack } = useTemperatureData()

  const [year, setYear] = useState(null)
  const [month, setMonth] = useState(1)

  const records = data?.records ?? []

  const availableYears = useMemo(() => {
    const set = new Set(records.map((r) => r.year).filter(Boolean))
    return [...set].sort((a, b) => a - b)
  }, [records])

  // Reset year/month when species dataset changes
  useEffect(() => {
    setYear(null)
    setMonth(1)
  }, [speciesId])

  useEffect(() => {
    if (status !== 'ready' || availableYears.length === 0) return
    if (year != null && availableYears.includes(year)) return
    const preferred = availableYears.includes(2015)
      ? 2015
      : availableYears[Math.floor(availableYears.length / 2)]
    setYear(preferred)
    setMonth(1)
  }, [status, availableYears, year])

  const activeYear = year ?? availableYears[0] ?? 2000

  const yearRecords = useMemo(
    () => records.filter((r) => r.year === activeYear),
    [records, activeYear],
  )

  const monthRecordCount = useMemo(
    () => yearRecords.filter((r) => r.month === month).length,
    [yearRecords, month],
  )

  const gbifOccurrenceCount = useMemo(
    () => gbifMonthCount(data?.meta, activeYear, month),
    [data?.meta, activeYear, month],
  )

  const flockSize = useMemo(() => {
    if (gbifOccurrenceCount != null) {
      return dotsFromOccurrenceCount(gbifOccurrenceCount)
    }
    // Fallback before month-count enrichment: clamp local sample size.
    if (monthRecordCount > 0) {
      return Math.min(
        FLOCK.maxDots,
        Math.max(FLOCK.minDots, monthRecordCount),
      )
    }
    return FLOCK.minDots
  }, [gbifOccurrenceCount, monthRecordCount])

  const globalAnomaly =
    temperaturePack?.getSeriesAnomaly(activeYear, month) ?? null

  return (
    <div className="app">
      <MapView
        speciesId={activeSpecies.id}
        yearRecords={yearRecords}
        year={activeYear}
        month={month}
        flockSize={flockSize}
        temperaturePack={temperaturePack}
      />

      <div className="app__overlay">
        <div className="app__top">
          <SpeciesSelector
            speciesId={activeSpecies.id}
            onSpeciesChange={setSpeciesId}
            disabled={status === 'loading'}
          />
          <InfoPanel
            year={activeYear}
            month={month}
            visibleCount={flockSize}
            monthRecordCount={monthRecordCount}
            gbifOccurrenceCount={gbifOccurrenceCount}
            yearRecordCount={yearRecords.length}
            totalCount={records.length}
            meta={data?.meta}
            speciesInfo={activeSpecies}
            temperatureMeta={temperaturePack?.meta}
            globalAnomaly={globalAnomaly}
            tempStatus={tempStatus}
            status={status}
          />
        </div>

        <div className="app__bottom">
          <Legend flockSize={flockSize} globalAnomaly={globalAnomaly} />
          <Timeline
            year={activeYear}
            onYearChange={setYear}
            month={month}
            onMonthChange={setMonth}
            flockSize={flockSize}
            monthRecordCount={monthRecordCount}
            yearRecordCount={yearRecords.length}
            availableYears={availableYears}
            disabled={status !== 'ready'}
          />
        </div>
      </div>

      {status === 'loading' && (
        <div className="status-banner status-banner--loading" role="status">
          <strong>Loading local dataset</strong>
          <span>
            Reading {activeSpecies.commonName} sample from{' '}
            {activeSpecies.datasetUrl}…
          </span>
        </div>
      )}

      {status === 'error' && (
        <div className="status-banner status-banner--error" role="alert">
          <strong>Could not load local data</strong>
          <span>{error}</span>
          <button type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

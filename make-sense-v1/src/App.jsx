import { useEffect, useMemo, useState } from 'react'
import InfoPanel from './components/InfoPanel.jsx'
import Legend from './components/Legend.jsx'
import MapView from './components/MapView.jsx'
import Timeline from './components/Timeline.jsx'
import { useLocalDataset } from './hooks/useLocalDataset.js'
import { useTemperatureData } from './hooks/useTemperatureData.js'
import { desiredFlockSize } from './utils/migrationFlock.js'
import './App.css'

export default function App() {
  const { status, error, data, reload } = useLocalDataset()
  const { status: tempStatus, pack: temperaturePack } = useTemperatureData()

  const [year, setYear] = useState(null)
  const [month, setMonth] = useState(1)

  const records = data?.records ?? []

  const availableYears = useMemo(() => {
    const set = new Set(records.map((r) => r.year).filter(Boolean))
    return [...set].sort((a, b) => a - b)
  }, [records])

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

  const januaryCount = useMemo(
    () => yearRecords.filter((r) => r.month === 1).length,
    [yearRecords],
  )

  const flockSize = desiredFlockSize(januaryCount)

  const monthRecordCount = useMemo(
    () => yearRecords.filter((r) => r.month === month).length,
    [yearRecords, month],
  )

  const globalAnomaly =
    temperaturePack?.getSeriesAnomaly(activeYear, month) ?? null

  return (
    <div className="app">
      <MapView
        yearRecords={yearRecords}
        year={activeYear}
        month={month}
        temperaturePack={temperaturePack}
      />

      <div className="app__overlay">
        <InfoPanel
          year={activeYear}
          month={month}
          visibleCount={flockSize}
          januaryCount={januaryCount}
          monthRecordCount={monthRecordCount}
          yearRecordCount={yearRecords.length}
          totalCount={records.length}
          meta={data?.meta}
          temperatureMeta={temperaturePack?.meta}
          globalAnomaly={globalAnomaly}
          tempStatus={tempStatus}
          status={status}
        />

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
          <span>Reading curated GBIF sample from /data…</span>
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

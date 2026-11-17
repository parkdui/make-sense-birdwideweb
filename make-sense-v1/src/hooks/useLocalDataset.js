import { useCallback, useEffect, useRef, useState } from 'react'
import { isValidOccurrence } from '../utils/occurrences.js'

/**
 * Load a curated local GBIF sample (no live API on startup).
 * @param {string} datasetUrl path under /public, e.g. /data/hirundo-rustica.json
 * @param {string} [fetchHint] npm script name shown in error messages
 */
export function useLocalDataset(datasetUrl, fetchHint = 'npm run fetch:barn-swallow') {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestRef.current
    setStatus('loading')
    setError(null)
    setData(null)

    if (!datasetUrl) {
      setStatus('error')
      setError('No dataset URL configured for this species.')
      return
    }

    try {
      const response = await fetch(datasetUrl, { cache: 'no-cache' })
      if (!response.ok) {
        throw new Error(
          `Could not load local dataset (${response.status}). Run: ${fetchHint}`,
        )
      }

      const json = await response.json()
      if (id !== requestRef.current) return

      const records = Array.isArray(json.records)
        ? json.records.filter(isValidOccurrence)
        : []

      if (records.length === 0) {
        throw new Error(
          `Local dataset contained no valid occurrence records. Re-run ${fetchHint}.`,
        )
      }

      setData({
        meta: json.meta ?? null,
        species: json.species ?? null,
        records,
      })
      setStatus('ready')
    } catch (err) {
      if (id !== requestRef.current) return
      setStatus('error')
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load the local occurrence dataset.',
      )
    }
  }, [datasetUrl, fetchHint])

  useEffect(() => {
    load()
    return () => {
      requestRef.current += 1
    }
  }, [load])

  return { status, error, data, reload: load }
}

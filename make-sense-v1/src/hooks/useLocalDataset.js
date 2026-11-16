import { useCallback, useEffect, useRef, useState } from 'react'
import { DATASET } from '../config.js'
import { isValidOccurrence } from '../utils/occurrences.js'

/**
 * Load the curated local GBIF sample (no live API on startup).
 */
export function useLocalDataset() {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestRef.current
    setStatus('loading')
    setError(null)

    try {
      const response = await fetch(DATASET.url, { cache: 'no-cache' })
      if (!response.ok) {
        throw new Error(
          `Could not load local dataset (${response.status}). Run: npm run fetch:barn-swallow`,
        )
      }

      const json = await response.json()
      if (id !== requestRef.current) return

      const records = Array.isArray(json.records)
        ? json.records.filter(isValidOccurrence)
        : []

      if (records.length === 0) {
        throw new Error(
          'Local dataset contained no valid occurrence records. Re-run npm run fetch:barn-swallow.',
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
  }, [])

  useEffect(() => {
    load()
    return () => {
      requestRef.current += 1
    }
  }, [load])

  return { status, error, data, reload: load }
}

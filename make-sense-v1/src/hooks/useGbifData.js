import { useCallback, useEffect, useRef, useState } from 'react'
import { GBIF } from '../config.js'
import { fetchBarnSwallowOccurrences } from '../services/gbif.js'

/**
 * Load Barn Swallow occurrences from GBIF (client-side, no database).
 * @param {{ maxRecords?: number, autoLoad?: boolean }} [options]
 */
export function useGbifData(options = {}) {
  const maxRecords = options.maxRecords ?? GBIF.maxRecords
  const autoLoad = options.autoLoad !== false

  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [data, setData] = useState(null)
  const abortRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++abortRef.current
    setStatus('loading')
    setError(null)
    setProgress({ phase: 'starting', totalRetrieved: 0, overallTarget: maxRecords })
    setData(null)

    try {
      const result = await fetchBarnSwallowOccurrences({
        maxRecords,
        onProgress: (info) => {
          if (requestId !== abortRef.current) return
          setProgress(info)
        },
      })

      if (requestId !== abortRef.current) return

      setData(result)
      setStatus('ready')
      setProgress(null)
    } catch (err) {
      if (requestId !== abortRef.current) return
      setStatus('error')
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while retrieving GBIF data.',
      )
      setProgress(null)
    }
  }, [maxRecords])

  useEffect(() => {
    if (autoLoad) {
      load()
    }
    return () => {
      abortRef.current += 1
    }
  }, [autoLoad, load])

  return {
    status,
    error,
    progress,
    data,
    reload: load,
    maxRecords,
  }
}

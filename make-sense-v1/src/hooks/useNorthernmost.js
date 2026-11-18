import { useEffect, useState } from 'react'

/** Local northernmost occurrence file, one point per species, year, and month. */
export function useNorthernmost() {
  const [pack, setPack] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/data/northernmost.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((json) => {
        if (!cancelled) setPack(json)
      })
      .catch((err) => {
        console.error('Could not load northernmost coordinates', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return pack
}

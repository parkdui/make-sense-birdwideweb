import { useEffect, useState } from 'react'
import { TEMPERATURE } from '../config.js'
import { decodeTemperaturePayload } from '../utils/temperature.js'

export function useTemperatureData() {
  const [state, setState] = useState({
    status: 'loading',
    error: null,
    pack: null,
  })

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        setState((s) => ({ ...s, status: 'loading', error: null }))
        const res = await fetch(TEMPERATURE.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const pack = decodeTemperaturePayload(json)
        if (!cancelled) {
          setState({ status: 'ready', error: null, pack })
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: err?.message || String(err),
            pack: null,
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}

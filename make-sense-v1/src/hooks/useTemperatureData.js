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
        const jsonRes = await fetch(TEMPERATURE.url)
        if (!jsonRes.ok) throw new Error(`HTTP ${jsonRes.status}`)
        const json = await jsonRes.json()

        let binBuffer = null
        const binName = json?.grid?.bin
        if (binName) {
          const binUrl = TEMPERATURE.url.replace(/[^/]+$/, binName)
          const binRes = await fetch(binUrl)
          if (!binRes.ok) throw new Error(`Grid binary HTTP ${binRes.status}`)
          binBuffer = await binRes.arrayBuffer()
        }

        const pack = decodeTemperaturePayload(json, binBuffer)
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

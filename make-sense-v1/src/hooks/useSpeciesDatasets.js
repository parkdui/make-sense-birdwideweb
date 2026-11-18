import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SPECIES_CATALOG } from '../config.js'
import { isValidOccurrence } from '../utils/occurrences.js'

/**
 * Load & cache local GBIF samples for one or more species ids.
 * Deselected species stay cached so toggling back is instant.
 *
 * @param {string[]} speciesIds
 */
export function useSpeciesDatasets(speciesIds) {
  const [cache, setCache] = useState(() => ({}))
  const requestRef = useRef(new Map())
  const cacheRef = useRef(cache)
  cacheRef.current = cache

  const catalogById = useMemo(() => {
    const map = new Map()
    for (const s of SPECIES_CATALOG) map.set(s.id, s)
    return map
  }, [])

  const loadOne = useCallback(
    async (id) => {
      const species = catalogById.get(id)
      if (!species?.datasetUrl) {
        setCache((prev) => ({
          ...prev,
          [id]: {
            status: 'error',
            error: 'No dataset URL configured for this species.',
            data: null,
          },
        }))
        return
      }

      const reqId = (requestRef.current.get(id) ?? 0) + 1
      requestRef.current.set(id, reqId)

      setCache((prev) => ({
        ...prev,
        [id]: {
          status: 'loading',
          error: null,
          data: prev[id]?.data ?? null,
        },
      }))

      try {
        const response = await fetch(species.datasetUrl, { cache: 'no-cache' })
        if (!response.ok) {
          throw new Error(
            `Could not load local dataset (${response.status}). Run: ${species.fetchScript}`,
          )
        }
        const json = await response.json()
        if (requestRef.current.get(id) !== reqId) return

        const records = Array.isArray(json.records)
          ? json.records.filter(isValidOccurrence)
          : []
        if (records.length === 0) {
          throw new Error(
            `Local dataset contained no valid records. Re-run ${species.fetchScript}.`,
          )
        }

        setCache((prev) => ({
          ...prev,
          [id]: {
            status: 'ready',
            error: null,
            data: {
              meta: json.meta ?? null,
              species: json.species ?? null,
              records,
            },
          },
        }))
      } catch (err) {
        if (requestRef.current.get(id) !== reqId) return
        setCache((prev) => ({
          ...prev,
          [id]: {
            status: 'error',
            error:
              err instanceof Error
                ? err.message
                : 'Failed to load the local occurrence dataset.',
            data: prev[id]?.data ?? null,
          },
        }))
      }
    },
    [catalogById],
  )

  const idsKey = speciesIds.join('|')

  useEffect(() => {
    for (const id of speciesIds) {
      const entry = cacheRef.current[id]
      if (!entry || entry.status === 'error') {
        loadOne(id)
      }
    }
  }, [idsKey, speciesIds, loadOne])

  const selectedEntries = speciesIds.map((id) => ({
    id,
    species: catalogById.get(id) ?? null,
    ...(cache[id] ?? { status: 'idle', error: null, data: null }),
  }))

  const loading = selectedEntries.some(
    (e) => e.status === 'loading' || e.status === 'idle',
  )
  const ready =
    selectedEntries.length > 0 &&
    selectedEntries.every((e) => e.status === 'ready' && e.data)
  const errors = selectedEntries.filter((e) => e.status === 'error')

  const reload = useCallback(() => {
    for (const id of speciesIds) loadOne(id)
  }, [speciesIds, loadOne])

  return {
    byId: cache,
    selectedEntries,
    loading,
    ready,
    errors,
    reload,
  }
}

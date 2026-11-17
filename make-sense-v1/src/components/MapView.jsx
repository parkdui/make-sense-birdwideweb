import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { FLOCK, MAP, MAP_STYLE, TEMPERATURE, TIMELINE } from '../config.js'
import { buildFlock, getMonthTargets } from '../utils/migrationFlock.js'
import { getMonthLatExtremes } from '../utils/latExtremes.js'
import {
  lerpCelsius,
  paintTemperatureViewport,
  sliceToCelsius,
} from '../utils/temperature.js'

/**
 * Fixed-camera flock map.
 * Temperature: screen-space overlay.
 * Birds: red dots + trails.
 * Latitude lines: northernmost / southernmost occurrence for the active month.
 */

function drawLatLine(ctx, map, lat, color, label) {
  if (!Number.isFinite(lat)) return
  const bounds = map.getBounds()
  const west = bounds.getWest()
  const east = bounds.getEast()
  // Sample along longitude so the line stays correct if the camera rotates.
  const steps = 48
  ctx.beginPath()
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const lng = west + (east - west) * t
    const p = map.project([lng, lat])
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = MAP.extremeLineWidth
  ctx.setLineDash([6, 5])
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.setLineDash([])

  const labelAt = map.project([(west + east) / 2, lat])
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  const text = `${label} ${lat.toFixed(1)}°`
  const padX = 8
  const x = Math.min(map.getContainer().clientWidth - 110, Math.max(8, labelAt.x + padX))
  const y = labelAt.y - 4
  ctx.fillText(text, x, y)
}
export default function MapView({
  speciesId = 'species',
  yearRecords,
  year,
  month,
  flockSize = 10,
  temperaturePack,
}) {
  const containerRef = useRef(null)
  const tempCanvasRef = useRef(null)
  const canvasRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const birdsRef = useRef([])
  const tweenRef = useRef(null)
  const extremeTweenRef = useRef(null)
  const trailTimerRef = useRef(null)
  const rafRef = useRef(0)
  const tempRafRef = useRef(0)
  /** Reseed flock when species or year changes (not on every month tick). */
  const seededKeyRef = useRef('')
  /** Displayed (possibly tweened) northernmost / southernmost latitudes. */
  const extremesRef = useRef({ northLat: null, southLat: null })
  const tempPaintRef = useRef({
    key: null,
    field: null,
    gridMeta: null,
    tween: null,
  })
  /** While the user pans/zooms, reuse the last paint via CSS transform. */
  const mapDragRef = useRef({
    active: false,
    startCenter: null,
    startZoom: 0,
    startBearing: 0,
    startPitch: 0,
  })
  const propsRef = useRef({
    speciesId,
    yearRecords,
    year,
    month,
    flockSize,
    temperaturePack,
  })
  propsRef.current = {
    speciesId,
    yearRecords,
    year,
    month,
    flockSize,
    temperaturePack,
  }

  const killTween = () => {
    if (tweenRef.current) {
      tweenRef.current.kill()
      tweenRef.current = null
    }
  }

  const killExtremeTween = () => {
    if (extremeTweenRef.current) {
      extremeTweenRef.current.kill()
      extremeTweenRef.current = null
    }
  }

  const killTempTween = () => {
    if (tempPaintRef.current.tween) {
      tempPaintRef.current.tween.kill()
      tempPaintRef.current.tween = null
    }
  }

  const drawTemperature = ({ step } = {}) => {
    const map = mapRef.current
    const canvas = tempCanvasRef.current
    const { field, gridMeta } = tempPaintRef.current
    if (!map || !canvas || !readyRef.current) return

    if (!field || !gridMeta) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    // Clear any drag transform before painting in map space
    canvas.style.transform = ''
    canvas.style.transformOrigin = ''
    canvas.style.opacity = ''

    paintTemperatureViewport(map, field, gridMeta, canvas, {
      vmin: TEMPERATURE.vmin,
      vmax: TEMPERATURE.vmax,
      alpha: TEMPERATURE.paintAlpha,
      step: step ?? TEMPERATURE.sampleStep,
      cellsX: TEMPERATURE.unprojectCellsX,
      cellsY: TEMPERATURE.unprojectCellsY,
    })
  }

  const scheduleTempDraw = (opts) => {
    if (mapDragRef.current.active) return
    if (tempRafRef.current) return
    tempRafRef.current = window.requestAnimationFrame(() => {
      tempRafRef.current = 0
      drawTemperature(opts)
    })
  }

  const syncTempCanvasTransform = () => {
    const map = mapRef.current
    const canvas = tempCanvasRef.current
    const drag = mapDragRef.current
    if (!map || !canvas || !drag.active || !drag.startCenter) return

    // Rotate/pitch can't be faked with 2D translate+scale — dim until settle
    if (
      map.getBearing() !== drag.startBearing ||
      map.getPitch() !== drag.startPitch
    ) {
      canvas.style.transform = ''
      canvas.style.opacity = '0.35'
      return
    }

    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const p = map.project(drag.startCenter)
    const scale = 2 ** (map.getZoom() - drag.startZoom)
    canvas.style.opacity = ''
    canvas.style.transformOrigin = `${w / 2}px ${h / 2}px`
    canvas.style.transform = `translate(${p.x - w / 2}px, ${p.y - h / 2}px) scale(${scale})`
  }

  const drawScene = () => {
    const map = mapRef.current
    const canvas = canvasRef.current
    if (!map || !canvas) return
    // Allow drawing as soon as the MapLibre style is ready (HMR-safe).
    if (!readyRef.current) {
      if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
        readyRef.current = true
      } else {
        return
      }
    }

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 0
    const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 0
    if (width < 2 || height < 2) return

    const nextW = Math.floor(width * dpr)
    const nextH = Math.floor(height * dpr)
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW
      canvas.height = nextH
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.setLineDash([])

    const birds = birdsRef.current
    if (import.meta.env.DEV) {
      window.__makeSenseBirdCount = birds.length
      if (birds.length) {
        let lat = 0
        let lng = 0
        for (const b of birds) {
          lat += b.lat
          lng += b.lng
        }
        window.__makeSenseBirdMean = {
          lat: lat / birds.length,
          lng: lng / birds.length,
          n: birds.length,
        }
      }
    }

    for (const bird of birds) {
      const trail = bird.trail
      if (trail && trail.length >= 2) {
        const start = map.project([trail[0].lng, trail[0].lat])
        const end = map.project([
          trail[trail.length - 1].lng,
          trail[trail.length - 1].lat,
        ])

        ctx.beginPath()
        for (let i = 0; i < trail.length; i += 1) {
          const p = map.project([trail[i].lng, trail[i].lat])
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }

        const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y)
        gradient.addColorStop(0, 'rgba(225, 6, 0, 0)')
        gradient.addColorStop(0.5, 'rgba(225, 6, 0, 0.22)')
        gradient.addColorStop(1, 'rgba(225, 6, 0, 0.8)')
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
      }

      if (!Number.isFinite(bird.lng) || !Number.isFinite(bird.lat)) continue
      const head = map.project([bird.lng, bird.lat])
      ctx.beginPath()
      ctx.fillStyle = MAP.pointColor
      ctx.arc(head.x, head.y, 5, 0, Math.PI * 2)
      ctx.fill()
    }

    const { northLat, southLat } = extremesRef.current
    if (Number.isFinite(northLat)) {
      drawLatLine(ctx, map, northLat, MAP.northLineColor, 'N')
    }
    if (Number.isFinite(southLat)) {
      drawLatLine(ctx, map, southLat, MAP.southLineColor, 'S')
    }
  }

  const drawSceneRef = useRef(drawScene)
  drawSceneRef.current = drawScene

  const scheduleDraw = () => {
    if (rafRef.current) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      drawSceneRef.current()
    })
  }
  const scheduleDrawRef = useRef(scheduleDraw)
  scheduleDrawRef.current = scheduleDraw

  const syncExtremes = ({ immediate = false } = {}) => {
    const { yearRecords: records, month: monthValue } = propsRef.current
    const next = getMonthLatExtremes(records, monthValue)
    const cur = extremesRef.current

    if (!next) {
      killExtremeTween()
      extremesRef.current = { northLat: null, southLat: null }
      scheduleDraw()
      return
    }

    const fromNorth = cur.northLat
    const fromSouth = cur.southLat
    const canTween =
      !immediate &&
      Number.isFinite(fromNorth) &&
      Number.isFinite(fromSouth)

    killExtremeTween()

    if (!canTween) {
      extremesRef.current = {
        northLat: next.northLat,
        southLat: next.southLat,
      }
      scheduleDraw()
      return
    }

    const state = {
      northLat: fromNorth,
      southLat: fromSouth,
    }
    extremeTweenRef.current = gsap.to(state, {
      northLat: next.northLat,
      southLat: next.southLat,
      duration: Math.min(0.9, (TIMELINE.monthMs / 1000) * 0.85),
      ease: 'power1.inOut',
      onUpdate: () => {
        extremesRef.current = {
          northLat: state.northLat,
          southLat: state.southLat,
        }
        scheduleDraw()
      },
      onComplete: () => {
        extremesRef.current = {
          northLat: next.northLat,
          southLat: next.southLat,
        }
        extremeTweenRef.current = null
        scheduleDraw()
      },
    })
  }

  const pushTrailSample = () => {
    // Recover if an older HMR timer is still alive without scheduleDrawRef.
    const draw = scheduleDrawRef.current
    if (typeof draw !== 'function') return

    const max = FLOCK.trailLength
    for (const bird of birdsRef.current) {
      if (!Number.isFinite(bird.lng) || !Number.isFinite(bird.lat)) continue
      if (!Array.isArray(bird.trail)) bird.trail = []
      bird.trail.push({ lng: bird.lng, lat: bird.lat })
      if (bird.trail.length > max) {
        bird.trail.splice(0, bird.trail.length - max)
      }
    }
    draw()
  }
  const pushTrailSampleRef = useRef(pushTrailSample)
  pushTrailSampleRef.current = pushTrailSample

  const resetCamera = () => {
    const map = mapRef.current
    if (!map) return
    map.jumpTo({
      center: MAP.initialView.center,
      zoom: MAP.initialView.zoom,
      bearing: MAP.initialView.bearing,
      pitch: MAP.initialView.pitch,
    })
  }

  const seedFlock = (records, monthValue, size, key) => {
    birdsRef.current = buildFlock(records ?? [], monthValue, size)
    seededKeyRef.current = key
    resetCamera()
    if (import.meta.env.DEV) {
      window.__makeSenseBirdCount = birdsRef.current.length
      window.__makeSenseFlockKey = key
    }
    scheduleDrawRef.current()
  }

  const animateToMonth = (records, monthValue, size, { immediate = false } = {}) => {
    // Rebuild from this month's sample so geography always matches the timeline.
    const targets = getMonthTargets(records ?? [], monthValue, size)
    if (!targets?.length) {
      birdsRef.current = []
      drawSceneRef.current()
      return
    }

    killTween()

    const prev = birdsRef.current
    const nextBirds = targets.map((target, i) => {
      const old = prev[i]
      const startLng = old && Number.isFinite(old.lng) ? old.lng : target.lng
      const startLat = old && Number.isFinite(old.lat) ? old.lat : target.lat
      return {
        id: old?.id ?? `bird-${i}`,
        lng: immediate ? target.lng : startLng,
        lat: immediate ? target.lat : startLat,
        gbifID: target.gbifID,
        trail: [
          {
            lng: immediate ? target.lng : startLng,
            lat: immediate ? target.lat : startLat,
          },
        ],
      }
    })
    birdsRef.current = nextBirds

    const paint = () => {
      // Bypass rAF coalescing so month/species updates always hit the canvas.
      drawSceneRef.current()
    }

    if (import.meta.env.DEV) {
      window.__makeSenseBirdCount = nextBirds.length
      window.__makeSenseAnimate = {
        month: monthValue,
        immediate,
        targetLat: targets.reduce((s, t) => s + t.lat, 0) / targets.length,
        targetLng: targets.reduce((s, t) => s + t.lng, 0) / targets.length,
      }
    }

    if (immediate) {
      paint()
      return
    }

    const duration = Math.min(1.05, (TIMELINE.monthMs / 1000) * 0.9)
    const tweens = []

    for (let i = 0; i < nextBirds.length; i += 1) {
      const bird = nextBirds[i]
      const target = targets[i]
      tweens.push(
        gsap.to(bird, {
          duration,
          ease: 'power1.inOut',
          lng: target.lng,
          lat: target.lat,
          overwrite: 'auto',
          onUpdate: paint,
          onComplete: () => {
            bird.lng = target.lng
            bird.lat = target.lat
            bird.gbifID = target.gbifID
            if (i === nextBirds.length - 1) paint()
          },
        }),
      )
    }

    tweenRef.current = {
      kill() {
        // Snap to targets if a tween is interrupted mid-flight.
        for (let i = 0; i < nextBirds.length; i += 1) {
          nextBirds[i].lng = targets[i].lng
          nextBirds[i].lat = targets[i].lat
          nextBirds[i].gbifID = targets[i].gbifID
        }
        tweens.forEach((t) => t.kill())
        paint()
      },
    }
    paint()
  }

  const syncFlock = ({ immediate = false } = {}) => {
    const map = mapRef.current
    if (!map) return
    if (!readyRef.current && map.isStyleLoaded?.()) {
      readyRef.current = true
    }
    if (!readyRef.current) return

    const {
      speciesId: sid,
      yearRecords: records,
      year: yearValue,
      month: monthValue,
      flockSize: size,
    } = propsRef.current

    const targetSize = Math.max(0, size ?? FLOCK.minDots)
    const flockKey = `${sid}:${yearValue}`

    if (!records?.length || targetSize <= 0) {
      birdsRef.current = []
      seededKeyRef.current = ''
      scheduleDrawRef.current()
      return
    }

    const needsSeed =
      seededKeyRef.current !== flockKey || birdsRef.current.length === 0

    if (needsSeed) {
      killTween()
      seedFlock(records, monthValue, targetSize, flockKey)
      animateToMonth(records, monthValue, targetSize, { immediate: true })
      return
    }

    // Month / flock-size change: move dots toward this month's occurrence sample.
    animateToMonth(records, monthValue, targetSize, { immediate })
  }

  const syncTemperatureLayer = ({ immediate = false } = {}) => {
    const map = mapRef.current
    const pack = propsRef.current.temperaturePack
    if (!map || !readyRef.current || !pack) return

    const { year: yearValue, month: monthValue } = propsRef.current
    const key = `${yearValue}-${String(monthValue).padStart(2, '0')}`
    if (tempPaintRef.current.key === key && !tempPaintRef.current.tween) {
      scheduleTempDraw()
      return
    }

    const slice = pack.getGridSlice(yearValue, monthValue)
    tempPaintRef.current.gridMeta = pack.gridMeta

    if (!slice) {
      killTempTween()
      tempPaintRef.current.field = null
      tempPaintRef.current.key = key
      scheduleTempDraw()
      return
    }

    const toField = sliceToCelsius(slice, pack.gridMeta)
    const fromField = tempPaintRef.current.field

    killTempTween()
    tempPaintRef.current.key = key

    const skipAnim =
      immediate || !fromField || fromField.length !== toField.length

    if (skipAnim) {
      tempPaintRef.current.field = toField
      scheduleTempDraw({ step: TEMPERATURE.sampleStep })
      return
    }

    const state = { t: 0 }
    let lastPaint = 0
    tempPaintRef.current.tween = gsap.to(state, {
      t: 1,
      duration: Math.min(1.0, (TIMELINE.monthMs / 1000) * 0.9),
      ease: 'power1.inOut',
      onUpdate: () => {
        const mixed = lerpCelsius(fromField, toField, state.t)
        tempPaintRef.current.field = mixed
        // Don't fight the map drag transform; paint when idle
        if (mapDragRef.current.active) return
        const now = performance.now()
        if (now - lastPaint < 50 && state.t < 0.999) return
        lastPaint = now
        drawTemperature({ step: TEMPERATURE.animSampleStep })
      },
      onComplete: () => {
        tempPaintRef.current.field = toField
        tempPaintRef.current.tween = null
        drawTemperature({ step: TEMPERATURE.sampleStep })
      },
    })
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // Clear leftover MapLibre DOM from HMR remounts.
    containerRef.current.replaceChildren()

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: MAP.initialView.center,
      zoom: MAP.initialView.zoom,
      bearing: MAP.initialView.bearing,
      pitch: MAP.initialView.pitch,
      attributionControl: true,
    })

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-right',
    )
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-left')

    const onMapReady = () => {
      readyRef.current = true
      syncTemperatureLayer({ immediate: true })
      syncFlock({ immediate: true })
      syncExtremes({ immediate: true })
      map.resize()
      // Draw immediately (not only via rAF) so the canvas buffer resizes now.
      drawSceneRef.current()
      scheduleTempDraw()
    }
    map.on('load', onMapReady)
    map.on('idle', () => {
      if (!readyRef.current) onMapReady()
      else scheduleDrawRef.current()
    })

    map.on('movestart', () => {
      // Skip expensive heat-map repaints while dragging; CSS-transform instead
      if (tempPaintRef.current.tween) return
      mapDragRef.current = {
        active: true,
        startCenter: map.getCenter(),
        startZoom: map.getZoom(),
        startBearing: map.getBearing(),
        startPitch: map.getPitch(),
      }
    })

    map.on('move', () => {
      scheduleDrawRef.current()
      if (mapDragRef.current.active) syncTempCanvasTransform()
    })

    map.on('zoom', () => {
      scheduleDrawRef.current()
      if (mapDragRef.current.active) syncTempCanvasTransform()
    })

    const endMapDrag = () => {
      if (!mapDragRef.current.active) {
        scheduleTempDraw()
        return
      }
      mapDragRef.current.active = false
      const canvas = tempCanvasRef.current
      if (canvas) {
        canvas.style.transform = ''
        canvas.style.transformOrigin = ''
        canvas.style.opacity = ''
      }
      // Full-quality redraw once the view settles
      drawTemperature({ step: TEMPERATURE.sampleStep })
    }

    map.on('moveend', endMapDrag)
    map.on('zoomend', endMapDrag)

    map.on('resize', () => {
      scheduleDrawRef.current()
      scheduleTempDraw()
    })

    map.on('error', (e) => {
      console.error('MapLibre error:', e?.error ?? e)
    })

    const onResize = () => {
      map.resize()
      scheduleDrawRef.current()
      scheduleTempDraw()
    }
    window.addEventListener('resize', onResize)
    requestAnimationFrame(() => map.resize())
    const resizeTimer = window.setTimeout(() => map.resize(), 300)

    trailTimerRef.current = window.setInterval(
      () => pushTrailSampleRef.current(),
      FLOCK.trailSampleMs,
    )

    mapRef.current = map
    if (import.meta.env.DEV) window.__makeSenseMap = map

    return () => {
      window.clearTimeout(resizeTimer)
      window.clearInterval(trailTimerRef.current)
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      if (tempRafRef.current) window.cancelAnimationFrame(tempRafRef.current)
      window.removeEventListener('resize', onResize)
      killTween()
      killExtremeTween()
      killTempTween()
      readyRef.current = false
      seededKeyRef.current = ''
      extremesRef.current = { northLat: null, southLat: null }
      tempPaintRef.current.key = null
      tempPaintRef.current.field = null
      tempPaintRef.current.gridMeta = null
      if (import.meta.env.DEV && window.__makeSenseMap === map) {
        delete window.__makeSenseMap
      }
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stable signature — never put the records array itself in effect deps
  // (HMR / mistaken spreads have crashed MapView that way before).
  const recordsSignature = `${speciesId}:${year}:${yearRecords?.length ?? 0}:${yearRecords?.[0]?.gbifID ?? ''}`

  useEffect(() => {
    syncFlock({ immediate: false })
    syncExtremes({ immediate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speciesId, year, month, flockSize, recordsSignature])

  useEffect(() => {
    syncTemperatureLayer({ immediate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, temperaturePack])

  return (
    <>
      <div className="map-shell">
        <div
          ref={containerRef}
          className="map-view"
          role="application"
          aria-label="Bird migration flock map"
        />
        <canvas ref={tempCanvasRef} className="temp-canvas" aria-hidden="true" />
      </div>
      <canvas ref={canvasRef} className="trail-canvas" aria-hidden="true" />
    </>
  )
}

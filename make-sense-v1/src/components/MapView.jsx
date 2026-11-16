import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { FLOCK, MAP, MAP_STYLE, TEMPERATURE, TIMELINE } from '../config.js'
import {
  buildFlockFromJanuary,
  getMonthTargets,
} from '../utils/migrationFlock.js'
import {
  gridCoordinates,
  paintTemperatureImage,
} from '../utils/temperature.js'

const TEMP_SOURCE = 'temperature-grid'
const TEMP_LAYER = 'temperature-raster'

/**
 * Fixed-camera flock map.
 * Temperature: red–yellow–white anomaly raster over grayscale basemap.
 * Birds: simple red dots + fading trails on a canvas above the map.
 */
export default function MapView({ yearRecords, year, month, temperaturePack }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const birdsRef = useRef([])
  const tweenRef = useRef(null)
  const trailTimerRef = useRef(null)
  const rafRef = useRef(0)
  const seededYearRef = useRef(null)
  const tempPaintRef = useRef({ canvas: null, url: null, key: null, cache: new Map() })
  const propsRef = useRef({ yearRecords, year, month, temperaturePack })
  propsRef.current = { yearRecords, year, month, temperaturePack }

  const killTween = () => {
    if (tweenRef.current) {
      tweenRef.current.kill()
      tweenRef.current = null
    }
  }

  const drawScene = () => {
    const map = mapRef.current
    const canvas = canvasRef.current
    if (!map || !canvas || !readyRef.current) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (
      canvas.width !== Math.floor(width * dpr) ||
      canvas.height !== Math.floor(height * dpr)
    ) {
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    for (const bird of birdsRef.current) {
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
      ctx.arc(head.x, head.y, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const scheduleDraw = () => {
    if (rafRef.current) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      drawScene()
    })
  }

  const pushTrailSample = () => {
    const max = FLOCK.trailLength
    for (const bird of birdsRef.current) {
      if (!Number.isFinite(bird.lng) || !Number.isFinite(bird.lat)) continue
      bird.trail.push({ lng: bird.lng, lat: bird.lat })
      if (bird.trail.length > max) {
        bird.trail.splice(0, bird.trail.length - max)
      }
    }
    scheduleDraw()
  }

  const seedFlockFromJanuary = (records, yearValue) => {
    birdsRef.current = buildFlockFromJanuary(records ?? [])
    seededYearRef.current = yearValue
    scheduleDraw()
  }

  const animateToMonth = (records, monthValue, { immediate = false } = {}) => {
    const birds = birdsRef.current
    if (!birds.length) return

    const targets = getMonthTargets(records ?? [], monthValue, birds.length)
    if (!targets) return

    killTween()

    if (immediate) {
      for (let i = 0; i < birds.length; i += 1) {
        birds[i].lng = targets[i].lng
        birds[i].lat = targets[i].lat
        birds[i].gbifID = targets[i].gbifID
        birds[i].trail = [{ lng: birds[i].lng, lat: birds[i].lat }]
      }
      scheduleDraw()
      return
    }

    const duration = Math.min(0.9, (TIMELINE.monthMs / 1000) * 0.85)
    const tweens = []

    for (let i = 0; i < birds.length; i += 1) {
      const bird = birds[i]
      const target = targets[i]
      tweens.push(
        gsap.to(bird, {
          duration,
          ease: 'power1.inOut',
          lng: target.lng,
          lat: target.lat,
          onUpdate: scheduleDraw,
          onComplete: () => {
            bird.gbifID = target.gbifID
          },
        }),
      )
    }

    tweenRef.current = {
      kill() {
        tweens.forEach((t) => t.kill())
      },
    }
  }

  const syncFlock = ({ immediateMonth = false } = {}) => {
    if (!readyRef.current) return
    const { yearRecords: records, year: yearValue, month: monthValue } =
      propsRef.current

    if (!records?.length) {
      birdsRef.current = []
      scheduleDraw()
      return
    }

    const needsSeed =
      seededYearRef.current !== yearValue || birdsRef.current.length === 0

    if (needsSeed) {
      killTween()
      seedFlockFromJanuary(records, yearValue)
      animateToMonth(records, monthValue, {
        immediate: immediateMonth || monthValue === 1,
      })
      return
    }

    animateToMonth(records, monthValue, {
      immediate: immediateMonth || monthValue === 1,
    })
  }

  const ensureTempLayer = (map) => {
    if (map.getSource(TEMP_SOURCE)) return
    const pack = propsRef.current.temperaturePack
    const coords = pack?.gridMeta
      ? gridCoordinates(pack.gridMeta)
      : [
          [-180, 85],
          [180, 85],
          [180, -85],
          [-180, -85],
        ]

    // 1×1 transparent placeholder until the first month paints
    const placeholder =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Z5bUAAAAASUVORK5CYII='

    map.addSource(TEMP_SOURCE, {
      type: 'image',
      url: placeholder,
      coordinates: coords,
    })
    map.addLayer(
      {
        id: TEMP_LAYER,
        type: 'raster',
        source: TEMP_SOURCE,
        paint: {
          'raster-opacity': TEMPERATURE.layerOpacity,
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
      undefined,
    )
  }

  const syncTemperatureLayer = () => {
    const map = mapRef.current
    const pack = propsRef.current.temperaturePack
    if (!map || !readyRef.current || !pack) return

    ensureTempLayer(map)

    const { year: yearValue, month: monthValue } = propsRef.current
    const key = `${yearValue}-${String(monthValue).padStart(2, '0')}`
    if (tempPaintRef.current.key === key) return

    const slice = pack.getGridSlice(yearValue, monthValue)
    const source = map.getSource(TEMP_SOURCE)
    if (!source) return

    if (!slice) {
      if (map.getLayer(TEMP_LAYER)) {
        map.setPaintProperty(TEMP_LAYER, 'raster-opacity', 0)
      }
      tempPaintRef.current.key = key
      return
    }

    const coords = gridCoordinates(pack.gridMeta)
    let dataUrl = tempPaintRef.current.cache.get(key)

    if (!dataUrl) {
      let paintCanvas = tempPaintRef.current.canvas
      if (!paintCanvas) {
        paintCanvas = document.createElement('canvas')
        tempPaintRef.current.canvas = paintCanvas
      }

      const image = paintTemperatureImage(slice, pack.gridMeta, {
        upsample: TEMPERATURE.upsample,
        vmin: TEMPERATURE.vmin,
        vmax: TEMPERATURE.vmax,
        alpha: TEMPERATURE.paintAlpha,
      })
      paintCanvas.width = image.width
      paintCanvas.height = image.height
      const ctx = paintCanvas.getContext('2d')
      ctx.putImageData(image, 0, 0)
      dataUrl = paintCanvas.toDataURL('image/png')
      tempPaintRef.current.cache.set(key, dataUrl)
    }

    tempPaintRef.current.url = dataUrl
    tempPaintRef.current.key = key
    try {
      source.updateImage({ url: dataUrl, coordinates: coords })
      if (map.getLayer(TEMP_LAYER)) {
        map.setPaintProperty(
          TEMP_LAYER,
          'raster-opacity',
          TEMPERATURE.layerOpacity,
        )
      }
      map.triggerRepaint()
    } catch (err) {
      console.error('Temperature layer update failed:', err)
      tempPaintRef.current.key = null
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

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

    map.on('load', () => {
      readyRef.current = true
      ensureTempLayer(map)
      syncTemperatureLayer()
      syncFlock({ immediateMonth: true })
      map.resize()
      scheduleDraw()
    })

    map.on('move', scheduleDraw)
    map.on('zoom', scheduleDraw)
    map.on('resize', scheduleDraw)

    map.on('error', (e) => {
      console.error('MapLibre error:', e?.error ?? e)
    })

    const onResize = () => {
      map.resize()
      scheduleDraw()
    }
    window.addEventListener('resize', onResize)
    requestAnimationFrame(() => map.resize())
    const resizeTimer = window.setTimeout(() => map.resize(), 300)

    trailTimerRef.current = window.setInterval(
      pushTrailSample,
      FLOCK.trailSampleMs,
    )

    mapRef.current = map
    if (import.meta.env.DEV) window.__makeSenseMap = map

    return () => {
      window.clearTimeout(resizeTimer)
      window.clearInterval(trailTimerRef.current)
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      killTween()
      readyRef.current = false
      seededYearRef.current = null
      const tempUrl = tempPaintRef.current.url
      if (tempUrl?.startsWith('blob:')) URL.revokeObjectURL(tempUrl)
      tempPaintRef.current.url = null
      tempPaintRef.current.key = null
      if (import.meta.env.DEV && window.__makeSenseMap === map) {
        delete window.__makeSenseMap
      }
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    syncFlock({ immediateMonth: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, yearRecords])

  useEffect(() => {
    syncTemperatureLayer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, temperaturePack])

  return (
    <div className="map-shell">
      <div
        ref={containerRef}
        className="map-view"
        role="application"
        aria-label="Bird migration flock map"
      />
      <canvas ref={canvasRef} className="trail-canvas" aria-hidden="true" />
    </div>
  )
}

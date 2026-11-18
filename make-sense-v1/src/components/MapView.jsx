import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { FLOCK, MAP, MAP_STYLE, TEMPERATURE, TIMELINE } from '../config.js'
import {
  drawBirdMarker,
  headingFromTrail,
  markerForSpecies,
} from '../utils/birdMarkers.js'
import { buildFlock, formationDirection, getMonthTargets, layoutVFormation, lerpFormationDirection, monthAnchor } from '../utils/migrationFlock.js'
import { getMonthLatExtremes } from '../utils/latExtremes.js'
import { createThreeFlock } from '../utils/threeFlock.js'
import {
  lerpCelsius,
  paintTemperatureViewport,
  sliceToCelsius,
} from '../utils/temperature.js'

/**
 * Fixed-camera flock map.
 * Temperature: screen-space overlay.
 * Birds: multi-species colored dots + trails.
 * Latitude lines: each selected bird has its own solid northernmost
 * and southernmost line, in that bird's color, with a dot at the
 * extreme and a latitude badge. A line joins the two extremes.
 * Dim bands stack.
 */

/** Sample a constant-latitude curve across the current viewport. */
function projectLatSpan(map, lat, steps = 48) {
  if (!Number.isFinite(lat)) return []
  const bounds = map.getBounds()
  const west = bounds.getWest()
  const east = bounds.getEast()
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const lng = west + (east - west) * t
    points.push(map.project([lng, lat]))
  }
  return points
}

/**
 * Dim everything north of the N line and south of the S line
 * so the band between extremes stays readable.
 */
function drawExtremeDimBands(ctx, map, northLat, southLat, width, height) {
  const fill = MAP.extremeBandDim
  ctx.fillStyle = fill

  if (Number.isFinite(northLat)) {
    const northPts = projectLatSpan(map, northLat)
    if (northPts.length) {
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(width, 0)
      // Walk the latitude curve east → west so the polygon closes cleanly.
      for (let i = northPts.length - 1; i >= 0; i -= 1) {
        ctx.lineTo(northPts[i].x, northPts[i].y)
      }
      ctx.closePath()
      ctx.fill()
    }
  }

  if (Number.isFinite(southLat)) {
    const southPts = projectLatSpan(map, southLat)
    if (southPts.length) {
      ctx.beginPath()
      for (let i = 0; i < southPts.length; i += 1) {
        const p = southPts[i]
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.lineTo(width, height)
      ctx.lineTo(0, height)
      ctx.closePath()
      ctx.fill()
    }
  }
}

function formatExtremeLabel(prefix, lat) {
  const rounded = Math.round(Math.abs(lat) * 10) / 10
  const body = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${prefix}. ${body}`
}

function strokeLatitude(ctx, map, lat, color) {
  if (!Number.isFinite(lat)) return
  const points = projectLatSpan(map, lat)
  if (!points.length) return
  ctx.beginPath()
  for (let i = 0; i < points.length; i += 1) {
    const x = points[i].x
    const y = points[i].y
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = MAP.extremeLineWidth
  ctx.setLineDash([])
  ctx.lineCap = 'butt'
  ctx.stroke()
}

const BADGE_FONT = '600 12px "DM Sans", system-ui, sans-serif'

function queueExtremeBadge(ctx, map, lng, lat, color, text, badges, name) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
  const point = map.project([lng, lat])
  ctx.beginPath()
  ctx.arc(point.x, point.y, 5, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  ctx.font = BADGE_FONT
  const padX = 9
  const height = 22
  const gap = 6
  const label = typeof name === 'string' ? name.trim() : ''
  badges.push({
    x: point.x + 12,
    y: point.y,
    w: ctx.measureText(text).width + padX * 2,
    h: height,
    text,
    color,
    companion: label
      ? {
          gap,
          w: ctx.measureText(label).width + padX * 2,
          h: height,
          text: label,
          color,
        }
      : null,
  })
}

/** Slide a badge right when it would cover another bird's badge. */
function separateBadges(badges) {
  const gap = 6
  const span = (badge) =>
    badge.w + (badge.companion ? badge.companion.gap + badge.companion.w : 0)
  const ordered = [...badges].sort((a, b) => a.y - b.y || a.x - b.x)
  for (let i = 0; i < ordered.length; i += 1) {
    const badge = ordered[i]
    for (let j = 0; j < i; j += 1) {
      const other = ordered[j]
      const overlapY = Math.abs(badge.y - other.y) < (badge.h + other.h) / 2
      if (!overlapY) continue
      const minX = other.x + span(other) + gap
      if (badge.x < minX) badge.x = minX
    }
  }
}

function paintBadge(ctx, badge) {
  const left = badge.x
  const top = badge.y - badge.h / 2
  const radius = badge.h / 2
  ctx.beginPath()
  ctx.roundRect(left, top, badge.w, badge.h, radius)
  ctx.fillStyle = badge.color
  ctx.fill()
  ctx.font = BADGE_FONT
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(badge.text, left + 9, badge.y + 0.5)
  if (badge.companion) {
    paintBadge(ctx, {
      x: left + badge.w + badge.companion.gap,
      y: badge.y,
      w: badge.companion.w,
      h: badge.companion.h,
      text: badge.companion.text,
      color: badge.companion.color,
    })
  }
}

/**
 * One solid latitude line per extreme, a dot on the sample coordinate,
 * and a badge. A straight line joins that bird's south and north points.
 */
function drawSpeciesExtremes(ctx, map, bands) {
  for (const band of bands) {
    if (
      !Number.isFinite(band.northLat) ||
      !Number.isFinite(band.southLat) ||
      !Number.isFinite(band.northLng) ||
      !Number.isFinite(band.southLng)
    ) {
      continue
    }
    const from = map.project([band.southLng, band.southLat])
    const to = map.project([band.northLng, band.northLat])
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.strokeStyle = band.color
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    ctx.setLineDash([])
    ctx.stroke()
  }

  for (const band of bands) {
    strokeLatitude(ctx, map, band.northLat, band.color)
    strokeLatitude(ctx, map, band.southLat, band.color)
  }

  const badges = []
  for (const band of bands) {
    queueExtremeBadge(
      ctx,
      map,
      band.northLng,
      band.northLat,
      band.color,
      formatExtremeLabel('N', band.northLat),
      badges,
      band.name,
    )
    queueExtremeBadge(
      ctx,
      map,
      band.southLng,
      band.southLat,
      band.color,
      formatExtremeLabel('S', band.southLat),
      badges,
    )
  }
  separateBadges(badges)
  for (const badge of badges) paintBadge(ctx, badge)
}

/** Stable per-bird timing so the flock does not travel in lockstep. */
function carryPersonality(old, i) {
  const slot = (i * 47 + 13) % 100
  const delay = old?.delay ?? ((i * 3) % 11) * 0.014
  const travel = old?.travel ?? 0.42 + (slot / 100) * 0.5
  return {
    phase: old?.phase ?? (i * 1.37) % (Math.PI * 2),
    scaleJitter: old?.scaleJitter ?? 0.72 + ((i * 19) % 55) / 100,
    flapMul: old?.flapMul ?? 0.5 + ((i * 13) % 90) / 100,
    travel: Math.min(travel, 0.96 - delay),
    delay,
    curveSign: old?.curveSign ?? (i % 2 === 0 ? 1 : -1),
    curveAmt: old?.curveAmt ?? 0.05 + ((i * 29) % 62) / 100,
  }
}

function hexToRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string') return `rgba(225, 6, 0, ${alpha})`
  const raw = hex.replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) return `rgba(225, 6, 0, ${alpha})`
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * @param {Array<{ id: string, color: string, yearRecords: object[], flockSize: number }>} flocks
 */
export default function MapView({
  flocks = [],
  year,
  month,
  playing = true,
  playSpeed = 1,
  seasonGlide = false,
  followId = null,
  temperaturePack,
}) {
  const containerRef = useRef(null)
  const tempCanvasRef = useRef(null)
  const canvasRef = useRef(null)
  const birdCanvasRef = useRef(null)
  const dimCanvasRef = useRef(null)
  const threeFlockRef = useRef(null)
  const threeFailedRef = useRef(false)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  /** @type {React.MutableRefObject<Map<string, { birds: object[], seededKey: string, color: string }>>} */
  const flocksRef = useRef(new Map())
  const tweenRef = useRef(null)
  const extremeTweenRef = useRef(null)
  const trailTimerRef = useRef(null)
  const flapRafRef = useRef(0)
  const rafRef = useRef(0)
  const tempRafRef = useRef(0)
  /** Displayed per-species northernmost / southernmost latitudes. */
  const extremesRef = useRef([])
  const extremeTargetRef = useRef([])
  /** Programmatic camera moves while a species is being followed. */
  const followMoveRef = useRef(false)
  const followArmedRef = useRef(false)
  const followEaseDoneRef = useRef(false)
  const followTargetRef = useRef(null)
  /** Index of the single bird the camera stays on. */
  const followBirdIndexRef = useRef(null)
  const followSinceRef = useRef(0)
  const followTempAtRef = useRef(0)
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
    flocks,
    year,
    month,
    playing,
    playSpeed,
    seasonGlide,
    followId,
    temperaturePack,
  })
  propsRef.current = {
    flocks,
    year,
    month,
    playing,
    playSpeed,
    seasonGlide,
    followId,
    temperaturePack,
  }

  const allBirds = () => {
    const out = []
    for (const entry of flocksRef.current.values()) {
      for (const bird of entry.birds) out.push(bird)
    }
    return out
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

  /**
   * One bird for this follow. The same slot flies onward to a single
   * occurrence each month, so the camera has one continuous path.
   */
  const followBird = (id) => {
    const birds = flocksRef.current.get(id)?.birds ?? []
    if (!birds.length) return null

    let index = followBirdIndexRef.current
    const held = birds[index]
    if (
      !held ||
      index >= birds.length ||
      !Number.isFinite(held.lat) ||
      !Number.isFinite(held.lng)
    ) {
      // The first pass is that month's records, in latitude order, without jitter.
      const seen = new Set()
      let pool = 0
      for (const bird of birds) {
        if (!Number.isFinite(bird.lat) || !Number.isFinite(bird.lng)) continue
        if (seen.has(bird.gbifID)) break
        seen.add(bird.gbifID)
        pool += 1
      }
      if (!pool) return null
      index = Math.floor((pool - 1) / 2)
      followBirdIndexRef.current = index
    }

    const bird = birds[index]
    if (!bird || !Number.isFinite(bird.lat) || !Number.isFinite(bird.lng)) return null
    return bird
  }

  const trackFollowCamera = () => {
    const map = mapRef.current
    const id = propsRef.current.followId
    if (!map || !id) return
    if (followTargetRef.current !== id) {
      followTargetRef.current = id
      followArmedRef.current = false
      followEaseDoneRef.current = false
      followBirdIndexRef.current = null
    }
    const bird = followBird(id)
    if (!bird) return
    const zoom = MAP.followZoom

    if (!followArmedRef.current) {
      followArmedRef.current = true
      followEaseDoneRef.current = false
      followSinceRef.current = performance.now()
      followMoveRef.current = true
      map.stop()
      map.easeTo({
        center: [bird.lng, bird.lat],
        zoom,
        bearing: MAP.initialView.bearing,
        pitch: MAP.initialView.pitch,
        duration: 900,
        essential: true,
      })
      map.once('moveend', () => {
        if (propsRef.current.followId !== id) return
        followEaseDoneRef.current = true
        drawTemperature({ step: TEMPERATURE.animSampleStep })
      })
      return
    }

    if (!followEaseDoneRef.current) {
      if (performance.now() - followSinceRef.current < 1000) return
      followEaseDoneRef.current = true
    }

    const center = map.getCenter()
    if (
      Math.abs(center.lng - bird.lng) < 0.0004 &&
      Math.abs(center.lat - bird.lat) < 0.0004 &&
      Math.abs(map.getZoom() - zoom) < 0.02
    ) {
      return
    }
    followMoveRef.current = true
    map.jumpTo({
      center: [bird.lng, bird.lat],
      zoom,
      bearing: MAP.initialView.bearing,
      pitch: MAP.initialView.pitch,
    })
    const now = performance.now()
    if (now - followTempAtRef.current > 400) {
      followTempAtRef.current = now
      drawTemperature({ step: TEMPERATURE.animSampleStep })
    }
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

    const sizeCanvas = (target) => {
      if (!target) return null
      const nextW = Math.floor(width * dpr)
      const nextH = Math.floor(height * dpr)
      if (target.width !== nextW || target.height !== nextH) {
        target.width = nextW
        target.height = nextH
      }
      const context = target.getContext('2d')
      if (!context) return null
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      context.setLineDash([])
      return context
    }

    const ctx = sizeCanvas(canvas)
    const dimCtx = sizeCanvas(dimCanvasRef.current)
    if (!ctx) return

    const birds = allBirds()
    if (import.meta.env.DEV) {
      window.__makeSenseBirdCount = birds.length
      window.__makeSenseFlockCount = flocksRef.current.size
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

    const now = performance.now()

    for (const bird of birds) {
      const color = bird.color || MAP.pointColor
      const marker = markerForSpecies(bird.speciesId)
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
        gradient.addColorStop(0, hexToRgba(color, 0))
        gradient.addColorStop(0.5, hexToRgba(color, 0.18))
        gradient.addColorStop(1, hexToRgba(color, 0.55))
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.25
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
      }

      if (threeFailedRef.current) {
        if (!Number.isFinite(bird.lng) || !Number.isFinite(bird.lat)) continue
        const head = map.project([bird.lng, bird.lat])
        const heading = headingFromTrail(map, bird)
        bird.heading = heading
        const phase =
          (now / 1000) * marker.flapHz * (bird.flapMul ?? 1) * Math.PI * 2 +
          (bird.phase ?? 0)
        drawBirdMarker(ctx, head.x, head.y, {
          color,
          shape: marker.shape,
          size: marker.size * (bird.scaleJitter ?? 1),
          heading,
          phase,
        })
      }
    }

    if (!threeFailedRef.current) {
      if (!threeFlockRef.current && birdCanvasRef.current) {
        threeFlockRef.current = createThreeFlock(birdCanvasRef.current)
        if (!threeFlockRef.current) threeFailedRef.current = true
      }
      threeFlockRef.current?.sync({ map, birds, width, height, now })
    }

    if (dimCtx) {
      const bands = extremesRef.current ?? []
      for (const band of bands) {
        drawExtremeDimBands(dimCtx, map, band.northLat, band.southLat, width, height)
      }
      drawSpeciesExtremes(dimCtx, map, bands)
    }

    trackFollowCamera()
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
    const { flocks: flockList, month: monthValue } = propsRef.current
    if (extremeTweenRef.current && extremeTargetRef.current.length) {
      extremesRef.current = extremeTargetRef.current.map((band) => ({ ...band }))
    }

    const previous = new Map(extremesRef.current.map((band) => [band.id, band]))
    const next = []
    for (const flock of flockList ?? []) {
      const extremes = getMonthLatExtremes(flock.yearRecords, monthValue)
      if (!extremes) continue
      next.push({
        id: flock.id,
        color: flock.color || MAP.pointColor,
        name: flock.name || '',
        northLat: extremes.northLat,
        southLat: extremes.southLat,
        northLng: extremes.northLng,
        southLng: extremes.southLng,
      })
    }

    killExtremeTween()
    extremeTargetRef.current = next.map((band) => ({ ...band }))

    const from = next.map((band) => {
      const old = previous.get(band.id)
      if (
        old &&
        Number.isFinite(old.northLat) &&
        Number.isFinite(old.southLat) &&
        Number.isFinite(old.northLng) &&
        Number.isFinite(old.southLng)
      ) {
        return old
      }
      return band
    })
    const canTween =
      !immediate &&
      propsRef.current.playing &&
      next.some(
        (band, index) =>
          from[index].northLat !== band.northLat ||
          from[index].southLat !== band.southLat ||
          from[index].northLng !== band.northLng ||
          from[index].southLng !== band.southLng,
      )

    const frameFrom = next.map((band, index) => ({
      id: band.id,
      color: band.color,
      name: band.name,
      northLat: from[index].northLat,
      southLat: from[index].southLat,
      northLng: from[index].northLng,
      southLng: from[index].southLng,
    }))

    if (!canTween) {
      extremesRef.current = next.map((band) => ({ ...band }))
      scheduleDraw()
      return
    }

    // Show the new species immediately. A paused tween never fires onUpdate,
    // which used to hide every line added while playback was stopped.
    extremesRef.current = frameFrom
    scheduleDraw()

    const state = { t: 0 }
    let tween
    tween = gsap.to(state, {
      t: 1,
      duration: 1.4,
      ease: 'power1.inOut',
      onUpdate: () => {
        const t = state.t
        extremesRef.current = next.map((band, index) => ({
          id: band.id,
          color: band.color,
          name: band.name,
          northLat:
            from[index].northLat + (band.northLat - from[index].northLat) * t,
          southLat:
            from[index].southLat + (band.southLat - from[index].southLat) * t,
          northLng:
            from[index].northLng + (band.northLng - from[index].northLng) * t,
          southLng:
            from[index].southLng + (band.southLng - from[index].southLng) * t,
        }))
        scheduleDraw()
      },
      onComplete: () => {
        if (extremeTweenRef.current !== tween) return
        extremesRef.current = next.map((band) => ({ ...band }))
        extremeTweenRef.current = null
        scheduleDraw()
      },
    })
    tween.timeScale(propsRef.current.playSpeed || 1)
    extremeTweenRef.current = tween
  }

  const pushTrailSample = () => {
    // Recover if an older HMR timer is still alive without scheduleDrawRef.
    const draw = scheduleDrawRef.current
    if (typeof draw !== 'function') return

    const max = FLOCK.trailLength
    for (const bird of allBirds()) {
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

  const formationFor = (speciesId) =>
    speciesId === 'common-crane' ? 'v' : 'scatter'

  const animateFlockToMonth = (
    flockId,
    color,
    records,
    monthValue,
    size,
    { immediate = false } = {},
  ) => {
    const formation = formationFor(flockId)
    const entry = flocksRef.current.get(flockId) ?? {
      birds: [],
      seededKey: '',
      color,
    }
    let direction
    if (formation === 'v') {
      const anchor = monthAnchor(records, monthValue)
      const prev = entry.birds?.[0]
      direction = formationDirection(
        prev && Number.isFinite(prev.lng)
          ? { lng: prev.lng, lat: prev.lat }
          : null,
        anchor,
        prev && Number.isFinite(prev.formationDirLng)
          ? { dirLng: prev.formationDirLng, dirLat: prev.formationDirLat }
          : null,
      )
    }
    const targets = getMonthTargets(records ?? [], monthValue, size, {
      formation,
      direction,
    })

    if (!targets?.length) {
      entry.birds = []
      entry.color = color
      flocksRef.current.set(flockId, entry)
      return []
    }

    const prev = entry.birds
    const nextBirds = targets.map((target, i) => {
      const old = prev[i]
      const startLng = old && Number.isFinite(old.lng) ? old.lng : target.lng
      const startLat = old && Number.isFinite(old.lat) ? old.lat : target.lat
      return {
        id: old?.id ?? `${flockId}-${i}`,
        speciesId: flockId,
        color,
        heading: old?.heading ?? -Math.PI / 2,
        ...carryPersonality(old, i),
        formationDirLng: target.formationDirLng,
        formationDirLat: target.formationDirLat,
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
    entry.birds = nextBirds
    entry.color = color
    flocksRef.current.set(flockId, entry)
    return { birds: nextBirds, targets }
  }

  const syncFlock = ({ immediate = false } = {}) => {
    const map = mapRef.current
    if (!map) return
    if (!readyRef.current && map.isStyleLoaded?.()) {
      readyRef.current = true
    }
    if (!readyRef.current) return

    const {
      flocks: flockList,
      year: yearValue,
      month: monthValue,
    } = propsRef.current

    const activeIds = new Set((flockList ?? []).map((f) => f.id))
    for (const id of [...flocksRef.current.keys()]) {
      if (!activeIds.has(id)) flocksRef.current.delete(id)
    }

    if (!flockList?.length) {
      killTween()
      flocksRef.current.clear()
      scheduleDrawRef.current()
      return
    }

    let anyNeedsSeed = false
    for (const flock of flockList) {
      const flockKey = `${flock.id}:${yearValue}`
      const entry = flocksRef.current.get(flock.id)
      if (!entry || entry.birds.length === 0) {
        anyNeedsSeed = true
        break
      }
      // A season filter steps into the next year. Keep the birds and glide.
      if (entry.seededKey !== flockKey && !propsRef.current.seasonGlide) {
        anyNeedsSeed = true
        break
      }
    }

    killTween()

    if (anyNeedsSeed) {
      for (const flock of flockList) {
        const size = Math.max(0, flock.flockSize ?? FLOCK.minDots)
        const color = flock.color || MAP.pointColor
        const flockKey = `${flock.id}:${yearValue}`
        const seeded = buildFlock(flock.yearRecords ?? [], monthValue, size, {
          formation: formationFor(flock.id),
        }).map((bird, i) => ({
          ...bird,
          id: `${flock.id}-${i}`,
          speciesId: flock.id,
          color,
          heading: -Math.PI / 2,
          ...carryPersonality(null, i),
        }))
        flocksRef.current.set(flock.id, {
          birds: seeded,
          seededKey: flockKey,
          color,
        })
        animateFlockToMonth(
          flock.id,
          color,
          flock.yearRecords,
          monthValue,
          size,
          { immediate: true },
        )
      }
      if (!propsRef.current.followId) resetCamera()
      drawSceneRef.current()
      if (import.meta.env.DEV) {
        window.__makeSenseBirdCount = allBirds().length
        window.__makeSenseFlockKeys = [...flocksRef.current.keys()]
      }
      return
    }

    const paint = () => drawSceneRef.current()
    const duration = TIMELINE.monthMs / 1000
    const tweens = []
    const snapPairs = []

    for (const flock of flockList) {
      const size = Math.max(0, flock.flockSize ?? FLOCK.minDots)
      const color = flock.color || MAP.pointColor
      const entry = flocksRef.current.get(flock.id)
      if (entry) entry.seededKey = `${flock.id}:${yearValue}`
      const result = animateFlockToMonth(
        flock.id,
        color,
        flock.yearRecords,
        monthValue,
        size,
        { immediate },
      )
      if (!result?.birds?.length) continue
      const { birds: nextBirds, targets } = result
      snapPairs.push({ nextBirds, targets })

      if (immediate) continue

      if (formationFor(flock.id) === 'v') {
        const fromTip = { lng: nextBirds[0].lng, lat: nextBirds[0].lat }
        const toTip = { lng: targets[0].lng, lat: targets[0].lat }
        const toDir = {
          dirLng: targets[0].formationDirLng ?? 0,
          dirLat: targets[0].formationDirLat ?? 1,
        }
        const fromDir = {
          dirLng: nextBirds[0].formationDirLng ?? toDir.dirLng,
          dirLat: nextBirds[0].formationDirLat ?? toDir.dirLat,
        }
        const gbifID = targets[0].gbifID
        const motion = { t: 0 }
        tweens.push(
          gsap.to(motion, {
            t: 1,
            duration,
            ease: 'none',
            paused: !propsRef.current.playing,
            onUpdate: () => {
              const t = motion.t * motion.t * (3 - 2 * motion.t)
              const tip = {
                lng: fromTip.lng + (toTip.lng - fromTip.lng) * t,
                lat: fromTip.lat + (toTip.lat - fromTip.lat) * t,
              }
              const dir = lerpFormationDirection(fromDir, toDir, t)
              const placed = layoutVFormation(tip, dir, nextBirds.length, gbifID)
              for (let i = 0; i < nextBirds.length; i += 1) {
                const bird = nextBirds[i]
                const slot = placed[i]
                if (!slot) continue
                bird.lng = slot.lng
                bird.lat = slot.lat
                bird.formationDirLng = dir.dirLng
                bird.formationDirLat = dir.dirLat
              }
              paint()
            },
            onComplete: () => {
              for (let i = 0; i < nextBirds.length; i += 1) {
                nextBirds[i].lng = targets[i].lng
                nextBirds[i].lat = targets[i].lat
                nextBirds[i].gbifID = targets[i].gbifID
                nextBirds[i].formationDirLng = targets[i].formationDirLng
                nextBirds[i].formationDirLat = targets[i].formationDirLat
              }
              paint()
            },
          }),
        )
        continue
      }

      for (let i = 0; i < nextBirds.length; i += 1) {
        const bird = nextBirds[i]
        const target = targets[i]
        const fromLng = bird.lng
        const fromLat = bird.lat
        const dx = target.lng - fromLng
        const dy = target.lat - fromLat
        const len = Math.hypot(dx, dy) || 0.001
        const bulge = len * (bird.curveAmt ?? 0.2) * (bird.curveSign ?? 1)
        bird.fromLng = fromLng
        bird.fromLat = fromLat
        bird.toLng = target.lng
        bird.toLat = target.lat
        bird.ctrlLng = (fromLng + target.lng) / 2 + (-dy / len) * bulge
        bird.ctrlLat = (fromLat + target.lat) / 2 + (dx / len) * bulge
      }

      const motion = { t: 0 }
      tweens.push(
        gsap.to(motion, {
          t: 1,
          duration,
          ease: 'none',
          paused: !propsRef.current.playing,
          onUpdate: () => {
            const elapsed = motion.t * duration
            for (let i = 0; i < nextBirds.length; i += 1) {
              const bird = nextBirds[i]
              const startAt = (bird.delay ?? 0) * duration
              const travel = Math.max(0.8, (bird.travel ?? 0.7) * duration)
              const local = Math.min(1, Math.max(0, (elapsed - startAt) / travel))
              const eased = local * local * (3 - 2 * local)
              const u = 1 - eased
              bird.lng =
                u * u * bird.fromLng +
                2 * u * eased * bird.ctrlLng +
                eased * eased * bird.toLng
              bird.lat =
                u * u * bird.fromLat +
                2 * u * eased * bird.ctrlLat +
                eased * eased * bird.toLat
            }
            paint()
          },
          onComplete: () => {
            for (let i = 0; i < nextBirds.length; i += 1) {
              nextBirds[i].lng = targets[i].lng
              nextBirds[i].lat = targets[i].lat
              nextBirds[i].gbifID = targets[i].gbifID
            }
            paint()
          },
        }),
      )
    }

    if (immediate || tweens.length === 0) {
      paint()
      return
    }

    tweenRef.current = {
      pause() {
        tweens.forEach((t) => t.pause())
      },
      resume() {
        tweens.forEach((t) => t.resume())
      },
      timeScale(scale) {
        tweens.forEach((t) => t.timeScale(scale))
      },
      kill() {
        for (const { nextBirds, targets } of snapPairs) {
          for (let i = 0; i < nextBirds.length; i += 1) {
            nextBirds[i].lng = targets[i].lng
            nextBirds[i].lat = targets[i].lat
            nextBirds[i].gbifID = targets[i].gbifID
          }
        }
        tweens.forEach((t) => t.kill())
        paint()
      },
    }
    tweenRef.current.timeScale(propsRef.current.playSpeed || 1)
    paint()
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
    // Finish the month we were already heading toward, so a new month
    // doesn't keep blending from a half-finished previous one.
    if (tempPaintRef.current.tween && tempPaintRef.current.targetField) {
      tempPaintRef.current.field = tempPaintRef.current.targetField
    }
    const fromField = tempPaintRef.current.field

    killTempTween()
    tempPaintRef.current.key = key
    tempPaintRef.current.targetField = toField

    const skipAnim =
      immediate || !fromField || fromField.length !== toField.length

    if (skipAnim) {
      tempPaintRef.current.field = toField
      scheduleTempDraw({ step: TEMPERATURE.sampleStep })
      return
    }

    const state = { t: 0 }
    let lastPaint = 0
    // Land on this month quickly, then hold it so the colors match the timeline.
    let tween
    tween = gsap.to(state, {
      t: 1,
      duration: 1.4,
      ease: 'power1.inOut',
      paused: !propsRef.current.playing,
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
        if (tempPaintRef.current.tween !== tween) return
        tempPaintRef.current.field = toField
        tempPaintRef.current.tween = null
        drawTemperature({ step: TEMPERATURE.sampleStep })
      },
    })
    tween.timeScale(propsRef.current.playSpeed || 1)
    tempPaintRef.current.tween = tween
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
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
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
      // Follow mode moves the camera itself; don't treat that as a drag.
      if (followMoveRef.current) return
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

    map.on('moveend', () => {
      if (followMoveRef.current) return
      endMapDrag()
    })
    map.on('zoomend', () => {
      if (followMoveRef.current) return
      endMapDrag()
    })

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
    const resizeObserver = new ResizeObserver(() => {
      map.resize()
      scheduleDrawRef.current()
      scheduleTempDraw()
    })
    resizeObserver.observe(containerRef.current)
    requestAnimationFrame(() => map.resize())
    const resizeTimer = window.setTimeout(() => map.resize(), 300)

    trailTimerRef.current = window.setInterval(
      () => pushTrailSampleRef.current(),
      FLOCK.trailSampleMs,
    )

    // Continuous redraw so wing flaps stay alive even when the flock is idle.
    const flapLoop = () => {
      flapRafRef.current = window.requestAnimationFrame(flapLoop)
      if (flocksRef.current.size > 0) scheduleDrawRef.current()
    }
    flapRafRef.current = window.requestAnimationFrame(flapLoop)

    mapRef.current = map
    if (import.meta.env.DEV) window.__makeSenseMap = map

    return () => {
      window.clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      window.clearInterval(trailTimerRef.current)
      if (flapRafRef.current) window.cancelAnimationFrame(flapRafRef.current)
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      if (tempRafRef.current) window.cancelAnimationFrame(tempRafRef.current)
      window.removeEventListener('resize', onResize)
      killTween()
      killExtremeTween()
      killTempTween()
      readyRef.current = false
      flocksRef.current.clear()
      extremesRef.current = []
      extremeTargetRef.current = []
      tempPaintRef.current.key = null
      tempPaintRef.current.field = null
      tempPaintRef.current.gridMeta = null
      if (import.meta.env.DEV && window.__makeSenseMap === map) {
        delete window.__makeSenseMap
      }
      map.remove()
      mapRef.current = null
      threeFlockRef.current?.dispose()
      threeFlockRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stable signature — never put the records array itself in effect deps
  // (HMR / mistaken spreads have crashed MapView that way before).
  const flocksSignature = (flocks ?? [])
    .map(
      (f) =>
        `${f.id}:${f.flockSize}:${f.yearRecords?.length ?? 0}:${f.yearRecords?.[0]?.gbifID ?? ''}:${f.color}`,
    )
    .join('|')

  useEffect(() => {
    syncFlock({ immediate: false })
    syncExtremes({ immediate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, flocksSignature])

  const temperatureYearRef = useRef(year)
  useEffect(() => {
    const yearChanged = temperatureYearRef.current !== year
    temperatureYearRef.current = year
    syncTemperatureLayer({
      immediate: yearChanged && !propsRef.current.seasonGlide,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, temperaturePack])

  useEffect(() => {
    const scale = playSpeed || 1
    tweenRef.current?.timeScale?.(scale)
    extremeTweenRef.current?.timeScale?.(scale)
    tempPaintRef.current.tween?.timeScale?.(scale)
  }, [playSpeed])

  useEffect(() => {
    if (playing) {
      tweenRef.current?.resume?.()
      extremeTweenRef.current?.resume?.()
      tempPaintRef.current.tween?.resume?.()
    } else {
      tweenRef.current?.pause?.()
      extremeTweenRef.current?.pause?.()
      tempPaintRef.current.tween?.pause?.()
    }
  }, [playing])

  useEffect(() => {
    if (followId) return
    followArmedRef.current = false
    followEaseDoneRef.current = false
    followTargetRef.current = null
    followBirdIndexRef.current = null
    const wasFollowing = followMoveRef.current
    followMoveRef.current = false
    const map = mapRef.current
    if (!map || !readyRef.current || !wasFollowing) return
    map.easeTo({
      center: MAP.initialView.center,
      zoom: MAP.initialView.zoom,
      bearing: MAP.initialView.bearing,
      pitch: MAP.initialView.pitch,
      duration: 800,
    })
  }, [followId])

  return (
    <div className="map-stage">
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
      <canvas ref={birdCanvasRef} className="bird-canvas" aria-hidden="true" />
      <canvas ref={dimCanvasRef} className="dim-canvas" aria-hidden="true" />
    </div>
  )
}

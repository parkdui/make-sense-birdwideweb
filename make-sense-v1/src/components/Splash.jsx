import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import * as THREE from 'three'

const BIRD_COUNT = 96
const NEIGHBOR = 180
const MAX_SPEED = 1.15
const MAX_FORCE = 0.035
const FAR = new THREE.Vector3(1600, 260, -700)

// Classic three.js bird (mrdoob / the CodePen flock): nose on +X, wings on Z.
const BIRD_POSITIONS = new Float32Array([
  5, 0, 0,
  -5, 0, 0,
  -5, -2, 1,
  0, 2, -6,
  -3, 0, 0,
  2, 0, 0,
  0, 2, 6,
  2, 0, 0,
  -3, 0, 0,
])

const BIRD_WING = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  1, 0, 0,
])

const VERTEX = `
attribute float wing;
attribute float aPhase;
void main() {
  vec3 p = position;
  p.y += wing * sin(aPhase) * 5.0;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
`

function createSplashFlock(canvas) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
  } catch {
    return { setOpacity() {}, dispose() {} }
  }

  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 10000)
  camera.position.z = 320

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(BIRD_POSITIONS, 3))
  geometry.setAttribute('wing', new THREE.BufferAttribute(BIRD_WING, 1))
  const phases = new Float32Array(BIRD_COUNT)
  for (let i = 0; i < BIRD_COUNT; i += 1) phases[i] = Math.random() * 62.83
  const phaseAttr = new THREE.InstancedBufferAttribute(phases, 1)
  geometry.setAttribute('aPhase', phaseAttr)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#f3efe9') },
      uOpacity: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })

  const mesh = new THREE.InstancedMesh(geometry, material, BIRD_COUNT)
  mesh.frustumCulled = false
  scene.add(mesh)

  const boids = []
  for (let i = 0; i < BIRD_COUNT; i += 1) {
    boids.push({
      position: new THREE.Vector3(
        Math.random() * 460 - 230,
        Math.random() * 360 - 180,
        Math.random() * 460 - 230,
      ),
      velocity: new THREE.Vector3(
        Math.random() * 0.5 - 0.25,
        Math.random() * 0.5 - 0.25,
        Math.random() * 0.5 - 0.25,
      ),
      acceleration: new THREE.Vector3(),
      scale: 0.42 + Math.random() * 0.22,
    })
  }

  const dummy = new THREE.Object3D()
  const sep = new THREE.Vector3()
  const ali = new THREE.Vector3()
  const coh = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const toFar = new THREE.Vector3()
  const depart = { pull: 0 }
  const departTween = gsap.to(depart, {
    pull: 1,
    duration: 3.1,
    ease: 'power2.in',
    delay: 0.7,
  })

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }
  resize()
  window.addEventListener('resize', resize)

  let frame = 0
  let running = true

  const limit = (vector) => {
    if (vector.length() > MAX_FORCE) vector.setLength(MAX_FORCE)
    return vector
  }

  const step = () => {
    for (let i = 0; i < boids.length; i += 1) {
      const bird = boids[i]
      sep.set(0, 0, 0)
      ali.set(0, 0, 0)
      coh.set(0, 0, 0)
      let alignCount = 0
      let cohereCount = 0
      for (let j = 0; j < boids.length; j += 1) {
        if (i === j || Math.random() > 0.6) continue
        const other = boids[j]
        offset.copy(bird.position).sub(other.position)
        const distance = offset.length()
        if (distance <= 0 || distance > NEIGHBOR) continue
        sep.addScaledVector(offset, 1 / (distance * distance))
        ali.add(other.velocity)
        coh.add(other.position)
        alignCount += 1
        cohereCount += 1
      }
      bird.acceleration.set(0, 0, 0)
      toFar.copy(FAR).sub(bird.position).multiplyScalar(0.0014 * depart.pull)
      bird.acceleration.add(toFar)
      if (alignCount > 0) {
        ali.multiplyScalar(1 / alignCount)
        bird.acceleration.add(limit(ali))
      }
      if (cohereCount > 0) {
        coh.multiplyScalar(1 / cohereCount).sub(bird.position)
        bird.acceleration.add(limit(coh))
      }
      bird.acceleration.add(limit(sep))
      bird.velocity.add(bird.acceleration)
      if (bird.velocity.length() > MAX_SPEED) bird.velocity.setLength(MAX_SPEED)
      bird.position.add(bird.velocity)

      const speed = Math.max(bird.velocity.length(), 0.001)
      const yaw = Math.atan2(-bird.velocity.z, bird.velocity.x)
      const pitch = Math.asin(THREE.MathUtils.clamp(bird.velocity.y / speed, -1, 1))
      phases[i] = (phases[i] + Math.max(0, pitch) + 0.045) % 62.83
      dummy.position.copy(bird.position)
      dummy.rotation.set(0, yaw, pitch)
      dummy.scale.setScalar(bird.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    phaseAttr.needsUpdate = true
    mesh.instanceMatrix.needsUpdate = true
  }

  const render = () => {
    if (!running) return
    frame = window.requestAnimationFrame(render)
    step()
    renderer.render(scene, camera)
  }
  render()

  return {
    setOpacity(value) {
      material.uniforms.uOpacity.value = value
    },
    dispose() {
      running = false
      window.cancelAnimationFrame(frame)
      departTween.kill()
      window.removeEventListener('resize', resize)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}

export default function Splash({ onDone }) {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const wideWRef = useRef(null)
  const wideRestRef = useRef(null)
  const webWRef = useRef(null)
  const webRestRef = useRef(null)
  const callRef = useRef(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return undefined

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      const fade = gsap.to(root, {
        opacity: 0,
        duration: 0.35,
        onComplete: () => onDoneRef.current(),
      })
      return () => fade.kill()
    }

    const flock = createSplashFlock(canvas)

    const followLine = 'Following a flock of birds...'
    const typed = { count: 0 }
    const birdFade = { value: 1 }
    const wideGrow = { scale: 1 }
    const webGrow = { scale: 1 }
    const tl = gsap.timeline({
      onComplete: () => onDoneRef.current(),
    })

    const widen = (state, letter, rest, at) => {
      tl.to(
        state,
        {
          scale: 1.9,
          duration: 1.2,
          ease: 'power2.inOut',
          onUpdate: () => {
            letter.style.transform = `scaleX(${state.scale})`
            rest.style.transform = 'translateX(0px)'
            const gap = letter.getBoundingClientRect().right - rest.getBoundingClientRect().left
            // Serif W grows past its box; keep a little air before "ide" / "eb".
            const pad = letter.offsetWidth * 0.06 * (state.scale - 1)
            rest.style.transform = `translateX(${Math.max(0, gap) + pad}px)`
          },
        },
        at,
      )
    }
    widen(wideGrow, wideWRef.current, wideRestRef.current, 0.55)
    widen(webGrow, webWRef.current, webRestRef.current, 1.85)
    tl.to(
      typed,
      {
        count: followLine.length,
        duration: 2.1,
        ease: 'none',
        onUpdate: () => {
          if (callRef.current) {
            callRef.current.textContent = followLine.slice(0, Math.round(typed.count))
          }
        },
      },
      0.35,
    )
    tl.to(
      birdFade,
      {
        value: 0,
        duration: 1.45,
        ease: 'power2.in',
        onUpdate: () => flock.setOpacity(birdFade.value),
      },
      2.15,
    )
    tl.to(root, { opacity: 0, duration: 1.05, ease: 'power2.inOut' }, 3.75)

    return () => {
      tl.kill()
      flock.dispose()
    }
  }, [])

  return (
    <div className="splash" ref={rootRef} aria-hidden="true">
      <canvas className="splash__birds" ref={canvasRef} />
      <div className="splash__logo">
        <div className="splash__line">
          Bird
          <span className="splash__call" ref={callRef} />
        </div>
        <div className="splash__line">
          <span className="splash__w" ref={wideWRef}>
            W
          </span>
          <span className="splash__rest" ref={wideRestRef}>
            ide
          </span>
        </div>
        <div className="splash__line splash__line--web">
          <span className="splash__w" ref={webWRef}>
            W
          </span>
          <span className="splash__rest" ref={webRestRef}>
            eb
          </span>
        </div>
      </div>
    </div>
  )
}

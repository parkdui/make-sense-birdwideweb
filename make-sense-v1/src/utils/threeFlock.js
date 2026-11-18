import * as THREE from 'three'
import { headingFromTrail, markerForSpecies } from './birdMarkers.js'

/**
 * Map overlay of the classic three.js bird (mrdoob / the CodePen flock):
 * one shared mesh per species, wings displaced in the vertex shader.
 * Instanced so a few hundred birds stay a handful of draw calls.
 */

const MAX_PER_SPECIES = 256

const BIRD_POSITIONS = new Float32Array([
  // body
  5, 0, 0,
  -5, 0, 0,
  -5, -2, 1,
  // left wing (tip, root, root)
  0, 2, -6,
  -3, 0, 0,
  2, 0, 0,
  // right wing
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
attribute float aFlapHz;
uniform float uTime;

void main() {
  float flap = sin(uTime * aFlapHz + aPhase);
  vec3 p = position;
  // Classic demo: both wing tips rise and fall together.
  p.y += wing * flap * 6.0;

  // Pitch so a top-down map still sees the wing stroke.
  float pitch = -1.05;
  float cp = cos(pitch);
  float sp = sin(pitch);
  float y = p.y * cp - p.z * sp;
  float z = p.y * sp + p.z * cp;
  p.y = y;
  p.z = z;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`

const FRAGMENT = `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`

function makeBirdGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(BIRD_POSITIONS, 3))
  geometry.setAttribute('wing', new THREE.BufferAttribute(BIRD_WING, 1))
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_SPECIES), 1)
  const flapHz = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_SPECIES), 1)
  geometry.setAttribute('aPhase', phase)
  geometry.setAttribute('aFlapHz', flapHz)
  return geometry
}

function makeMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}

export function createThreeFlock(canvas) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
  } catch {
    return null
  }

  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -80, 80)
  camera.position.z = 20

  const dummy = new THREE.Object3D()
  const flocks = new Map()

  const ensure = (speciesId, color) => {
    let entry = flocks.get(speciesId)
    if (entry) {
      entry.material.uniforms.uColor.value.set(color)
      return entry
    }
    const geometry = makeBirdGeometry()
    const material = makeMaterial(color)
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_PER_SPECIES)
    mesh.count = 0
    mesh.frustumCulled = false
    scene.add(mesh)
    entry = { mesh, geometry, material }
    flocks.set(speciesId, entry)
    return entry
  }

  const resize = (width, height) => {
    const w = Math.max(2, width)
    const h = Math.max(2, height)
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio())
      || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false)
    }
    camera.left = -w / 2
    camera.right = w / 2
    camera.top = h / 2
    camera.bottom = -h / 2
    camera.updateProjectionMatrix()
    return { w, h }
  }

  return {
    sync({ map, birds, width, height, now }) {
      const { w, h } = resize(width, height)
      const time = now / 1000
      const seen = new Set()

      const bySpecies = new Map()
      for (const bird of birds) {
        if (!Number.isFinite(bird.lng) || !Number.isFinite(bird.lat)) continue
        const list = bySpecies.get(bird.speciesId) ?? []
        list.push(bird)
        bySpecies.set(bird.speciesId, list)
      }

      for (const [speciesId, list] of bySpecies) {
        const color = list[0].color || '#e10600'
        const entry = ensure(speciesId, color)
        seen.add(speciesId)
        const mesh = entry.mesh
        const marker = markerForSpecies(speciesId)
        const phaseAttr = entry.geometry.getAttribute('aPhase')
        const flapAttr = entry.geometry.getAttribute('aFlapHz')
        const n = Math.min(list.length, MAX_PER_SPECIES)
        mesh.count = n

        for (let i = 0; i < n; i += 1) {
          const bird = list[i]
          const projected = map.project([bird.lng, bird.lat])
          const heading = headingFromTrail(map, bird)
          bird.heading = heading
          const scale = marker.size * (bird.scaleJitter ?? 1) * 0.2

          dummy.position.set(projected.x - w / 2, h / 2 - projected.y, 0)
          dummy.rotation.set(0, 0, -heading)
          dummy.scale.set(scale, scale, scale)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)

          phaseAttr.setX(i, bird.phase ?? 0)
          flapAttr.setX(
            i,
            marker.flapHz * (bird.flapMul ?? 1) * Math.PI * 2,
          )
        }

        mesh.instanceMatrix.needsUpdate = true
        phaseAttr.needsUpdate = true
        flapAttr.needsUpdate = true
        entry.material.uniforms.uTime.value = time
      }

      for (const [id, entry] of flocks) {
        if (!seen.has(id)) entry.mesh.count = 0
      }

      renderer.render(scene, camera)
    },

    dispose() {
      for (const entry of flocks.values()) {
        entry.geometry.dispose()
        entry.material.dispose()
        scene.remove(entry.mesh)
      }
      flocks.clear()
      renderer.dispose()
    },
  }
}

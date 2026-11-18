import { useEffect, useRef } from 'react'
import gsap from 'gsap'

/** Soft scale on pointer enter, settling back on leave. */
export function useGentleHover(disabled = false) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const enter = () => {
      if (disabled || reduced || el.disabled) return
      gsap.to(el, {
        scale: 1.06,
        duration: 0.55,
        ease: 'power2.out',
        transformOrigin: '50% 50%',
        overwrite: 'auto',
      })
    }
    const leave = () => {
      if (reduced) return
      gsap.to(el, {
        scale: 1,
        duration: 0.75,
        ease: 'power2.inOut',
        overwrite: 'auto',
      })
    }

    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
      gsap.killTweensOf(el)
      gsap.set(el, { scale: 1 })
    }
  }, [disabled])

  return ref
}

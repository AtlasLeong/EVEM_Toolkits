import { useEffect } from 'react'

// CSS may hide the focused control before matchMedia delivers its change event.
// Remember that focus only until the user moves or deliberately blurs it.
export function useResponsiveDisclosureFocus({ mobileQuery, toggleRef, contentRef, setOpen }) {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(mobileQuery)
    let lastFocused = document.activeElement
    let frame = null
    const focusIn = event => { lastFocused = event.target }
    const focusOut = event => {
      if (event.relatedTarget || event.target.getClientRects().length) lastFocused = null
    }
    const resize = event => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      const active = document.activeElement
      const focused = active === document.body ? lastFocused : active
      if (!focused?.isConnected) return
      if (!event.matches && focused === toggleRef.current) {
        const candidates = contentRef.current?.querySelectorAll('input:not(:disabled), button:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || []
        const destination = Array.from(candidates).find(element => element.getClientRects().length) || contentRef.current
        destination?.focus({ preventScroll: true })
      } else if (event.matches && contentRef.current?.contains(focused)) {
        setOpen(true)
        frame = window.requestAnimationFrame(() => {
          frame = null
          if (document.activeElement !== document.body && document.activeElement !== focused) return
          if (focused.isConnected && focused.getClientRects().length) focused.focus({ preventScroll: true })
          else toggleRef.current?.focus({ preventScroll: true })
        })
      }
    }
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', focusOut)
    media.addEventListener('change', resize)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', focusOut)
      media.removeEventListener('change', resize)
    }
  }, [mobileQuery, toggleRef, contentRef, setOpen])
}

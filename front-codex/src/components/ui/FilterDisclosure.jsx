import { useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

// Native disclosure semantics keep keyboard and screen-reader state in sync.
export default function FilterDisclosure({ label, value, valueContent, disabled = false, className = '', children }) {
  const ref = useRef(null)
  const pointerFromInside = useRef(false)

  useEffect(() => {
    const closeOutside = (event) => {
      const node = ref.current
      pointerFromInside.current = Boolean(node?.open && node.contains(event.target))
      if (node?.open && !node.contains(event.target)) node.open = false
    }
    const finishPointer = () => { pointerFromInside.current = false }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('pointerup', finishPointer)
    document.addEventListener('pointercancel', finishPointer)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('pointerup', finishPointer)
      document.removeEventListener('pointercancel', finishPointer)
    }
  }, [])

  useEffect(() => {
    if (disabled && ref.current) ref.current.open = false
  }, [disabled])

  return (
    <details
      ref={ref}
      className={`filter-disclosure ${className} ${disabled ? 'is-disabled' : ''}`.trim()}
      onBlur={(event) => {
        // Clicking internal blank space can focus a tabIndex=-1 ancestor outside
        // details. Keep that pointer interaction open; collapsing during the
        // native focus move can crash Chromium. Keyboard exits still close.
        if (!pointerFromInside.current && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.open = false
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          ref.current.open = false
          ref.current.querySelector('summary').focus()
        }
      }}
    >
      <summary
        className="filter-toggle"
        aria-disabled={disabled}
        aria-label={`${label}：${value}`}
        onClick={(event) => { if (disabled) event.preventDefault() }}
      >
        <span className="filter-label">{label}</span>
        <span className="filter-value" title={value}>{valueContent ?? value}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="filter-popover">{children}</div>
    </details>
  )
}

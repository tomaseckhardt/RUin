import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Escape should only close the topmost modal when more than one is open at
// once (e.g. an incoming-ping notification arriving while a PIN/composer
// modal is already up) - this tracks which mounted instances are open, in
// open order, so only the last one reacts to Escape.
let openModalStack = []
let bodyOverflowBeforeModals = ''

// Escape in a text field that already has a draft (e.g. a photo comment)
// would throw the draft away with the modal.
const TEXT_FIELD_SELECTOR = 'textarea, input:not([type]), input[type="text"], input[type="search"]'

// The close animation needs the Web Animations API to know when it's done;
// without it (jsdom in the tests) the modal just unmounts.
const CAN_ANIMATE_EXIT = typeof Element !== 'undefined' && 'getAnimations' in Element.prototype

function ModalOverlay({ open, onClose, labelledBy, children }) {
  const containerRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const instanceIdRef = useRef(null)
  // Stays true after `open` turns false until the close animation finishes,
  // showing the last children meanwhile (the parent may already have cleared them).
  const [isRendered, setIsRendered] = useState(open)
  const [lastChildren, setLastChildren] = useState(children)

  if (open && children !== lastChildren) {
    setLastChildren(children)
  }

  if (open && !isRendered) {
    setIsRendered(true)
  } else if (!open && isRendered && !CAN_ANIMATE_EXIT) {
    setIsRendered(false)
  }

  const isClosing = !open && isRendered

  useEffect(() => {
    if (!isClosing) {
      return undefined
    }

    let cancelled = false
    const animations = containerRef.current?.getAnimations({ subtree: true }) ?? []

    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) {
        setIsRendered(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isClosing])

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    if (instanceIdRef.current === null) {
      instanceIdRef.current = Symbol('modal-overlay')
    }

    const instanceId = instanceIdRef.current

    // The page behind stays put while any modal is open; the first one to
    // open saves the body's overflow and the last one to close restores it.
    if (openModalStack.length === 0) {
      bodyOverflowBeforeModals = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    openModalStack.push(instanceId)

    const container = containerRef.current
    const previouslyFocused = document.activeElement
    const focusable = container?.querySelectorAll(FOCUSABLE_SELECTOR)

    if (focusable && focusable.length > 0) {
      focusable[0].focus()
    } else {
      container?.focus()
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        // defaultPrevented: something inside (e.g. the date picker) already
        // handled this Escape itself.
        if (openModalStack[openModalStack.length - 1] !== instanceId || event.defaultPrevented) {
          return
        }

        if (event.target instanceof Element && event.target.matches(TEXT_FIELD_SELECTOR) && event.target.value) {
          return
        }

        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !container) {
        return
      }

      const focusableEls = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))

      if (focusableEls.length === 0) {
        return
      }

      const first = focusableEls[0]
      const last = focusableEls[focusableEls.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      openModalStack = openModalStack.filter((entry) => entry !== instanceId)

      if (openModalStack.length === 0) {
        document.body.style.overflow = bodyOverflowBeforeModals
      }

      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus()
      }
    }
  }, [open])

  if (!isRendered) {
    return null
  }

  // Rendered into <body>: a modal opened from inside a .panel (e.g. the photo
  // lightbox) would otherwise be positioned against that panel, because its
  // backdrop-filter makes it the containing block for `fixed` descendants.
  return createPortal(
    <section
      ref={containerRef}
      tabIndex={-1}
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      data-closing={isClosing ? '' : undefined}
      inert={isClosing}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current()
        }
      }}>
      {open ? children : lastChildren}
    </section>,
    document.body,
  )
}

export default ModalOverlay

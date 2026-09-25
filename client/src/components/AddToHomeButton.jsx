import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useI18n } from '../lib/i18n.js'

const MOBILE_QUERY = '(max-width: 767px)'

function isIosLikeDevice() {
  if (typeof window === 'undefined') {
    return false
  }

  const ua = window.navigator.userAgent || ''
  const platform = window.navigator.platform || ''

  // iPadOS can report "MacIntel" platform with touch support.
  const ipadOs = platform === 'MacIntel' && window.navigator.maxTouchPoints > 1

  return /iPhone|iPad|iPod/i.test(ua) || ipadOs
}

function isStandaloneMode() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function AddToHomeButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isMobile, setIsMobile] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const { t } = useI18n()

  const iosInstall = useMemo(() => isIosLikeDevice(), [])

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY)

    const syncMobileState = () => {
      setIsMobile(mediaQuery.matches)
    }

    const syncInstalledState = () => {
      setIsInstalled(isStandaloneMode())
    }

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setDeferredPrompt(event)
    }

    const handleInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }

    syncMobileState()
    syncInstalledState()

    mediaQuery.addEventListener('change', syncMobileState)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      mediaQuery.removeEventListener('change', syncMobileState)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  async function handleClick() {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
      return
    }

    if (iosInstall) {
      toast.info(t('addToHome.iosHint'))
    }
  }

  const canShow = isMobile && !isInstalled && (Boolean(deferredPrompt) || iosInstall)

  if (!canShow) {
    return null
  }

  return (
    <button type="button" className="secondary-button" onClick={handleClick}>
      {t('addToHome.button')}
    </button>
  )
}

export default AddToHomeButton

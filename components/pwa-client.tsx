'use client'

import { useEffect, useState } from 'react'
import { getOneSignalClient, type InstallPromptEvent, type OneSignalClient } from '@/lib/onesignal-client'

const installedStorageKey = 'trade-smart-live-app-installed'

async function prepareServiceWorkers() {
  if (!('serviceWorker' in navigator)) return

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const rootScope = new URL('/', window.location.origin).href
    const staleOneSignalRegistrations = registrations.filter((registration) => {
      if (registration.scope !== rootScope) return false
      return [registration.active, registration.waiting, registration.installing].some((worker) => {
        if (!worker) return false
        try {
          return new URL(worker.scriptURL).pathname === '/OneSignalSDKWorker.js'
        } catch {
          return false
        }
      })
    })
    await Promise.all(staleOneSignalRegistrations.map((registration) => registration.unregister()))

    const appRegistration = await navigator.serviceWorker.register('/sw.js')
    await appRegistration.update()
  } catch (error) {
    console.error('[PWA] Service worker preparation failed.', error instanceof Error ? error.message : 'Unknown error.')
  }
}

export default function PwaClient({ appId }: { appId: string }) {
  useEffect(() => {
    const serviceWorkersReady = prepareServiceWorkers()

    const onInstallPrompt = (event: Event) => {
      event.preventDefault()
      window.tradeSmartInstallPrompt = event as InstallPromptEvent
      window.dispatchEvent(new Event('trade-smart-install-prompt'))
    }
    const onAppInstalled = () => {
      window.tradeSmartAppInstalled = true
      window.tradeSmartInstallPrompt = null
      try {
        window.localStorage.setItem(installedStorageKey, 'true')
      } catch {
        // The app can still run if browser storage is unavailable.
      }
      window.dispatchEvent(new Event('trade-smart-app-installed'))
    }

    window.addEventListener('beforeinstallprompt', onInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    if (appId && !window.tradeSmartOneSignal && !window.tradeSmartOneSignalInitQueued) {
      window.tradeSmartOneSignalInitQueued = true
      window.OneSignalDeferred = window.OneSignalDeferred || []
      window.OneSignalDeferred.push(async (oneSignal) => {
        try {
          await serviceWorkersReady
          await oneSignal.init({
            appId,
            allowLocalhostAsSecureOrigin: true,
            serviceWorkerPath: 'onesignal/OneSignalSDKWorker.js',
            serviceWorkerParam: { scope: '/onesignal/' },
            notifyButton: { enable: false },
          })
          window.tradeSmartOneSignal = oneSignal
          const notifyStatusChange = () => window.dispatchEvent(new Event('trade-smart-onesignal-status-change'))
          oneSignal.Notifications.addEventListener('permissionChange', notifyStatusChange)
          oneSignal.User.PushSubscription.addEventListener?.('change', notifyStatusChange)
          window.dispatchEvent(new Event('trade-smart-onesignal-ready'))
        } catch (error) {
          console.warn('[OneSignal] SDK initialization failed.', error instanceof Error ? error.message : 'Unknown error.')
          window.tradeSmartOneSignalInitError = true
          window.tradeSmartOneSignalInitQueued = false
          window.dispatchEvent(new Event('trade-smart-onesignal-error'))
        }
      })
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [appId])

  return null
}

export function PushNotificationsButton() {
  const [status, setStatus] = useState({ label: 'Checking notification support…', canEnable: false, enabled: false })
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    const refreshStatus = () => setStatus(getPushStatus(getOneSignalClient()))
    const onOneSignalError = () => setStatus({ label: 'Push alerts could not load. Refresh the app or check your connection.', canEnable: false, enabled: false })
    window.addEventListener('trade-smart-onesignal-ready', refreshStatus)
    window.addEventListener('trade-smart-onesignal-status-change', refreshStatus)
    window.addEventListener('trade-smart-onesignal-error', onOneSignalError)
    window.addEventListener('trade-smart-app-installed', refreshStatus)
    refreshStatus()
    return () => {
      window.removeEventListener('trade-smart-onesignal-ready', refreshStatus)
      window.removeEventListener('trade-smart-onesignal-status-change', refreshStatus)
      window.removeEventListener('trade-smart-onesignal-error', onOneSignalError)
      window.removeEventListener('trade-smart-app-installed', refreshStatus)
    }
  }, [])

  async function enablePushNotifications() {
    const client = getOneSignalClient()
    if (!client || !status.canEnable || isRequesting) return
    setIsRequesting(true)
    try {
      await client.Notifications.requestPermission()
      if (client.Notifications.permission) await client.User.PushSubscription.optIn()
      setStatus(getPushStatus(client))
    } catch {
      setStatus({ label: 'Could not enable alerts. Check your browser notification settings and try again.', canEnable: true, enabled: false })
    } finally {
      setIsRequesting(false)
    }
  }

  return <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-3">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p role="status" aria-live="polite" className="text-xs leading-relaxed text-slate-300">{status.label}</p>
      <button type="button" onClick={() => void enablePushNotifications()} disabled={!status.canEnable || status.enabled || isRequesting} className="h-10 shrink-0 rounded-lg bg-cyan-300 px-3 text-xs font-bold text-slate-950 transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">
        {isRequesting ? 'Enabling…' : status.enabled ? 'Alerts enabled' : 'Enable instant alerts'}
      </button>
    </div>
  </div>
}

function getPushStatus(client: OneSignalClient | null) {
  if (!client && window.tradeSmartOneSignalInitError) return { label: 'Push alerts could not load. Refresh the app or check your connection.', canEnable: false, enabled: false }
  if (!client) return { label: 'Notification settings are loading…', canEnable: false, enabled: false }
  if (!client.Notifications.isPushSupported()) return { label: 'Push alerts are not supported by this browser.', canEnable: false, enabled: false }
  if (typeof Notification === 'undefined') return { label: 'This browser cannot check notification permission.', canEnable: false, enabled: false }
  if (Notification.permission === 'denied') return { label: 'Notifications are blocked. Allow them in your browser settings to receive signal alerts.', canEnable: false, enabled: false }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (isIOS && !isStandalone) return { label: 'On iPhone and iPad, add this app to the Home Screen and open it there before enabling push alerts.', canEnable: false, enabled: false }
  if (Notification.permission !== 'granted') return { label: 'Instant signal alerts are off. Allow notifications to receive VIP signals on this device.', canEnable: true, enabled: false }
  if (!client.User.PushSubscription.optedIn) return { label: 'Permission is granted. Finish subscribing to signal alerts on this device.', canEnable: true, enabled: false }
  return { label: 'Instant VIP signal alerts are on for this device.', canEnable: false, enabled: true }
}

export function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const syncPrompt = () => setInstallPrompt(window.tradeSmartInstallPrompt ?? null)
    const clearPrompt = () => setInstallPrompt(null)
    window.addEventListener('trade-smart-install-prompt', syncPrompt)
    window.addEventListener('trade-smart-app-installed', clearPrompt)
    syncPrompt()
    return () => {
      window.removeEventListener('trade-smart-install-prompt', syncPrompt)
      window.removeEventListener('trade-smart-app-installed', clearPrompt)
    }
  }, [])

  if (!installPrompt) return null
  return <button type="button" onClick={() => void (async () => {
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    window.tradeSmartInstallPrompt = null
    setInstallPrompt(null)
    if (choice.outcome === 'accepted') {
      window.tradeSmartAppInstalled = true
      try {
        window.localStorage.setItem(installedStorageKey, 'true')
      } catch {
        // The app can still continue if browser storage is unavailable.
      }
    }
  })().catch(() => setInstallPrompt(null))} className="mt-4 h-11 w-full rounded-lg border border-cyan-400/40 bg-cyan-400/10 text-sm font-bold tracking-wide text-cyan-200 active:scale-95">Install App</button>
}

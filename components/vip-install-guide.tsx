'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { PushNotificationsButton } from './pwa-client'
import type { InstallPromptEvent } from '@/lib/onesignal-client'

type VipInstallGuideProps = { onContinue: () => void }

export default function VipInstallGuide({ onContinue }: VipInstallGuideProps) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const refreshInstallState = () => {
      setInstallPrompt(window.tradeSmartInstallPrompt ?? null)
      setIsInstalled(window.tradeSmartAppInstalled === true || isRunningStandalone())
    }
    const onPromptAvailable = () => setInstallPrompt(window.tradeSmartInstallPrompt ?? null)
    const onInstalled = () => setIsInstalled(true)

    refreshInstallState()
    window.addEventListener('trade-smart-install-prompt', onPromptAvailable)
    window.addEventListener('trade-smart-app-installed', onInstalled)
    return () => {
      window.removeEventListener('trade-smart-install-prompt', onPromptAvailable)
      window.removeEventListener('trade-smart-app-installed', onInstalled)
    }
  }, [])

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    window.tradeSmartInstallPrompt = null
    setInstallPrompt(null)
    if (choice.outcome === 'accepted') {
      setIsInstalled(true)
      window.tradeSmartAppInstalled = true
      try {
        window.localStorage.setItem('trade-smart-live-app-installed', 'true')
      } catch {
        // The app can still continue if browser storage is unavailable.
      }
    }
  }

  return <motion.div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section role="dialog" aria-modal="true" aria-labelledby="vip-install-title" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        onContinue()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => element.offsetParent !== null)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }} className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-400/30 bg-[#0b1220] p-5 shadow-2xl shadow-black/50 sm:p-6" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">VIP setup</p>
      <h2 ref={titleRef} tabIndex={-1} id="vip-install-title" className="mt-2 text-xl font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:text-2xl">Install Trade Smart Live</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">Add the app to your device for faster access and instant signal alerts.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-4" aria-labelledby="android-install-title">
          <h3 id="android-install-title" className="text-sm font-semibold text-white">Android · Chrome</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">Tap the browser menu (⋮), then choose <span className="font-semibold text-white">Install app</span> or <span className="font-semibold text-white">Add to Home screen</span>.</p>
        </section>
        <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-4" aria-labelledby="ios-install-title">
          <h3 id="ios-install-title" className="text-sm font-semibold text-white">iPhone / iPad · Safari</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">Tap Share (the ↑ box icon), scroll down, then tap <span className="font-semibold text-white">Add to Home Screen</span>.</p>
        </section>
      </div>
      <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-2.5 text-xs leading-relaxed text-amber-100">On iPhone and iPad, web push notifications require adding this app to the Home Screen first.</p>

      {installPrompt && <button type="button" onClick={() => void installApp().catch(() => setInstallPrompt(null))} className="mt-4 h-11 w-full rounded-lg bg-cyan-300 px-4 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-200">Install app</button>}
      {isInstalled && <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-sm text-emerald-200">App installed. You can enable alerts below.</p>}

      <PushNotificationsButton />
      <button type="button" onClick={onContinue} className="mt-4 h-11 w-full rounded-lg border border-slate-600 bg-slate-800/80 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-700">Got it / Continue to Signals</button>
    </motion.section>
  </motion.div>
}

function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

'use client'

import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import { Bell, CalendarDays, Check, LayoutDashboard, LockKeyhole, NotebookPen, Sparkles, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import TipsFeed from './tips-feed'
import JournalTab from './journal-tab'
import { cn } from '@/lib/utils'
import { subscribeToSignals } from '@/lib/firestore'
import { PwaInstallButton, PushNotificationsButton } from './pwa-client'
import VipInstallGuide from './vip-install-guide'
import { getOneSignalClient } from '@/lib/onesignal-client'
import SignalCard, { type Signal } from './signal-card'
import PaymentModal from './payment-modal'
import ProfileTab from './profile-tab'
import type { DeviceProfile } from '@/lib/device-profile-types'

type DeviceIdentity = { deviceToken: string; referralCode: string | null }
type DeviceProfileKey = readonly [string, DeviceIdentity]
const deviceTokenPattern = /^[a-f0-9]{64}$/
const referralCodePattern = /^REF-[A-HJ-NP-Z2-9]{6}$/
const installGuideDismissedKey = 'trade-smart-live-install-guide-dismissed'
const appInstalledKey = 'trade-smart-live-app-installed'

function playSignalAlert() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return

  try {
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.12)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.075, context.currentTime + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.23)
    window.setTimeout(() => { void context.close() }, 350)
  } catch {
    // Browser audio can be unavailable until a user gesture.
  }
}

async function fetchDeviceProfile([url, identity]: DeviceProfileKey) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(identity),
  })
  const result = await response.json() as { profile?: DeviceProfile; error?: string }
  if (!response.ok || !result.profile) throw new Error(result.error || 'Could not sync your device profile.')
  try {
    window.localStorage.setItem('trade-smart-live-device-id', result.profile.deviceId)
  } catch {
    // The server profile remains authoritative if browser storage is unavailable.
  }
  return result.profile
}

const spring = { type: 'spring' as const, stiffness: 420, damping: 28 }
const freeBenefits = ['Basic Market Insights & Daily Tips']
const vipBenefits = [
  'Instant Lock-Screen Alerts',
  'High-Precision Gold & Forex Setups',
  'Live Trade Management',
  'Direct Analyst Notes & Risk Breakdown',
]

export default function VipForexApp() {
  const router = useRouter()
  const brandTapCount = useRef(0)
  const brandTapTimer = useRef<number | null>(null)
  const [activeTab, setActiveTab] = useState('Signals')
  const [signals, setSignals] = useState<Signal[]>([])
  const [history, setHistory] = useState<Signal[]>([])
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null)
  const [deviceSetupError, setDeviceSetupError] = useState('')
  const [pricingOpen, setPricingOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [installGuideOpen, setInstallGuideOpen] = useState(false)
  const signalVersionRef = useRef('')
  const isVipRef = useRef(false)
  const vipSyncVersionRef = useRef(0)
  const knownSignalIdsRef = useRef<Set<string> | null>(null)
  const hasSeenServerSignalSnapshotRef = useRef(false)
  const profileKey: DeviceProfileKey | null = deviceIdentity ? ['/api/device', deviceIdentity] : null
  const {
    data: deviceProfile,
    error: deviceProfileError,
    isLoading: deviceProfileLoading,
    mutate: refreshDeviceProfile,
  } = useSWR<DeviceProfile, Error, DeviceProfileKey | null>(profileKey, fetchDeviceProfile, {
    refreshInterval: (profile) => profile ? 15_000 : 0,
    revalidateOnFocus: true,
    dedupingInterval: 10_000,
  })
  const isVip = deviceProfile?.vipActive === true
  const isCheckingMembership = !deviceProfile && !deviceProfileError && !deviceSetupError

  useEffect(() => {
    try {
      let deviceToken = window.localStorage.getItem('trade-smart-live-device-token')
      if (!deviceToken || !deviceTokenPattern.test(deviceToken)) {
        const bytes = window.crypto.getRandomValues(new Uint8Array(32))
        deviceToken = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
        window.localStorage.setItem('trade-smart-live-device-token', deviceToken)
      }

      let referralCode = window.localStorage.getItem('trade-smart-live-referral-code')
      if (referralCode && !referralCodePattern.test(referralCode)) {
        window.localStorage.removeItem('trade-smart-live-referral-code')
        referralCode = null
      }

      const currentUrl = new URL(window.location.href)
      const incomingReferralCode = currentUrl.searchParams.get('ref')?.trim().toUpperCase() ?? ''
      if (!referralCode && referralCodePattern.test(incomingReferralCode)) {
        referralCode = incomingReferralCode
        window.localStorage.setItem('trade-smart-live-referral-code', referralCode)
      }
      if (currentUrl.searchParams.has('ref')) {
        currentUrl.searchParams.delete('ref')
        window.history.replaceState(window.history.state, '', currentUrl.toString())
      }

      setDeviceIdentity({ deviceToken, referralCode })
    } catch {
      setDeviceSetupError('This browser could not save a persistent device profile. Enable site storage and reload to continue.')
    }
  }, [])

  useEffect(() => {
    isVipRef.current = isVip
  }, [isVip])

  useEffect(() => {
    const unsubscribe = subscribeToSignals((records, fromCache) => {
      const currentIds = new Set(records.map((record) => record.id))
      if (fromCache === false) {
        if (hasSeenServerSignalSnapshotRef.current && knownSignalIdsRef.current) {
          const hasNewActiveSignal = records.some((record) => record.status === 'ACTIVE' && !knownSignalIdsRef.current?.has(record.id))
          if (isVipRef.current && document.visibilityState === 'visible' && hasNewActiveSignal) playSignalAlert()
        }
        hasSeenServerSignalSnapshotRef.current = true
      }
      knownSignalIdsRef.current = currentIds

      const version = JSON.stringify(records.map((record) => [record.id, record.status, record.pair, record.action, record.entry, record.tp1, record.tp2, record.tp3, record.tp4, record.sl, record.notes, record.chartImagePath]))
      if (version === signalVersionRef.current) return
      signalVersionRef.current = version
      const liveSignals = records.map((record) => ({ id: record.id, pair: record.pair, direction: record.action, entry: record.entry, tp: record.tp1, sl: record.sl, tp2: record.tp2, tp3: record.tp3, tp4: record.tp4, notes: record.notes, hasChartImage: Boolean(record.chartImagePath), time: '', status: record.status, createdAt: record.createdAt }))
      setSignals(liveSignals.filter((signal) => signal.status === 'ACTIVE'))
      setHistory(liveSignals.filter((signal) => signal.status !== 'ACTIVE'))
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!deviceProfile) return

    const syncVipAudience = () => {
      const oneSignal = getOneSignalClient()
      if (!oneSignal) return
      const syncVersion = ++vipSyncVersionRef.current

      void (async () => {
        await oneSignal.login(deviceProfile.deviceId)
        if (syncVersion !== vipSyncVersionRef.current) return

        if (deviceProfile.vipActive) {
          await oneSignal.User.addTag('vip', 'true')
        } else {
          await oneSignal.User.removeTag('vip')
        }
      })().catch((error: unknown) => {
        if (syncVersion !== vipSyncVersionRef.current) return
        console.error('[OneSignal] VIP audience sync failed.', error instanceof Error ? error.message : 'Unknown error.')
      })
    }

    syncVipAudience()
    window.addEventListener('trade-smart-onesignal-ready', syncVipAudience)
    return () => {
      vipSyncVersionRef.current += 1
      window.removeEventListener('trade-smart-onesignal-ready', syncVipAudience)
    }
  }, [deviceProfile?.deviceId, deviceProfile?.vipActive])

  useEffect(() => {
    if (!deviceProfile?.vipActive) return

    const returnUrl = new URL(window.location.href)
    if (returnUrl.searchParams.get('payment') === 'return') {
      returnUrl.searchParams.delete('payment')
      returnUrl.searchParams.delete('paymentReference')
      window.history.replaceState(window.history.state, '', returnUrl.toString())
    }

    const isInstalled = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    let wasDismissed = false
    let wasInstalled = window.tradeSmartAppInstalled === true || isInstalled
    try {
      wasDismissed = window.localStorage.getItem(installGuideDismissedKey) === 'true'
      wasInstalled = wasInstalled || window.localStorage.getItem(appInstalledKey) === 'true'
    } catch {
      // The guide can still be dismissed for this session if storage is unavailable.
    }
    if (!wasDismissed && !wasInstalled) setInstallGuideOpen(true)
  }, [deviceProfile?.vipActive])

  useEffect(() => {
    if (isVip || activeTab !== 'Signals') return
    const previousBodyOverflow = document.body.style.overflow
    const previousDocumentOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
    }
  }, [activeTab, isVip])

  function handleBrandTap() {
    brandTapCount.current += 1
    if (brandTapTimer.current) window.clearTimeout(brandTapTimer.current)
    if (brandTapCount.current >= 3) {
      brandTapCount.current = 0
      router.push('/admin')
      return
    }
    brandTapTimer.current = window.setTimeout(() => { brandTapCount.current = 0 }, 900)
  }
  const tabs = [['Signals', LayoutDashboard], ['Journal', NotebookPen], ['Tips', Sparkles], ['Profile', UserRound]] as const

  return <main className="mx-auto min-h-screen w-full max-w-md overflow-x-hidden bg-[#050814] text-slate-100 selection:bg-cyan-300 selection:text-slate-950">
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden border-x border-slate-800/80 bg-[#050814]"><header className="flex items-center justify-between border-b border-[#27272a] px-4 pb-5 pt-6"><button type="button" aria-label="Trade Smart Live" onClick={handleBrandTap} className="relative z-30 pointer-events-auto flex items-center gap-3 text-left transition-transform active:scale-95"><div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-blue-400/30 bg-white shadow-lg shadow-blue-950/30"><Image src="/logo.png" alt="" width={36} height={36} priority className="size-full object-contain" /></div><div className="min-w-0 overflow-hidden"><p className="whitespace-nowrap bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-600 bg-clip-text text-sm font-bold uppercase tracking-[0.2em] text-transparent">TRADE SMART LIVE</p><p className="mt-0.5 whitespace-nowrap bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-600 bg-clip-text text-sm font-bold text-transparent">Trade Smart Live</p></div></button><div className="flex gap-2"><button type="button" aria-label="Notifications" className="grid h-9 w-9 touch-manipulation place-items-center rounded-lg border border-slate-800/80 bg-slate-900/70 text-zinc-400 shadow-2xl shadow-indigo-950/20 transition-all active:scale-95"><Bell size={16} /></button></div></header>
      <div className="relative z-30 grid grid-cols-3 pointer-events-auto border-b border-[#27272a] bg-slate-950 p-1"><button onClick={() => setActiveTab('Signals')} className={`relative z-40 pointer-events-auto min-w-0 overflow-hidden px-1 text-center touch-manipulation whitespace-nowrap rounded-md py-2 text-[9px] font-bold tracking-tight transition-all active:scale-95 ${activeTab === 'Signals' ? 'bg-[#27272a] text-white' : 'text-slate-300'}`}><span className="hidden sm:inline">VIP Signals</span><span className="sm:hidden">Signals</span></button><button onClick={() => setActiveTab('History')} className={`relative z-40 pointer-events-auto min-w-0 overflow-hidden px-1 text-center touch-manipulation whitespace-nowrap rounded-md py-2 text-[9px] font-bold tracking-tight transition-all active:scale-95 ${activeTab === 'History' ? 'bg-[#27272a] text-white' : 'text-slate-300'}`}><span className="hidden sm:inline">Track Record</span><span className="sm:hidden">History</span></button><button onClick={() => setActiveTab('Journal')} className={`relative z-40 pointer-events-auto min-w-0 overflow-hidden px-1 text-center touch-manipulation whitespace-nowrap rounded-md py-2 text-[9px] font-bold tracking-tight transition-all active:scale-95 ${activeTab === 'Journal' ? 'bg-[#27272a] text-white' : 'text-slate-300'}`}><span className="hidden sm:inline">Journal</span><span className="sm:hidden">Journal</span></button></div>
      <section aria-label="Current tab content" className="min-w-0 flex-1 px-4 pb-28 pt-6">
        {activeTab === 'Signals' && <>
          <div className={!isVip ? 'blur-md pointer-events-none select-none opacity-60' : ''}>
            <div className="mb-4 flex items-center justify-between"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-slate-300">Live feed</p><p className="mt-1 text-sm text-zinc-300">{signals.length} active signals</p></div></div>
            <div className="min-h-[240px]">
              {signals.map((signal, index) => <SignalCard key={signal.id} signal={signal} index={index} isLocked={!isVip} deviceToken={deviceIdentity?.deviceToken ?? null} />)}
              {isVip && signals.length === 0 && <p className="rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-400">No live signals yet.</p>}
            </div>
          </div>
          {!isVip && !isCheckingMembership && <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-4 pb-16">
            <div className="pointer-events-auto mx-auto w-full max-w-sm rounded-2xl border border-cyan-500/30 bg-[#0a101d]/85 p-5 text-center shadow-2xl shadow-blue-950/50 backdrop-blur-md">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-cyan-300"><LockKeyhole size={19} /></div>
              <h2 className="mt-3 text-lg font-bold text-white">VIP Signals Locked</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">Unlock the feed to see exact entries and live trade management.</p>
              <button onClick={() => setPricingOpen(true)} className="mt-5 w-full rounded-xl bg-cyan-400 px-4 py-3.5 text-sm font-semibold leading-snug text-slate-950 transition-colors hover:bg-cyan-300 touch-manipulation">Unlock VIP Access for ₦15,000/mo</button>
            </div>
          </div>}
        </>}
        {activeTab === 'History' && <HistoryView signals={history} />}
        {activeTab === 'Journal' && <JournalTab deviceToken={deviceIdentity?.deviceToken ?? null} />}
        {activeTab === 'Tips' && <TipsFeed />}
        {activeTab === 'Profile' && <div className="flex flex-col gap-4"><ProfileTab profile={deviceProfile} isLoading={deviceProfileLoading} error={deviceSetupError || deviceProfileError?.message} onRetry={() => { if (deviceIdentity) void refreshDeviceProfile(); else window.location.reload() }} onUpgrade={() => setPricingOpen(true)} /><PushNotificationsButton /><PwaInstallButton /></div>}
      </section>
      <nav aria-label="Primary navigation" className="fixed bottom-0 left-0 right-0 z-50 pointer-events-auto border-t border-slate-800/80 bg-[#050814]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"><div className="mx-auto flex h-16 w-full max-w-md items-center justify-around pointer-events-auto">{tabs.map(([label, Icon]) => <button type="button" key={label} onClick={() => setActiveTab(label)} aria-current={activeTab === label ? 'page' : undefined} className={`relative z-10 flex h-full min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${activeTab === label ? 'text-cyan-300' : 'text-slate-300'}`}><Icon size={18} strokeWidth={activeTab === label ? 2.2 : 1.8} /><span>{label}</span></button>)}</div></nav>
    </div>
    <AnimatePresence>{pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} onUnlock={() => { setPricingOpen(false); setPaymentOpen(true) }} />}</AnimatePresence>
    <AnimatePresence>{paymentOpen && <PaymentModal onClose={() => setPaymentOpen(false)} deviceToken={deviceIdentity?.deviceToken ?? null} />}</AnimatePresence>
    <AnimatePresence>{installGuideOpen && <VipInstallGuide onContinue={() => {
      try {
        window.localStorage.setItem(installGuideDismissedKey, 'true')
      } catch {
        // The guide is dismissed for this session if storage is unavailable.
      }
      setInstallGuideOpen(false)
      setActiveTab('Signals')
    }} />}</AnimatePresence>
  </main>
}

function HistoryView({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) return <p className="rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-400">No closed signals yet.</p>
  const wins = signals.filter((signal) => signal.status === 'WIN').length
  const winRate = Math.round((wins / signals.length) * 100)
  return <div>
    <div className="rounded-2xl border border-cyan-400/30 bg-gradient-to-r from-cyan-400/10 via-blue-500/10 to-indigo-500/10 p-5 shadow-lg shadow-cyan-950/20"><p className="font-mono text-2xl font-bold text-white">Win Rate: <span className="text-cyan-300">{winRate}%</span></p></div>
    <div className="mt-5 flex flex-col gap-3">{signals.map((signal) => { const isWin = signal.status === 'WIN'; return <article key={signal.id} className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-4"><div className="flex min-w-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate font-bold text-white">{signal.pair}</h3><span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold tracking-wide ${signal.direction === 'BUY' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{signal.direction}</span></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold tracking-wide ${isWin ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{isWin ? 'WIN' : 'LOSS'}</span></div><div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800 pt-3"><span className="font-mono text-sm font-bold text-slate-300">Entry: {signal.entry}</span><span className="text-right text-sm text-slate-400">{isWin ? 'Closed in profit' : 'Stopped out'}</span></div></article> })}</div>
  </div>
}
type EconomicEvent = { id: string; title: string; currency: string; releaseAt: string; impact: 'HIGH' | 'MEDIUM' | 'LOW'; forecast: string; previous: string }
const fetchCalendar = (url: string) => fetch(url).then((response) => response.json() as Promise<{ events: EconomicEvent[]; error?: string }>)
function formatEventTime(value: string) { const parts = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(value)); const formatted = parts.map((part) => part.type === 'dayPeriod' ? part.value.toUpperCase() : part.value).join(''); return `${formatted} WAT` }
function explainEvent(title: string) { const name = title.toLowerCase(); if (name.includes('cpi') || name.includes('inflation')) return 'Measures inflation. Expect high gold and dollar volatility.'; if (name.includes('non-farm') || name.includes('employment') || name.includes('jobs')) return 'Shows how many jobs were added. It can move the dollar sharply.'; if (name.includes('interest rate') || name.includes('rate decision')) return 'Shows the cost of borrowing. Markets react quickly to the decision.'; if (name.includes('gdp')) return 'Measures economic growth. Stronger growth can support the currency.'; if (name.includes('fomc') || name.includes('central bank')) return 'Central bank guidance can change the direction of major currencies.'; return 'A major economic update that may create sharp market movement.' }
function CalendarView({ onUpgrade }: { onUpgrade: () => void }) { const { data, isLoading } = useSWR('/api/economic-calendar', fetchCalendar, { refreshInterval: 3600000, dedupingInterval: 3600000, revalidateOnFocus: false }); const [view, setView] = useState<'upcoming' | 'past'>('upcoming'); const redFolderEvents = (data?.events || []).filter((event) => event.impact === 'HIGH'); const now = Date.now(); const visibleEvents = redFolderEvents.filter((event) => { const releaseAt = Date.parse(event.releaseAt); return Number.isFinite(releaseAt) && (view === 'upcoming' ? releaseAt >= now : releaseAt < now) }); return <div><div className="mb-5 flex items-end justify-between"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-rose-300">Red Folder Market Schedule</p><h2 className="mt-1 max-w-[18rem] text-xl font-bold leading-tight text-white">High-impact news only</h2></div><CalendarDays size={21} className="text-rose-300" /></div><p className="mb-5 text-sm leading-relaxed text-slate-300">Simple, live alerts for news that can move your trades.</p><div className="mb-5 grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-900/70 p-1"><button onClick={() => setView('upcoming')} className={`touch-manipulation rounded-lg py-2.5 text-sm font-bold tracking-wide transition-all active:scale-[0.98] ${view === 'upcoming' ? 'bg-rose-500/15 text-rose-200' : 'text-slate-400'}`}>Upcoming Events</button><button onClick={() => setView('past')} className={`touch-manipulation rounded-lg py-2.5 text-sm font-bold tracking-wide transition-all active:scale-[0.98] ${view === 'past' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Past Events History</button></div>{isLoading && <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-300">Loading live red folder events...</div>}{data?.error && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200">{data.error}</div>}{!isLoading && !data?.error && visibleEvents.length === 0 && <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-center text-sm text-slate-300">No high-impact (Red Folder) events scheduled for this period.</div>}<div className="space-y-3">{visibleEvents.map((event) => <article key={event.id} className="rounded-xl border border-rose-500/30 bg-slate-900/70 p-4 shadow-lg shadow-rose-950/10"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1.5"><span className="grid h-8 min-w-12 place-items-center rounded-md border border-rose-500/50 bg-rose-500/10 px-2 text-sm font-bold text-rose-300">{event.currency}</span><span className="rounded bg-rose-500/15 px-2 py-1 text-xs font-bold tracking-wider text-rose-300">RED FOLDER</span></div><time dateTime={event.releaseAt} className="font-mono text-xs font-bold text-slate-300">{formatEventTime(event.releaseAt)}</time></div><h3 className="mt-4 font-bold text-white">{event.title}</h3><p className="mt-1 text-sm leading-relaxed text-slate-300">{explainEvent(event.title)}</p><div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-800 pt-3 text-sm"><div><p className="text-slate-400">Expected</p><p className="mt-1 font-mono font-bold text-cyan-300">{event.forecast}</p></div><div><p className="text-slate-400">Previous</p><p className="mt-1 font-mono font-bold text-white">{event.previous}</p></div></div></article>)}</div><button onClick={onUpgrade} className="relative z-40 pointer-events-auto mt-5 flex w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-[#3f3f46] py-3 text-sm font-bold text-zinc-300 transition-all active:scale-[0.98]"><LockKeyhole size={14} /> Compare Free and VIP</button></div> }
function PricingModal({ onClose, onUnlock }: { onClose: () => void; onUnlock: () => void }) {
  return <motion.div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4" onClick={onClose}>
    <motion.div onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="vip-pricing-title" className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-cyan-500/30 bg-slate-950 shadow-2xl shadow-cyan-950/40">
      <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">PRICING / UPGRADE</p>
            <h2 id="vip-pricing-title" className="mt-1 text-2xl font-bold tracking-tight text-white">Go VIP</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close pricing" className="grid size-9 shrink-0 place-items-center rounded-full border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"><X size={18} /></button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3">
          <p className="text-sm leading-relaxed text-slate-200"><span className="font-bold uppercase tracking-wide text-cyan-100">SIMPLE MONTHLY ACCESS</span> — Cancel anytime. No annual commitment.</p>
        </div>

        <p className="mt-5 flex flex-wrap items-baseline gap-x-2 font-mono text-3xl font-bold tracking-tight text-white sm:text-4xl"><span className="text-cyan-300">₦15,000</span><span className="text-base font-semibold text-slate-200"> / month</span></p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PlanComparisonCard title="Free" benefits={freeBenefits} />
          <PlanComparisonCard title="VIP" benefits={vipBenefits} featured />
        </div>
      </div>

      <div className="shrink-0 border-t border-cyan-500/20 bg-slate-950/95 p-4">
        <button type="button" onClick={onUnlock} aria-label="Unlock VIP Access — ₦15,000/mo" className="min-h-12 w-full touch-manipulation rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-3 py-3 text-center text-sm font-bold leading-snug text-slate-950 shadow-lg shadow-cyan-500/20 transition-all hover:brightness-110 active:scale-[0.99] sm:text-base">Unlock VIP Access — ₦15,000/mo</button>
      </div>
    </motion.div>
  </motion.div>
}

  type PlanComparisonCardProps = { title: string; benefits: string[]; featured?: boolean }

function PlanComparisonCard({ title, benefits, featured = false }: PlanComparisonCardProps) {
  const headingId = `pricing-${title.toLowerCase()}-heading`

  return <section aria-labelledby={headingId} className={cn('min-w-0 rounded-2xl border p-4', featured ? 'border-cyan-400/50 bg-cyan-400/5 shadow-lg shadow-cyan-950/20' : 'border-slate-700 bg-slate-900/80')}>
    <h3 id={headingId} className={cn('border-b border-slate-700 pb-3 text-base font-bold', featured ? 'text-cyan-100' : 'text-white')}>{title}</h3>
    <ul className="mt-4 flex flex-col gap-3">
      {benefits.map((benefit) => <li key={benefit} className="flex min-w-0 items-start gap-2.5 text-sm leading-relaxed text-slate-100"><Check size={16} className={`mt-0.5 shrink-0 ${featured ? 'text-cyan-300' : 'text-slate-400'}`} aria-hidden="true" /><span className="min-w-0 break-words">{benefit}</span></li>)}
    </ul>
  </section>
}

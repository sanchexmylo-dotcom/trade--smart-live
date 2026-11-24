'use client'

import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import SignalChartImage from './signal-chart-image'

export type Signal = {
  id: string | number
  pair: string
  direction: 'BUY' | 'SELL'
  entry: string
  tp: string
  sl: string
  tp2?: string
  tp3?: string
  tp4?: string
  notes?: string
  hasChartImage?: boolean
  time: string
  status?: 'ACTIVE' | 'WIN' | 'LOSS'
  createdAt?: unknown
}

type SignalCardProps = {
  signal: Signal
  index: number
  isLocked: boolean
  deviceToken: string | null
}

export default function SignalCard({ signal, index, isLocked, deviceToken }: SignalCardProps) {
  const [now, setNow] = useState(() => Date.now())
  const buy = signal.direction === 'BUY'
  const createdAt = toDate(signal.createdAt)
  const takeProfits = [signal.tp, signal.tp2, signal.tp3, signal.tp4]
    .flatMap((value, profitIndex) => value ? [{ label: `TP${profitIndex + 1}`, value }] : [])
  const priceLevels = [
    { label: 'Entry', value: signal.entry, valueColor: 'text-slate-100' },
    { label: 'Stop Loss', value: signal.sl, valueColor: 'text-rose-200' },
    ...takeProfits.map((takeProfit) => ({ ...takeProfit, valueColor: 'text-emerald-200' })),
  ]
  const analystNote = signal.notes?.trim()

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  return <motion.article
    id={`signal-${signal.id}`}
    tabIndex={-1}
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.06, type: 'spring', stiffness: 420, damping: 28 }}
    className={`mb-3 scroll-mt-24 overflow-hidden rounded-2xl border bg-slate-950/90 px-4 py-3.5 shadow-xl shadow-black/20 focus:outline-none ${buy ? 'border-emerald-500/25' : 'border-rose-500/25'}`}
  >
    <header className="flex min-w-0 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="truncate font-mono text-lg font-bold tracking-tight text-white" aria-label={signal.pair}>{signal.pair}</h2>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${buy ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}`}>
          {buy ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownRight size={14} aria-hidden="true" />}
          {signal.direction}
        </span>
      </div>
      <time dateTime={createdAt?.toISOString()} className="shrink-0 text-right font-mono text-[11px] text-slate-400">
        {formatRelativeTime(createdAt, now, signal.time)}
      </time>
    </header>

    <div className="mt-2" role="list" aria-label="Trade prices">
      {priceLevels.map((level, levelIndex) => <PriceLevel key={level.label} {...level} value={isLocked ? '••••••' : level.value} isLocked={isLocked} isLast={levelIndex === priceLevels.length - 1 && !analystNote && !signal.hasChartImage} />)}
    </div>

    {signal.hasChartImage && (isLocked || !deviceToken ? (
      <div role="img" aria-label="VIP chart screenshot locked" className="mt-4 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/80">
        <div aria-hidden="true" className="flex aspect-video flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_center,_rgba(37,99,235,0.45),_rgba(15,23,42,0.96)_70%)] blur-sm">
          <div className="flex gap-2"><span className="h-10 w-20 rounded border border-slate-400/40 bg-slate-500/30" /><span className="h-10 w-28 rounded border border-slate-400/40 bg-slate-500/30" /></div>
          <span className="text-xs font-semibold tracking-wide text-slate-200">VIP chart setup</span>
        </div>
      </div>
    ) : (
      <SignalChartImage signalId={signal.id} pair={signal.pair} deviceToken={deviceToken} />
    ))}

    {analystNote && <p className={`mt-3 text-sm italic leading-relaxed text-slate-300 ${isLocked ? 'blur-md select-none pointer-events-none' : ''}`}>{isLocked ? 'VIP analyst commentary locked' : analystNote}</p>}
  </motion.article>
}

function PriceLevel({ label, value, valueColor, isLocked, isLast }: { label: string; value: string; valueColor: string; isLocked: boolean; isLast: boolean }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copyValue() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(value)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    window.setTimeout(() => setCopyState('idle'), 1600)
  }

  return <div role="listitem" className={`flex min-w-0 items-center justify-between gap-3 border-b border-slate-800/70 py-2.5 ${isLast ? 'border-b-0 pb-0' : ''} ${isLocked ? 'blur-md select-none pointer-events-none' : ''}`}>
    <p className="text-sm text-slate-400">{label}</p>
    <div className="flex min-w-0 items-center gap-2">
      <p className={`truncate font-mono text-sm font-semibold ${valueColor}`}>{value}</p>
      {!isLocked && <button type="button" onClick={copyValue} aria-label={`Copy ${label}: ${value}`} className="grid size-8 shrink-0 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
        {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>}
    </div>
    <span className="sr-only" aria-live="polite">{copyState === 'copied' ? `${label} copied` : copyState === 'failed' ? 'Could not copy price' : ''}</span>
  </div>
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : undefined
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : undefined
  }
  return undefined
}

function formatRelativeTime(date: Date | undefined, now: number, fallback: string) {
  if (!date) return fallback ? `${fallback} · WAT` : 'Time unavailable'
  const elapsed = Math.max(0, now - date.getTime())
  if (elapsed < 60_000) return 'Just now · WAT'
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} mins ago · WAT`
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} hrs ago · WAT`
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))} days ago · WAT`
  const localTime = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date)
  return `${localTime} WAT`
}


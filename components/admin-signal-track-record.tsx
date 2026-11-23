'use client'

import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type SignalStatus = 'ACTIVE' | 'WIN' | 'LOSS'
type Signal = {
  id: string
  pair: string
  direction: 'BUY' | 'SELL'
  entry: string
  sl: string
  tp1: string
  tp2: string
  tp3: string
  tp4: string
  status: SignalStatus
}
type SignalFilter = 'ALL' | 'ACTIVE' | 'CLOSED'

type Props = {
  signals: Signal[]
  pendingSignalId: string | null
  onClose: (id: string, status: 'WIN' | 'LOSS') => Promise<void>
  onDelete: (signal: Pick<Signal, 'id' | 'pair'>) => void
}

const statusStyles: Record<SignalStatus, string> = {
  ACTIVE: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200',
  WIN: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  LOSS: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
}

function PriceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/80 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 min-w-0 break-all font-mono text-xs font-semibold leading-relaxed tabular-nums text-slate-100" title={value}>{value || '—'}</p>
    </div>
  )
}

export default function AdminSignalTrackRecord({ signals, pendingSignalId, onClose, onDelete }: Props) {
  const [filter, setFilter] = useState<SignalFilter>('ALL')
  const counts = useMemo(() => ({
    ALL: signals.length,
    ACTIVE: signals.filter((signal) => signal.status === 'ACTIVE').length,
    CLOSED: signals.filter((signal) => signal.status !== 'ACTIVE').length,
  }), [signals])
  const visibleSignals = filter === 'ALL'
    ? signals
    : signals.filter((signal) => filter === 'ACTIVE' ? signal.status === 'ACTIVE' : signal.status !== 'ACTIVE')

  return (
    <section aria-labelledby="signal-track-record-heading" className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-xl shadow-blue-950/15 backdrop-blur-xl md:p-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Trading desk · outcomes</p>
          <h2 id="signal-track-record-heading" className="mt-1 text-lg font-semibold text-slate-100">Signal track record</h2>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">{signals.length} total</span>
      </header>

      <div role="group" aria-label="Filter signals" className="mt-4 grid w-full grid-cols-3 gap-1.5 rounded-xl border border-slate-800/80 bg-slate-950/80 p-1.5">
        {(['ALL', 'ACTIVE', 'CLOSED'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
            className={`min-h-11 min-w-0 rounded-lg px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 sm:text-sm ${filter === item ? 'bg-[#27272a] text-white' : 'text-slate-300 hover:text-white'}`}
          >
            {item === 'ALL' ? 'All' : item === 'ACTIVE' ? 'Active' : 'Closed'}
            <span className="ml-1.5 font-mono tabular-nums text-slate-400">{counts[item]}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {visibleSignals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-400">
            {signals.length === 0 ? 'No signals yet.' : `No ${filter.toLowerCase()} signals.`}
          </p>
        ) : visibleSignals.map((signal) => {
          const takeProfits = [
            { label: 'TP1', value: signal.tp1 },
            { label: 'TP2', value: signal.tp2 },
            { label: 'TP3', value: signal.tp3 },
            { label: 'TP4', value: signal.tp4 },
          ].filter((target) => Boolean(target.value))
          const isPending = pendingSignalId === signal.id

          return (
            <article key={signal.id} className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/90 p-4">
              <header className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="truncate text-sm font-bold text-slate-100">{signal.pair}</h3>
                  <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${signal.direction === 'BUY' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-rose-400/25 bg-rose-400/10 text-rose-200'}`}>
                    {signal.direction}
                  </span>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold tracking-wide ${statusStyles[signal.status]}`}>
                  {signal.status}
                </span>
              </header>

              <div role="group" aria-label={`${signal.pair} entry, stop loss, and take profit prices`} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <PriceCell label="Entry" value={signal.entry} />
                <PriceCell label="SL" value={signal.sl} />
                {takeProfits.map((target) => (
                  <PriceCell key={target.label} label={target.label} value={target.value} />
                ))}
              </div>

              {signal.status === 'ACTIVE' && (
                <div className="mt-3 grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Button type="button" size="sm" disabled={isPending} onClick={async () => { await onClose(signal.id, 'WIN') }} aria-label={`Mark ${signal.pair} as win`} className="h-11 min-w-0 border border-emerald-400/25 bg-emerald-400/10 text-sm font-bold text-emerald-200 hover:bg-emerald-400/20">
                    Win
                  </Button>
                  <Button type="button" size="sm" disabled={isPending} onClick={async () => { await onClose(signal.id, 'LOSS') }} aria-label={`Mark ${signal.pair} as loss`} className="h-11 min-w-0 border border-rose-400/25 bg-rose-400/10 text-sm font-bold text-rose-200 hover:bg-rose-400/20">
                    Loss
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={isPending} onClick={() => onDelete(signal)} aria-label={`Delete ${signal.pair} signal`} title="Delete signal" className="col-span-2 size-11 shrink-0 justify-self-end text-slate-400 hover:bg-rose-400/10 hover:text-rose-200 sm:col-span-1">
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

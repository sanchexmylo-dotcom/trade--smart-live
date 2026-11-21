'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { BookOpen, LoaderCircle, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'

type TradeDirection = 'BUY' | 'SELL'
type TradeOutcome = 'WIN' | 'LOSS' | 'BE'

type JournalTrade = {
  id: string
  pair: string
  direction: TradeDirection
  entry: number
  stopLoss?: number
  takeProfit?: number
  exit: number
  entryDisplay?: string
  stopLossDisplay?: string
  takeProfitDisplay?: string
  exitDisplay?: string
  riskAmount?: number
  resultUsd?: number
  outcome: TradeOutcome
  pips: number
  notes: string
  createdAt: string
}

type TradeDraft = {
  pair: string
  direction: TradeDirection
  entry: string
  stopLoss: string
  takeProfit: string
  exit: string
  riskAmount: string
  notes: string
}

type RiskProfile = {
  riskDistance: number
  rewardRisk: number
}

const JOURNAL_STORAGE_KEY = 'trade-smart-live-journal-v1'
type JournalKey = readonly [string, string]
const EMPTY_TRADE_DRAFT: TradeDraft = {
  pair: '',
  direction: 'BUY',
  entry: '',
  stopLoss: '',
  takeProfit: '',
  exit: '',
  riskAmount: '100',
  notes: '',
}

function isJournalTrade(value: unknown): value is JournalTrade {
  if (!value || typeof value !== 'object') return false

  const trade = value as Partial<JournalTrade>
  return typeof trade.id === 'string'
    && typeof trade.pair === 'string'
    && (trade.direction === 'BUY' || trade.direction === 'SELL')
    && Number.isFinite(trade.entry)
    && Number.isFinite(trade.exit)
    && (trade.stopLoss === undefined || Number.isFinite(trade.stopLoss))
    && (trade.takeProfit === undefined || Number.isFinite(trade.takeProfit))
    && (trade.riskAmount === undefined || Number.isFinite(trade.riskAmount))
    && (trade.resultUsd === undefined || Number.isFinite(trade.resultUsd))
    && (trade.entryDisplay === undefined || typeof trade.entryDisplay === 'string')
    && (trade.stopLossDisplay === undefined || typeof trade.stopLossDisplay === 'string')
    && (trade.takeProfitDisplay === undefined || typeof trade.takeProfitDisplay === 'string')
    && (trade.exitDisplay === undefined || typeof trade.exitDisplay === 'string')
    && (trade.outcome === 'WIN' || trade.outcome === 'LOSS' || trade.outcome === 'BE')
    && Number.isFinite(trade.pips)
    && typeof trade.notes === 'string'
    && typeof trade.createdAt === 'string'
    && Number.isFinite(Date.parse(trade.createdAt))
}

function readTrades(value: string | null): JournalTrade[] {
  if (!value) return []

  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(isJournalTrade) : []
  } catch {
    return []
  }
}

async function readJournalResponse(response: Response) {
  const result = await response.json() as { trades?: unknown; error?: string }
  if (!response.ok || !Array.isArray(result.trades)) {
    throw new Error(result.error || 'Your journal could not be loaded. Please try again.')
  }
  return result.trades.filter(isJournalTrade)
}

async function fetchJournal([url, deviceToken]: JournalKey) {
  const headers = { Authorization: `Bearer ${deviceToken}` }
  const response = await fetch(url, { headers, cache: 'no-store' })
  const serverTrades = await readJournalResponse(response)

  let legacyTrades: JournalTrade[] = []
  try {
    legacyTrades = readTrades(window.localStorage.getItem(JOURNAL_STORAGE_KEY))
  } catch {
    return serverTrades
  }

  if (legacyTrades.length === 0) {
    try {
      window.localStorage.removeItem(JOURNAL_STORAGE_KEY)
    } catch {
      // Existing browser data is only a migration source; Firestore stays authoritative.
    }
    return serverTrades
  }

  const existingTradeIds = new Set(serverTrades.map((trade) => trade.id))
  let migratedAny = false
  for (const trade of legacyTrades) {
    if (existingTradeIds.has(trade.id)) continue

    const migrationResponse = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trade }),
    })
    if (!migrationResponse.ok) {
      const result = await migrationResponse.json() as { error?: string }
      throw new Error(result.error || 'Your saved journal could not be migrated. Please try again.')
    }
    existingTradeIds.add(trade.id)
    migratedAny = true
  }

  try {
    window.localStorage.removeItem(JOURNAL_STORAGE_KEY)
  } catch {
    // Existing browser data is only a migration source; Firestore stays authoritative.
  }

  if (!migratedAny) return serverTrades
  const migratedResponse = await fetch(url, { headers, cache: 'no-store' })
  return readJournalResponse(migratedResponse)
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value.trim().replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function getRiskProfile(direction: TradeDirection, entry: number, stopLoss: number, takeProfit: number): RiskProfile | null {
  const riskDistance = direction === 'BUY' ? entry - stopLoss : stopLoss - entry
  const rewardDistance = direction === 'BUY' ? takeProfit - entry : entry - takeProfit

  if (riskDistance <= 0 || rewardDistance <= 0) return null
  return { riskDistance, rewardRisk: rewardDistance / riskDistance }
}

function getPipSize(pair: string) {
  const normalizedPair = pair.toUpperCase().replace(/[^A-Z]/g, '')
  if (normalizedPair.includes('XAU')) return 0.1
  if (normalizedPair.includes('JPY') || normalizedPair.includes('XAG')) return 0.01
  return 0.0001
}

function formatPips(value: number) {
  const formatted = value.toFixed(1)
  return value > 0 ? `+${formatted}` : formatted
}

function formatRewardRisk(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return '—'
  return `1:${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`
}

function formatUsd(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'

  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Math.abs(value))
  return `${value > 0 ? '+' : '−'}$${formatted}`
}

function formatPrice(value: number | undefined, display: string | undefined) {
  if (display) return display
  return value === undefined ? '—' : value.toFixed(2)
}

function formatTradeDate(value: string) {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

const outcomeStyles: Record<TradeOutcome, string> = {
  WIN: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  LOSS: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  BE: 'border-slate-500/40 bg-slate-700/40 text-slate-200',
}

const directionStyles: Record<TradeDirection, string> = {
  BUY: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  SELL: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
}

export default function JournalTab({ deviceToken }: { deviceToken: string | null }) {
  const journalKey: JournalKey | null = deviceToken ? ['/api/journal', deviceToken] : null
  const { data: trades = [], error, isLoading, mutate } = useSWR<JournalTrade[], Error, JournalKey | null>(
    journalKey,
    fetchJournal,
    { revalidateOnFocus: false },
  )
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const [isDeletingTradeId, setIsDeletingTradeId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TradeDraft>({ ...EMPTY_TRADE_DRAFT })

  useEffect(() => {
    if (error) toast.error(error.message)
  }, [error])

  const metrics = useMemo(() => {
    const decisiveTrades = trades.filter((trade) => trade.outcome !== 'BE')
    const wins = trades.filter((trade) => trade.outcome === 'WIN').length

    return {
      winRate: decisiveTrades.length ? Math.round((wins / decisiveTrades.length) * 100) : 0,
      totalTrades: trades.length,
    }
  }, [trades])

  const previewRiskReward = useMemo(() => {
    const entry = parsePositiveNumber(draft.entry)
    const stopLoss = parsePositiveNumber(draft.stopLoss)
    const takeProfit = parsePositiveNumber(draft.takeProfit)
    if (entry === undefined || stopLoss === undefined || takeProfit === undefined) return undefined

    return getRiskProfile(draft.direction, entry, stopLoss, takeProfit)?.rewardRisk
  }, [draft.direction, draft.entry, draft.stopLoss, draft.takeProfit])

  function updateDraft<K extends keyof TradeDraft>(field: K, value: TradeDraft[K]) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  function closeForm() {
    setFormOpen(false)
    setEditingTradeId(null)
    setFormError('')
    setDraft({ ...EMPTY_TRADE_DRAFT })
  }

  function editTrade(trade: JournalTrade) {
    setEditingTradeId(trade.id)
    setFormError('')
    setDraft({
      pair: trade.pair,
      direction: trade.direction,
      entry: formatPrice(trade.entry, trade.entryDisplay),
      stopLoss: formatPrice(trade.stopLoss, trade.stopLossDisplay),
      takeProfit: formatPrice(trade.takeProfit, trade.takeProfitDisplay),
      exit: formatPrice(trade.exit, trade.exitDisplay),
      riskAmount: trade.riskAmount?.toString() ?? '100',
      notes: trade.notes,
    })
    setFormOpen(true)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const pair = draft.pair.trim().toUpperCase()
    const entry = parsePositiveNumber(draft.entry)
    const stopLoss = parsePositiveNumber(draft.stopLoss)
    const takeProfit = parsePositiveNumber(draft.takeProfit)
    const exit = parsePositiveNumber(draft.exit)
    const riskAmount = parsePositiveNumber(draft.riskAmount)

    if (!pair || entry === undefined || stopLoss === undefined || takeProfit === undefined || exit === undefined) {
      setFormError('Enter an asset pair and valid positive prices for entry, SL, TP, and exit.')
      return
    }

    if (riskAmount === undefined) {
      setFormError('Enter a positive dollar amount at risk if the stop-loss is hit.')
      return
    }

    const riskProfile = getRiskProfile(draft.direction, entry, stopLoss, takeProfit)
    const priceMove = draft.direction === 'BUY' ? exit - entry : entry - exit
    const pips = Number((priceMove / getPipSize(pair)).toFixed(1))
    const resultUsd = riskProfile
      ? Number(((priceMove / riskProfile.riskDistance) * riskAmount).toFixed(2))
      : undefined
    const existingTrade = trades.find((trade) => trade.id === editingTradeId)
    const trade: JournalTrade = {
      id: editingTradeId ?? crypto.randomUUID(),
      pair,
      direction: draft.direction,
      entry,
      stopLoss,
      takeProfit,
      exit,
      entryDisplay: draft.entry.trim(),
      stopLossDisplay: draft.stopLoss.trim(),
      takeProfitDisplay: draft.takeProfit.trim(),
      exitDisplay: draft.exit.trim(),
      riskAmount,
      resultUsd,
      outcome: pips > 0 ? 'WIN' : pips < 0 ? 'LOSS' : 'BE',
      pips,
      notes: draft.notes.trim(),
      createdAt: existingTrade?.createdAt ?? new Date().toISOString(),
    }

    if (!deviceToken) {
      toast.error('Your device profile is still loading. Please try saving again.')
      return
    }

    setFormError('')
    setIsSaving(true)
    try {
      const response = await fetch('/api/journal', {
        method: editingTradeId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trade }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Your trade could not be saved. Please try again.')

      await mutate((currentTrades) => {
        const current = currentTrades ?? []
        return editingTradeId
          ? current.map((savedTrade) => savedTrade.id === trade.id ? trade : savedTrade)
          : [trade, ...current]
      }, { revalidate: false })
      toast.success(editingTradeId ? 'Trade updated.' : 'Trade saved.')
      closeForm()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Your trade could not be saved. Please try again.'
      setFormError(message)
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  async function removeTrade(id: string) {
    if (!deviceToken) {
      toast.error('Your device profile is still loading. Please try again.')
      return
    }

    setIsDeletingTradeId(id)
    try {
      const response = await fetch('/api/journal', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Your trade could not be deleted. Please try again.')

      await mutate((currentTrades) => (currentTrades ?? []).filter((trade) => trade.id !== id), { revalidate: false })
      toast.success('Trade deleted.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Your trade could not be deleted. Please try again.')
    } finally {
      setIsDeletingTradeId(null)
    }
  }

  return (
    <div className="min-w-0 flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Free journal</p>
          <h2 className="mt-1 text-xl font-bold leading-tight text-white">Free Trade Journal</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-200">Track your trades, calculate PnL, and build discipline.</p>
        </div>
        <BookOpen aria-hidden="true" className="mt-1 size-5 shrink-0 text-cyan-300" />
      </header>

      <section
        aria-label="Journal summary metrics"
        className="grid grid-cols-2 gap-3 mb-6"
      >
        <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
          <p className="text-xs font-semibold leading-tight text-slate-300">Win Rate</p>
          <p className="mt-2 font-mono text-lg font-bold text-white">{metrics.winRate}%</p>
          <p className="mt-1 text-[10px] leading-tight text-slate-400">BE excluded</p>
        </article>
        <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
          <p className="text-xs font-semibold leading-tight text-slate-300">Logged Trades</p>
          <p className="mt-2 font-mono text-lg font-bold text-white">{metrics.totalTrades}</p>
          <p className="mt-1 text-[10px] leading-tight text-slate-400">Saved to your device account</p>
        </article>
      </section>

      <Dialog.Root
        open={formOpen}
        onOpenChange={(open) => {
          if (open) {
            setEditingTradeId(null)
            setFormError('')
            setDraft({ ...EMPTY_TRADE_DRAFT })
            setFormOpen(true)
          } else if (!isSaving) {
            closeForm()
          }
        }}
      >
        <Dialog.Trigger
          type="button"
          className="flex min-h-[3.5rem] w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/40 bg-cyan-500 py-3.5 font-bold text-slate-950 shadow-[0_0_22px_rgba(6,182,212,0.28)] transition hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        >
          <Plus aria-hidden="true" className="size-4" />
          Log a Trade
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-6">
            <Dialog.Popup className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl shadow-black/60 sm:max-h-[calc(100dvh-3rem)] sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="text-base font-bold text-white">{editingTradeId ? 'Edit Trade' : 'Log a Trade'}</Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm leading-relaxed text-slate-300">Record your setup and track your realized risk.</Dialog.Description>
                </div>
                <Dialog.Close disabled={isSaving} aria-label="Close trade form" className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-300 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50">
                  <X aria-hidden="true" className="size-4" />
                </Dialog.Close>
              </div>

              <p className="mb-4 text-xs leading-relaxed text-slate-300">Pips use 0.0001 for most FX pairs, 0.01 for JPY/XAG, and 0.1 for XAU.</p>

              <form id="journal-trade-form" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-200">
                    Asset Pair
                    <input name="pair" value={draft.pair} onChange={(event) => updateDraft('pair', event.target.value)} required maxLength={18} placeholder="XAUUSD, EURUSD, GBPJPY" autoComplete="off" className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-white outline-none placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30" />
                  </label>

                  <div className="grid min-w-0 gap-2 text-sm font-semibold text-slate-200">
                    <span>Direction</span>
                    <ToggleGroup
                      aria-label="Trade direction"
                      value={[draft.direction]}
                      onValueChange={(value) => {
                        const nextDirection = value[0]
                        if (nextDirection === 'BUY' || nextDirection === 'SELL') updateDraft('direction', nextDirection)
                      }}
                      className="flex w-full gap-2"
                    >
                      <Toggle value="BUY" className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-slate-300 transition-colors data-pressed:border-emerald-400/50 data-pressed:bg-emerald-500/15 data-pressed:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40">
                        BUY
                      </Toggle>
                      <Toggle value="SELL" className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-slate-300 transition-colors data-pressed:border-rose-400/50 data-pressed:bg-rose-500/15 data-pressed:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40">
                        SELL
                      </Toggle>
                    </ToggleGroup>
                  </div>

                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-200">
                    Entry Price
                    <input name="entry" value={draft.entry} onChange={(event) => updateDraft('entry', event.target.value)} type="text" inputMode="decimal" maxLength={20} required placeholder="2650.00" className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-base text-white outline-none placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30" />
                  </label>

                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-200">
                    Stop Loss (SL)
                    <input name="stopLoss" value={draft.stopLoss} onChange={(event) => updateDraft('stopLoss', event.target.value)} type="text" inputMode="decimal" maxLength={20} required placeholder="2648.00" className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-base text-white outline-none placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30" />
                  </label>

                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-200">
                    Take Profit (TP)
                    <input name="takeProfit" value={draft.takeProfit} onChange={(event) => updateDraft('takeProfit', event.target.value)} type="text" inputMode="decimal" maxLength={20} required placeholder="2655.00" className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-base text-white outline-none placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30" />
                  </label>

                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-200">
                    Exit Price
                    <input name="exit" value={draft.exit} onChange={(event) => updateDraft('exit', event.target.value)} type="text" inputMode="decimal" maxLength={20} required placeholder="2655.00" className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-base text-white outline-none placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30" />
                  </label>

                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-200">
                    Risk at SL (USD)
                    <input name="riskAmount" value={draft.riskAmount} onChange={(event) => updateDraft('riskAmount', event.target.value)} type="text" inputMode="decimal" maxLength={14} required aria-describedby="risk-amount-help" className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-base text-white outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30" />
                    <span id="risk-amount-help" className="text-xs font-normal leading-relaxed text-slate-400">Default $100. Result scales with your realized R multiple.</span>
                  </label>

                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-200 sm:col-span-2">
                    Trade Notes / Confluence
                    <textarea name="notes" value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} maxLength={500} rows={3} placeholder="Setup, confluence, and lessons learned" className="min-h-24 min-w-0 resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base leading-relaxed text-white outline-none placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30" />
                  </label>
                </div>

                <p aria-live="polite" className="mt-4 rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3 text-sm text-slate-200">
                  Planned R:R <span className="ml-2 font-mono font-bold text-cyan-200">{previewRiskReward === undefined ? '—' : formatRewardRisk(previewRiskReward)}</span>
                  {previewRiskReward === undefined && <span className="mt-1 block text-xs text-slate-400">Set entry, SL, and TP on the correct side of your direction.</span>}
                </p>

                {formError && <p role="alert" className="mt-3 text-sm font-medium text-rose-200">{formError}</p>}

                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" disabled={isSaving} onClick={closeForm} className="min-h-11 border-slate-700 text-slate-200 hover:bg-slate-800">Cancel</Button>
                  <Button type="submit" disabled={isSaving} className="min-h-11 bg-cyan-400 px-5 font-bold text-slate-950 hover:bg-cyan-300">
                    {isSaving && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                    {isSaving ? 'Saving…' : editingTradeId ? 'Save changes' : 'Save trade'}
                  </Button>
                </div>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      {error && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-100">{error.message} <button type="button" onClick={() => void mutate()} className="ml-1 font-semibold underline underline-offset-2">Try again</button></p>}

      <section aria-labelledby="trade-history-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="trade-history-heading" className="text-base font-bold text-white">Trade History</h3>
          <span className="text-xs font-medium text-slate-300">{metrics.totalTrades} {metrics.totalTrades === 1 ? 'trade' : 'trades'}</span>
        </div>

        {!deviceToken || isLoading ? (
          <p role="status" className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">Loading your journal…</p>
        ) : error ? null : trades.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-6 text-center">
            <BookOpen aria-hidden="true" className="mx-auto size-8 text-slate-400" />
            <p className="mt-3 font-semibold text-slate-100">No trades logged yet</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">Add your first trade to start tracking performance.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {trades.map((trade) => {
              const rewardRisk = trade.stopLoss === undefined || trade.takeProfit === undefined
                ? undefined
                : getRiskProfile(trade.direction, trade.entry, trade.stopLoss, trade.takeProfit)?.rewardRisk

              return (
                <article key={trade.id} className="mb-3 min-w-0 rounded-xl border border-slate-800 bg-slate-900/90 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${directionStyles[trade.direction]}`}>{trade.direction}</span>
                      <h4 className="min-w-0 break-words text-base font-bold text-white">
                        {trade.pair} <span className="font-normal text-slate-300">@ {formatPrice(trade.entry, trade.entryDisplay)}</span>
                      </h4>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => editTrade(trade)} aria-label={`Edit ${trade.pair} trade`} className="text-slate-400 hover:text-cyan-200">
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={isDeletingTradeId === trade.id} onClick={() => void removeTrade(trade.id)} aria-label={`Delete ${trade.pair} trade`} className="text-slate-400 hover:text-rose-200">
                        {isDeletingTradeId === trade.id ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" />}
                      </Button>
                    </div>
                  </div>

                  <p className="mt-1 text-xs text-slate-400">{formatTradeDate(trade.createdAt)}</p>

                  <div className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-800 pt-3 text-sm sm:grid-cols-3">
                    <p className="text-slate-400">Entry: <span className="font-mono font-semibold text-slate-100">{formatPrice(trade.entry, trade.entryDisplay)}</span></p>
                    <p className="text-slate-400">SL: <span className="font-mono font-semibold text-slate-100">{formatPrice(trade.stopLoss, trade.stopLossDisplay)}</span></p>
                    <p className="text-slate-400">TP: <span className="font-mono font-semibold text-slate-100">{formatPrice(trade.takeProfit, trade.takeProfitDisplay)}</span></p>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-800 pt-3 text-sm sm:grid-cols-3">
                    <p className="text-slate-400">
                      Outcome: <span className={`font-semibold ${outcomeStyles[trade.outcome].split(' ').at(-1)}`}>{trade.outcome} ({formatPips(trade.pips)} pips)</span>
                    </p>
                    <p className="text-slate-400">R:R: <span className="font-mono font-semibold text-cyan-200">{formatRewardRisk(rewardRisk)}</span></p>
                    <p className="text-slate-400">Result: <span className={`font-mono font-bold ${trade.resultUsd === undefined ? 'text-slate-300' : trade.resultUsd >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{formatUsd(trade.resultUsd)}</span></p>
                  </div>

                  {trade.notes && <p className="mt-3 break-words border-t border-slate-800 pt-3 text-sm leading-relaxed text-slate-200">{trade.notes}</p>}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

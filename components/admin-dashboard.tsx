'use client'

import { FormEvent, useEffect, useState } from 'react'
import useSWR from 'swr'
import { ArrowLeft, Bell, Check, LockKeyhole, Radio } from 'lucide-react'
import ChartImageUpload from './chart-image-upload'
import Link from 'next/link'
import { Field as FormField, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import VipDeviceManager from './vip-device-manager'
import { closeSignal as closeSignalInFirestore, createTip, subscribeToSignals } from '@/lib/firestore'

type SignalStatus = 'ACTIVE' | 'WIN' | 'LOSS'
type Signal = { id: string; pair: string; direction: 'BUY' | 'SELL'; entry: string; sl: string; tp1: string; tp2: string; tp3: string; tp4: string; notes: string; chartImagePath?: string; status: SignalStatus }
type Tip = { id: number; category: string; title: string; content: string; createdAt: string }
type SignalFeedback = { status: 'success' | 'warning' | 'error'; message: string }
const LOCKOUT_DURATION_MS = 15 * 60 * 1000

async function fetchAdminSession(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error('Admin session could not be checked.')
  return response.json() as Promise<{ authenticated: boolean }>
}

async function fetchAssetPairs(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  const result = await response.json() as { pairs?: string[]; error?: string }
  if (!response.ok) throw new Error(result.error || 'Saved asset pairs could not be loaded.')
  return result.pairs ?? []
}

export default function AdminDashboard() {
  const { data: adminSession, mutate: updateAdminSession } = useSWR('/api/admin/verify', fetchAdminSession, { revalidateOnFocus: false })
  const authenticated = adminSession?.authenticated === true
  const { data: assetPairs = [], mutate: refreshAssetPairs } = useSWR(authenticated ? '/api/admin/asset-pairs' : null, fetchAssetPairs, { revalidateOnFocus: false })
  const [passcode, setPasscode] = useState('')
  const [authError, setAuthError] = useState('')
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [isLockedOut, setIsLockedOut] = useState(false)
  const [signals, setSignals] = useState<Signal[]>([])
  const [sent, setSent] = useState(false)
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [signalFeedback, setSignalFeedback] = useState<SignalFeedback | null>(null)
  const [chartImage, setChartImage] = useState<File | null>(null)
  const [tipSent, setTipSent] = useState(false)
  const [tpCount, setTpCount] = useState(3)
  const [signal, setSignal] = useState<Omit<Signal, 'id' | 'status'>>({ pair: '', direction: 'BUY', entry: '', sl: '', tp1: '', tp2: '', tp3: '', tp4: '', notes: '' })
  const [tip, setTip] = useState<Omit<Tip, 'id' | 'createdAt'>>({ title: '', category: 'Forex Strategy', content: '' })
  useEffect(() => {
    if (!authenticated) return
    const unsubscribe = subscribeToSignals((records) => setSignals(records.map((record) => ({
      id: record.id,
      pair: record.pair,
      direction: record.action,
      entry: record.entry,
      sl: record.sl,
      tp1: record.tp1,
      tp2: record.tp2 ?? '',
      tp3: record.tp3 ?? '',
      tp4: record.tp4 ?? '',
      notes: record.notes ?? '',
      chartImagePath: record.chartImagePath,
      status: record.status,
    }))))
    return () => unsubscribe()
  }, [authenticated])
  useEffect(() => { if (!isLockedOut) return; const timer = window.setTimeout(() => { setIsLockedOut(false); setFailedAttempts(0) }, LOCKOUT_DURATION_MS); return () => window.clearTimeout(timer) }, [isLockedOut])
  async function unlock() {
    if (isLockedOut) return
    try {
      const response = await fetch('/api/admin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) })
      const result = await response.json() as { authenticated?: boolean; error?: string }
      if (response.ok && result.authenticated) {
        setAuthError('')
        setFailedAttempts(0)
        await updateAdminSession({ authenticated: true }, { revalidate: false })
        return
      }
      if (response.status !== 401) {
        setAuthError(result.error || 'Unable to verify passcode. Try again.')
        return
      }
    } catch {
      setAuthError('Unable to verify passcode. Try again.')
      return
    }
    const attempt = failedAttempts + 1
    setPasscode('')
    setFailedAttempts(attempt)
    if (attempt >= 8) { setIsLockedOut(true); setAuthError('') }
    else setAuthError(`Incorrect passcode. Attempt ${attempt} of 8.`)
  }
  async function broadcast(event: FormEvent) {
    event.preventDefault()
    setSignalFeedback(null)
    const pair = signal.pair.trim().replace(/\s+/g, ' ').toUpperCase()
    const takeProfits = [signal.tp1, signal.tp2, signal.tp3, signal.tp4].slice(0, tpCount)
    if (!pair || !signal.entry.trim() || !signal.sl.trim() || takeProfits.some((level) => !level.trim())) return
    const formData = new FormData()
    formData.set('pair', pair)
    formData.set('action', signal.direction)
    formData.set('entry', signal.entry)
    formData.set('sl', signal.sl)
    formData.set('tp1', signal.tp1)
    if (tpCount >= 2) formData.set('tp2', signal.tp2)
    if (tpCount >= 3) formData.set('tp3', signal.tp3)
    if (tpCount >= 4) formData.set('tp4', signal.tp4)
    formData.set('notes', signal.notes)
    if (chartImage) formData.set('chartImage', chartImage)

    setIsBroadcasting(true)
    try {
      const response = await fetch('/api/admin/signals', { method: 'POST', body: formData })
      const result = await response.json() as {
        id?: string
        error?: string
        pushAccepted?: boolean
        pushRecipients?: number | null
        pushError?: string
      }
      if (!response.ok || !result.id) {
        setSignalFeedback({ status: 'error', message: result.error || 'Could not save this signal. Please try again.' })
        return
      }

      if (!result.pushAccepted) {
        const recipientCountMessage = typeof result.pushRecipients === 'number'
          ? ` OneSignal reported ${result.pushRecipients} targeted VIP ${result.pushRecipients === 1 ? 'recipient' : 'recipients'}.`
          : ' OneSignal did not report a recipient count.'
        setSignalFeedback({
          status: 'error',
          message: `Signal saved, but OneSignal did not accept the push notification. ${result.pushError || 'No notification was created.'}${recipientCountMessage}`,
        })
      } else if (result.pushRecipients === 0) {
        setSignalFeedback({
          status: 'warning',
          message: 'OneSignal accepted the notification, but it targeted 0 subscribed VIP devices.',
        })
      } else if (typeof result.pushRecipients === 'number') {
        const recipientLabel = result.pushRecipients === 1 ? 'recipient' : 'recipients'
        setSignalFeedback({
          status: 'success',
          message: `OneSignal accepted the notification and targeted ${result.pushRecipients} VIP ${recipientLabel}.`,
        })
      } else {
        setSignalFeedback({
          status: 'success',
          message: 'OneSignal accepted the notification, but did not report a recipient count.',
        })
      }

      await refreshAssetPairs().catch(() => undefined)
    } catch {
      setSignalFeedback({ status: 'error', message: 'Could not save this signal. Please try again.' })
      return
    } finally {
      setIsBroadcasting(false)
    }

    setSignal({ pair: '', direction: 'BUY', entry: '', sl: '', tp1: '', tp2: '', tp3: '', tp4: '', notes: '' })
    setChartImage(null)
    setSent(true)
    window.setTimeout(() => setSent(false), 1800)
  }
  async function closeSignal(id: string, status: 'WIN' | 'LOSS') { await closeSignalInFirestore(id, status).catch(() => undefined) }
  async function publishTip(event: FormEvent) { event.preventDefault(); if (!tip.title || !tip.content) return; await createTip(tip).catch(() => undefined); setTip({ title: '', category: 'Forex Strategy', content: '' }); setTipSent(true); window.setTimeout(() => setTipSent(false), 1800) }
  if (!authenticated && isLockedOut) return <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black px-5 py-10 text-zinc-100"><div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center"><section role="alert" className="w-full rounded-2xl border border-rose-500/50 bg-rose-950/30 p-6 shadow-2xl shadow-rose-950/30"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-300"><LockKeyhole size={21} /></div><h1 className="mt-5 text-2xl font-bold text-rose-200">Admin Access Locked</h1><p className="mt-3 text-base font-semibold leading-relaxed text-rose-100">Admin Access Locked due to multiple failed attempts. Please try again in 15 minutes.</p></section></div></main>
  if (!authenticated) return <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black px-5 py-10 text-zinc-100"><div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center"><form onSubmit={(event) => { event.preventDefault(); unlock() }} className="w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-6 shadow-2xl backdrop-blur-xl"><div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950"><LockKeyhole size={19} /></div><p className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-600 bg-clip-text text-sm font-bold uppercase tracking-[0.2em] text-transparent">Trade Smart Live</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Master trader access</h1><p className="mt-2 text-base leading-relaxed text-zinc-400">Manage live signals and market notes.</p>{authError && <p role="alert" className="mt-6 mb-2 text-sm font-bold text-rose-400">{authError}</p>}<FieldGroup className="mt-5"><FormField><FieldLabel htmlFor="admin-passcode" className="text-zinc-300">Passcode</FieldLabel><Input id="admin-passcode" autoFocus type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Enter master passcode" className="mt-2 h-11 border-zinc-700 bg-zinc-950 text-zinc-100 focus-visible:border-zinc-200" /></FormField></FieldGroup><button type="submit" className="mt-4 h-11 w-full touch-manipulation rounded-lg bg-zinc-100 text-sm font-bold text-zinc-950 transition-all active:scale-95">Enter dashboard</button><Link href="/" className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-300 transition-colors hover:text-zinc-200"><ArrowLeft size={14} /> Return to subscriber app</Link></form></div></main>
  return <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black px-5 py-8 text-zinc-100 md:px-10"><div className="mx-auto max-w-6xl"><header className="flex flex-col gap-5 border-b border-zinc-800/80 pb-7 md:flex-row md:items-end md:justify-between"><div><div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300"><Radio size={14} className="text-emerald-400" /> Signal operations</div><h1 className="mt-3 text-3xl font-semibold tracking-tight">Admin dashboard</h1><p className="mt-2 text-base text-zinc-400">Broadcast market intelligence, manage outcomes, and control VIP subscriptions.</p></div><Link href="/" className="flex items-center gap-2 self-start rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-300 transition-all hover:border-zinc-500 active:scale-95"><ArrowLeft size={14} /> Subscriber view</Link></header><div className="mt-8"><VipDeviceManager /></div><div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Fast input</p><h2 className="mt-1 text-xl font-semibold">Create signal</h2><form onSubmit={broadcast} className="mt-6 space-y-4"><label htmlFor="signal-pair" className="block text-sm text-zinc-400">Asset pair</label><div className="flex flex-col gap-2 sm:flex-row"><input id="signal-pair" required list="saved-asset-pairs" value={signal.pair} onChange={(e) => setSignal({ ...signal, pair: e.target.value })} placeholder="XAU/USD, EUR/JPY, GBP/USD" className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-cyan-400" /><datalist id="saved-asset-pairs">{assetPairs.map((pair) => <option key={pair} value={pair} />)}</datalist><select aria-label="Choose a saved asset pair" value="" disabled={assetPairs.length === 0} onChange={(event) => { if (event.target.value) setSignal((current) => ({ ...current, pair: event.target.value })) }} className="h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-300 outline-none focus:border-cyan-400 disabled:opacity-60 sm:w-44"><option value="">Saved pairs</option>{assetPairs.map((pair) => <option key={pair} value={pair}>{pair}</option>)}</select></div><div><p className="text-sm text-zinc-400">Direction</p><div className="mt-2 grid grid-cols-2 gap-2">{(['BUY', 'SELL'] as const).map((direction) => <button type="button" key={direction} onClick={() => setSignal({ ...signal, direction })} className={`h-11 rounded-lg text-sm font-bold ${signal.direction === direction ? direction === 'BUY' ? 'bg-emerald-500 text-zinc-950' : 'bg-rose-500 text-white' : 'border border-zinc-700 text-zinc-300'}`}>{direction}</button>)}</div></div><div className="grid grid-cols-2 gap-3"><Field label="Entry" value={signal.entry} onChange={(value) => setSignal({ ...signal, entry: value })} /><Field label="Stop Loss" value={signal.sl} onChange={(value) => setSignal({ ...signal, sl: value })} /></div><label className="block text-sm text-zinc-400">Number of Take Profits<select value={tpCount} onChange={(event) => setTpCount(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-cyan-400"><option value={1}>1 TP</option><option value={2}>2 TPs</option><option value={3}>3 TPs</option><option value={4}>4 TPs</option></select></label><div className="grid grid-cols-2 gap-3">{Array.from({ length: tpCount }, (_, index) => { const field = `tp${index + 1}` as 'tp1' | 'tp2' | 'tp3' | 'tp4'; return <Field key={field} label={`TP${index + 1}`} value={signal[field]} onChange={(value) => setSignal((current) => ({ ...current, [field]: value }))} /> })}</div><label className="block text-sm text-zinc-400">Analyst notes<textarea value={signal.notes} onChange={(e) => setSignal({ ...signal, notes: e.target.value })} className="mt-2 min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm outline-none focus:border-cyan-400" placeholder="Context, invalidation, and risk plan..." /></label><ChartImageUpload file={chartImage} onFileChange={setChartImage} />{signalFeedback && <p role={signalFeedback.status === 'error' ? 'alert' : 'status'} aria-live={signalFeedback.status === 'error' ? 'assertive' : 'polite'} className={`rounded-lg border px-3 py-2 text-sm ${signalFeedback.status === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : signalFeedback.status === 'warning' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>{signalFeedback.message}</p>}<button type="submit" disabled={isBroadcasting} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 text-sm font-bold text-zinc-950 active:scale-95 disabled:cursor-wait disabled:opacity-60">{isBroadcasting ? 'Sending signal and push…' : sent ? <><Check size={16} /> Signal broadcasted</> : <><Bell size={16} /> Broadcast Signal & Push Alert</>}</button></form></section><div className="space-y-6"><section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Track record</p><h2 className="mt-1 text-xl font-semibold">Signal track record</h2><div className="mt-4 space-y-3">{signals.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-400">No signals yet.</p> : signals.map((item) => <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"><div className="flex items-center justify-between"><div><p className="font-bold">{item.pair} <span className="font-mono text-sm text-slate-300">{item.direction}</span></p><p className="mt-1 font-mono text-sm text-slate-300">Entry {item.entry} · {[item.tp1, item.tp2, item.tp3, item.tp4].filter(Boolean).map((value, index) => `TP${index + 1} ${value}`).join(' · ')} · SL {item.sl}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.status === 'WIN' ? 'bg-emerald-500/15 text-emerald-300' : item.status === 'LOSS' ? 'bg-rose-500/15 text-rose-300' : 'bg-cyan-500/15 text-cyan-300'}`}>{item.status}</span></div>{item.status === 'ACTIVE' && <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => closeSignal(item.id, 'WIN')} className="rounded-lg bg-emerald-500/15 py-2 text-sm font-bold text-emerald-300 active:scale-95">Closed Win</button><button onClick={() => closeSignal(item.id, 'LOSS')} className="rounded-lg bg-rose-500/15 py-2 text-sm font-bold text-rose-300 active:scale-95">Closed Loss</button></div>}</div>)}</div></section><section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Market notes</p><h2 className="mt-1 text-xl font-semibold">Post a tip</h2><form onSubmit={publishTip} className="mt-4 space-y-3"><input required value={tip.title} onChange={(e) => setTip({ ...tip, title: e.target.value })} placeholder="Title" className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-cyan-400" /><select value={tip.category} onChange={(e) => setTip({ ...tip, category: e.target.value })} className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"><option>Forex Strategy</option><option>Gold Analysis</option><option>Risk Management</option></select><textarea required value={tip.content} onChange={(e) => setTip({ ...tip, content: e.target.value })} placeholder="Write your market note..." className="min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm" /><button type="submit" className="h-11 w-full rounded-lg border border-cyan-400/50 text-sm font-bold text-cyan-300 active:scale-95">{tipSent ? 'Note published' : 'Publish market note'}</button></form></section></div></div></div></main>
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-sm text-zinc-400">{label}<input required value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 font-mono text-sm outline-none focus:border-cyan-400" /></label> }

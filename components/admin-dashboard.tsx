'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import useSWR from 'swr'
import { toast } from 'sonner'
import { ArrowLeft, Bell, Check, LockKeyhole, Radio } from 'lucide-react'
import ChartImageUpload from './chart-image-upload'
import Link from 'next/link'
import { Field as FormField, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import VipDeviceManager from './vip-device-manager'
import AdminMemberDirectory from './admin-member-directory'
import AdminSignalTrackRecord from './admin-signal-track-record'
import { createTip, subscribeToSignals } from '@/lib/firestore'

type SignalStatus = 'ACTIVE' | 'WIN' | 'LOSS'
type Signal = { id: string; pair: string; direction: 'BUY' | 'SELL'; entry: string; sl: string; tp1: string; tp2: string; tp3: string; tp4: string; notes: string; chartImagePath?: string; status: SignalStatus }
type Tip = { id: number; category: string; title: string; content: string; createdAt: string }
type SignalFeedback = {
  status: 'success' | 'error'
  message: string
  notificationId?: string
}
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
  const hasServerSignalSnapshotRef = useRef(false)
  const [pendingSignalId, setPendingSignalId] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [signalFeedback, setSignalFeedback] = useState<SignalFeedback | null>(null)
  const [chartImage, setChartImage] = useState<File | null>(null)
  const [tipSent, setTipSent] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>()
  const [tpCount, setTpCount] = useState(3)
  const [signal, setSignal] = useState<Omit<Signal, 'id' | 'status'>>({ pair: '', direction: 'BUY', entry: '', sl: '', tp1: '', tp2: '', tp3: '', tp4: '', notes: '' })
  const [tip, setTip] = useState<Omit<Tip, 'id' | 'createdAt'>>({ title: '', category: 'Forex Strategy', content: '' })
  useEffect(() => {
    if (!authenticated) return
    hasServerSignalSnapshotRef.current = false
    const unsubscribe = subscribeToSignals((records, fromCache) => {
      if (fromCache && !hasServerSignalSnapshotRef.current) return
      if (!fromCache) hasServerSignalSnapshotRef.current = true
      setSignals(records.map((record) => ({
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
      })))
    })
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
        pushNotificationId?: string
        pushError?: string
      }
      if (!response.ok || !result.id) {
        setSignalFeedback({ status: 'error', message: result.error || 'Could not save this signal. Please try again.' })
        return
      }

      if (!result.pushAccepted || !result.pushNotificationId) {
        setSignalFeedback({
          status: 'error',
          message: `Signal saved, but OneSignal could not confirm the push notification. ${result.pushError || 'OneSignal did not return a notification ID.'}`,
          notificationId: result.pushNotificationId,
        })
      } else {
        setSignalFeedback({
          status: 'success',
          message: 'Signal push sent to VIP subscribers.',
          notificationId: result.pushNotificationId,
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
  async function closeSignal(id: string, status: 'WIN' | 'LOSS') {
    if (pendingSignalId) return
    setPendingSignalId(id)
    try {
      const response = await fetch('/api/admin/signals/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const result = await response.json() as { status?: 'WIN' | 'LOSS'; error?: string }
      if (!response.ok || (result.status !== 'WIN' && result.status !== 'LOSS')) {
        throw new Error(result.error || 'Signal status could not be saved. Please try again.')
      }

      if (result.status !== status) {
        throw new Error('The server returned a different signal outcome. Please refresh and try again.')
      }

      setSignals((current) => current.map((item) => item.id === id ? { ...item, status: result.status! } : item))
      const pair = signals.find((item) => item.id === id)?.pair ?? 'Signal'
      toast.success(`${pair} closed as ${result.status}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Signal status could not be saved. Please try again.')
    } finally {
      setPendingSignalId(null)
    }
  }
  async function deleteSignal(item: Pick<Signal, 'id' | 'pair'>) {
    if (pendingSignalId) return
    if (!window.confirm(`Delete the active ${item.pair} signal? This cannot be undone.`)) return

    setPendingSignalId(item.id)
    try {
      const response = await fetch('/api/admin/signals/status', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Signal could not be deleted. Please try again.')

      setSignals((current) => current.filter((signalItem) => signalItem.id !== item.id))
      toast.success(`${item.pair} signal deleted.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Signal could not be deleted. Please try again.')
    } finally {
      setPendingSignalId(null)
    }
  }
  async function publishTip(event: FormEvent) { event.preventDefault(); if (!tip.title || !tip.content) return; await createTip(tip).catch(() => undefined); setTip({ title: '', category: 'Forex Strategy', content: '' }); setTipSent(true); window.setTimeout(() => setTipSent(false), 1800) }
  if (!authenticated && isLockedOut) return <main className="min-h-screen bg-[#050814] px-4 py-8 text-slate-100 sm:px-6"><div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center"><section role="alert" className="w-full rounded-2xl border border-rose-500/50 bg-rose-950/30 p-6 shadow-2xl shadow-rose-950/30"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-300"><LockKeyhole size={21} /></div><h1 className="mt-5 text-2xl font-bold text-rose-200">Admin Access Locked</h1><p className="mt-3 text-base font-semibold leading-relaxed text-rose-100">Admin Access Locked due to multiple failed attempts. Please try again in 15 minutes.</p></section></div></main>
  if (!authenticated) return <main className="min-h-screen bg-[#050814] px-4 py-8 text-slate-100 sm:px-6"><div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center"><form onSubmit={(event) => { event.preventDefault(); unlock() }} className="w-full rounded-2xl border border-slate-800/80 bg-[#0a101d]/90 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl"><div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950"><LockKeyhole size={19} /></div><p className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-600 bg-clip-text text-sm font-bold uppercase tracking-[0.2em] text-transparent">Trade Smart Live</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Master trader access</h1><p className="mt-2 text-base leading-relaxed text-zinc-400">Manage live signals and market notes.</p>{authError && <p role="alert" className="mt-6 mb-2 text-sm font-bold text-rose-400">{authError}</p>}<FieldGroup className="mt-5"><FormField><FieldLabel htmlFor="admin-passcode" className="text-zinc-300">Passcode</FieldLabel><Input id="admin-passcode" autoFocus type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Enter master passcode" className="mt-2 h-11 border-zinc-700 bg-zinc-950 text-zinc-100 focus-visible:border-zinc-200" /></FormField></FieldGroup><button type="submit" className="mt-4 h-11 w-full touch-manipulation rounded-lg bg-zinc-100 text-sm font-bold text-zinc-950 transition-all active:scale-95">Enter dashboard</button><Link href="/" className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-300 transition-colors hover:text-zinc-200"><ArrowLeft size={14} /> Return to subscriber app</Link></form></div></main>
  return <main className="min-h-screen bg-[#050814] px-4 py-6 text-slate-100 sm:px-6 sm:py-8 lg:px-10"><div className="mx-auto max-w-6xl"><header className="flex flex-col gap-5 border-b border-slate-800/80 pb-7 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-4"><div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-cyan-300/30 bg-white shadow-lg shadow-blue-950/30 sm:size-16"><Image src="/logo.png" alt="Trade Smart Live" width={64} height={64} priority className="size-full object-contain" /></div><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200"><Radio size={14} className="text-emerald-400" /> Signal operations</div><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Admin dashboard</h1><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">Broadcast market intelligence, manage outcomes, and control VIP subscriptions.</p></div></div><Link href="/" className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-cyan-400/25 bg-cyan-400/5 px-4 text-sm font-semibold text-cyan-100 transition-colors hover:border-cyan-300/50 hover:bg-cyan-400/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 active:scale-95"><ArrowLeft size={14} /> Subscriber view</Link></header><div className="mt-8 flex flex-col gap-6"><AdminMemberDirectory onManage={(deviceId) => { setSelectedDeviceId(deviceId); window.setTimeout(() => document.getElementById('vip-device-management')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }} /><VipDeviceManager selectedDeviceId={selectedDeviceId} /></div><div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><section className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-xl shadow-blue-950/15 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Fast input</p><h2 className="mt-1 text-xl font-semibold">Create signal</h2><form onSubmit={broadcast} className="mt-6 flex flex-col gap-5"><div className="flex flex-col gap-2"><label htmlFor="signal-pair" className="text-sm font-medium text-slate-300">Asset pair</label><div className="flex flex-col gap-2 sm:flex-row"><input id="signal-pair" required list="saved-asset-pairs" value={signal.pair} onChange={(e) => setSignal({ ...signal, pair: e.target.value })} placeholder="XAU/USD, EUR/JPY, GBP/USD" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950/80 px-3 text-base outline-none placeholder:text-slate-500 focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 sm:text-sm" /><datalist id="saved-asset-pairs">{assetPairs.map((pair) => <option key={pair} value={pair} />)}</datalist><select aria-label="Choose a saved asset pair" value="" disabled={assetPairs.length === 0} onChange={(event) => { if (event.target.value) setSignal((current) => ({ ...current, pair: event.target.value })) }} className="h-12 rounded-xl border border-slate-700 bg-slate-950/80 px-3 text-base text-slate-200 outline-none focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 disabled:opacity-60 sm:w-44 sm:text-sm"><option value="">Saved pairs</option>{assetPairs.map((pair) => <option key={pair} value={pair}>{pair}</option>)}</select></div></div><div role="group" aria-label="Signal direction"><p className="text-sm font-medium text-slate-300">Trade direction</p><div className="mt-2 grid grid-cols-2 gap-3">{(['BUY', 'SELL'] as const).map((direction) => <button type="button" key={direction} aria-pressed={signal.direction === direction} onClick={() => setSignal({ ...signal, direction })} className={`h-12 rounded-xl text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${signal.direction === direction ? direction === 'BUY' ? 'bg-emerald-400 text-slate-950' : 'bg-rose-400 text-slate-950' : 'border border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500'}`}>{direction}</button>)}</div></div><div className="grid grid-cols-2 gap-3"><Field label="Entry price" value={signal.entry} onChange={(value) => setSignal({ ...signal, entry: value })} /><Field label="Stop loss" value={signal.sl} onChange={(value) => setSignal({ ...signal, sl: value })} /></div><label className="block text-sm font-medium text-slate-300">Take profit targets<select value={tpCount} onChange={(event) => setTpCount(Number(event.target.value))} className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 text-base outline-none focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 sm:text-sm"><option value={1}>1 TP</option><option value={2}>2 TPs</option><option value={3}>3 TPs</option><option value={4}>4 TPs</option></select></label><div className="grid grid-cols-2 gap-3">{Array.from({ length: tpCount }, (_, index) => { const field = `tp${index + 1}` as 'tp1' | 'tp2' | 'tp3' | 'tp4'; return <Field key={field} label={`TP${index + 1}`} value={signal[field]} onChange={(value) => setSignal((current) => ({ ...current, [field]: value }))} /> })}</div><label className="block text-sm font-medium text-slate-300">Analyst notes<textarea value={signal.notes} onChange={(e) => setSignal({ ...signal, notes: e.target.value })} className="mt-2 min-h-32 w-full rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-base leading-relaxed outline-none placeholder:text-slate-500 focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 sm:text-sm" placeholder="Context, invalidation, and risk plan..." /></label><ChartImageUpload file={chartImage} onFileChange={setChartImage} />{signalFeedback && <div role={signalFeedback.status === 'error' ? 'alert' : 'status'} aria-live={signalFeedback.status === 'error' ? 'assertive' : 'polite'} className={`flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm ${signalFeedback.status === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}><p>{signalFeedback.message}</p>{signalFeedback.notificationId && <p className="break-all font-mono text-xs">OneSignal notification ID: {signalFeedback.notificationId}</p>}</div>}<button type="submit" disabled={isBroadcasting} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/25 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100/70 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60">{isBroadcasting ? 'Sending signal and push…' : sent ? <><Check size={16} /> Signal saved</> : <><Bell size={16} /> Broadcast Signal & Push Alert</>}</button></form></section><div className="flex flex-col gap-6"><AdminSignalTrackRecord signals={signals} pendingSignalId={pendingSignalId} onClose={closeSignal} onDelete={deleteSignal} /><section className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-xl shadow-blue-950/15 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Market notes</p><h2 className="mt-1 text-xl font-semibold">Post a tip</h2><form onSubmit={publishTip} className="mt-5 flex flex-col gap-4"><input required aria-label="Tip title" value={tip.title} onChange={(e) => setTip({ ...tip, title: e.target.value })} placeholder="Title" className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 text-base outline-none placeholder:text-slate-500 focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 sm:text-sm" /><select aria-label="Tip category" value={tip.category} onChange={(e) => setTip({ ...tip, category: e.target.value })} className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 text-base text-slate-200 sm:text-sm"><option>Forex Strategy</option><option>Gold Analysis</option><option>Risk Management</option></select><textarea required aria-label="Market note" value={tip.content} onChange={(e) => setTip({ ...tip, content: e.target.value })} placeholder="Write your market note..." className="min-h-32 w-full rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-base leading-relaxed placeholder:text-slate-500 focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 sm:text-sm" /><button type="submit" className="h-12 w-full rounded-xl border border-cyan-300/50 bg-cyan-300/10 text-sm font-bold text-cyan-200 transition-colors hover:bg-cyan-300/15 active:scale-95">{tipSent ? 'Note published' : 'Publish market note'}</button></form></section></div></div></div></main>
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium text-slate-300">
      {label}
      <input
        required
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 font-mono text-base text-slate-100 outline-none placeholder:text-slate-500 focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 sm:text-sm"
      />
    </label>
  )
}

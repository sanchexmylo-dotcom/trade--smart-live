'use client'

import { FormEvent, useEffect, useState } from 'react'
import { ArrowLeft, Bell, Check, LockKeyhole, Radio, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { closeSignal as closeSignalInFirestore, createSignal, createTip, subscribeToSignals } from '@/lib/firestore'

type SignalStatus = 'ACTIVE' | 'WIN' | 'LOSS'
type Signal = { id: string; pair: string; direction: 'BUY' | 'SELL'; entry: string; sl: string; tp1: string; tp2: string; tp3: string; tp4: string; notes: string; status: SignalStatus }
type Tip = { id: number; category: string; title: string; content: string; createdAt: string }
const LOCKOUT_DURATION_MS = 15 * 60 * 1000

function playChime() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  const context = new AudioContextClass()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(740, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(1040, context.currentTime + 0.16)
  gain.gain.setValueAtTime(0.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24)
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.25)
}

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [authError, setAuthError] = useState('')
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [isLockedOut, setIsLockedOut] = useState(false)
  const [signals, setSignals] = useState<Signal[]>([])
  const [sent, setSent] = useState(false)
  const [signalError, setSignalError] = useState('')
  const [tipSent, setTipSent] = useState(false)
  const [subscriber, setSubscriber] = useState('')
  const [vipExpiry, setVipExpiry] = useState<string | null>(null)
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
        setAuthenticated(true)
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
    const takeProfits = [signal.tp1, signal.tp2, signal.tp3, signal.tp4].slice(0, tpCount)
    if (!signal.pair.trim() || !signal.entry.trim() || !signal.sl.trim() || takeProfits.some((level) => !level.trim())) return
    try {
      await createSignal({
        pair: signal.pair,
        action: signal.direction,
        entry: signal.entry,
        sl: signal.sl,
        tp1: signal.tp1,
        ...(tpCount >= 2 ? { tp2: signal.tp2 } : {}),
        ...(tpCount >= 3 ? { tp3: signal.tp3 } : {}),
        ...(tpCount >= 4 ? { tp4: signal.tp4 } : {}),
        notes: signal.notes,
      })
    } catch {
      setSignalError('Could not save this signal. Please try again.')
      return
    }
    setSignalError('')
    window.localStorage.setItem('trade-smart-live-last-signal', JSON.stringify({ ...signal, status: 'ACTIVE' }))
    window.dispatchEvent(new Event('trade-smart-live-signal'))
    await fetch('/api/onesignal/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair: signal.pair, action: signal.direction, entry: signal.entry, sl: signal.sl, tp1: signal.tp1 }) }).catch(() => undefined)
    playChime()
    setSignal({ pair: '', direction: 'BUY', entry: '', sl: '', tp1: '', tp2: '', tp3: '', tp4: '', notes: '' })
    setSent(true)
    window.setTimeout(() => setSent(false), 1800)
  }
  async function closeSignal(id: string, status: 'WIN' | 'LOSS') { await closeSignalInFirestore(id, status).catch(() => undefined) }
  async function publishTip(event: FormEvent) { event.preventDefault(); if (!tip.title || !tip.content) return; await createTip(tip).catch(() => undefined); setTip({ title: '', category: 'Forex Strategy', content: '' }); setTipSent(true); window.setTimeout(() => setTipSent(false), 1800) }
  function grantVip(event: FormEvent) { event.preventDefault(); if (!subscriber.trim()) return; const expiry = new Date(Date.now() + 30 * 86400000); setVipExpiry(expiry.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })); setSubscriber('') }
  if (!authenticated && isLockedOut) return <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black px-5 py-10 text-zinc-100"><div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center"><section role="alert" className="w-full rounded-2xl border border-rose-500/50 bg-rose-950/30 p-6 shadow-2xl shadow-rose-950/30"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-300"><LockKeyhole size={21} /></div><h1 className="mt-5 text-2xl font-bold text-rose-200">Admin Access Locked</h1><p className="mt-3 text-base font-semibold leading-relaxed text-rose-100">Admin Access Locked due to multiple failed attempts. Please try again in 15 minutes.</p></section></div></main>
  if (!authenticated) return <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black px-5 py-10 text-zinc-100"><div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center"><form onSubmit={(event) => { event.preventDefault(); unlock() }} className="w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-6 shadow-2xl backdrop-blur-xl"><div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950"><LockKeyhole size={19} /></div><p className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-600 bg-clip-text text-sm font-bold uppercase tracking-[0.2em] text-transparent">Trade Smart Live</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Master trader access</h1><p className="mt-2 text-base leading-relaxed text-zinc-400">Manage live signals and market notes.</p>{authError && <p role="alert" className="mt-6 mb-2 text-sm font-bold text-rose-400">{authError}</p>}<label className="block text-sm text-zinc-400">Passcode<input autoFocus type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Enter master passcode" className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 outline-none transition-all focus:border-zinc-200" /></label><button type="submit" className="mt-4 h-11 w-full touch-manipulation rounded-lg bg-zinc-100 text-sm font-bold text-zinc-950 transition-all active:scale-95">Enter dashboard</button><Link href="/" className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-300 transition-colors hover:text-zinc-200"><ArrowLeft size={14} /> Return to subscriber app</Link></form></div></main>
  return <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black px-5 py-8 text-zinc-100 md:px-10"><div className="mx-auto max-w-6xl"><header className="flex flex-col gap-5 border-b border-zinc-800/80 pb-7 md:flex-row md:items-end md:justify-between"><div><div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300"><Radio size={14} className="text-emerald-400" /> Signal operations</div><h1 className="mt-3 text-3xl font-semibold tracking-tight">Admin dashboard</h1><p className="mt-2 text-base text-zinc-400">Broadcast market intelligence, manage outcomes, and activate VIP members.</p></div><Link href="/" className="flex items-center gap-2 self-start rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-300 transition-all hover:border-zinc-500 active:scale-95"><ArrowLeft size={14} /> Subscriber view</Link></header><div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Fast input</p><h2 className="mt-1 text-xl font-semibold">Create signal</h2><form onSubmit={broadcast} className="mt-6 space-y-4"><label className="block text-sm text-zinc-400">Asset pair<input required value={signal.pair} onChange={(e) => setSignal({ ...signal, pair: e.target.value })} placeholder="XAU/USD, EUR/JPY, GBP/USD" className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-cyan-400" /></label><div><p className="text-sm text-zinc-400">Direction</p><div className="mt-2 grid grid-cols-2 gap-2">{(['BUY', 'SELL'] as const).map((direction) => <button type="button" key={direction} onClick={() => setSignal({ ...signal, direction })} className={`h-11 rounded-lg text-sm font-bold ${signal.direction === direction ? direction === 'BUY' ? 'bg-emerald-500 text-zinc-950' : 'bg-rose-500 text-white' : 'border border-zinc-700 text-zinc-300'}`}>{direction}</button>)}</div></div><div className="grid grid-cols-2 gap-3"><Field label="Entry" value={signal.entry} onChange={(value) => setSignal({ ...signal, entry: value })} /><Field label="Stop Loss" value={signal.sl} onChange={(value) => setSignal({ ...signal, sl: value })} /></div><label className="block text-sm text-zinc-400">Number of Take Profits<select value={tpCount} onChange={(event) => setTpCount(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-cyan-400"><option value={1}>1 TP</option><option value={2}>2 TPs</option><option value={3}>3 TPs</option><option value={4}>4 TPs</option></select></label><div className="grid grid-cols-2 gap-3">{Array.from({ length: tpCount }, (_, index) => { const field = `tp${index + 1}` as 'tp1' | 'tp2' | 'tp3' | 'tp4'; return <Field key={field} label={`TP${index + 1}`} value={signal[field]} onChange={(value) => setSignal((current) => ({ ...current, [field]: value }))} /> })}</div><label className="block text-sm text-zinc-400">Analyst notes<textarea value={signal.notes} onChange={(e) => setSignal({ ...signal, notes: e.target.value })} className="mt-2 min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm outline-none focus:border-cyan-400" placeholder="Context, invalidation, and risk plan..." /></label>{signalError && <p role="alert" className="text-sm text-rose-300">{signalError}</p>}<button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 text-sm font-bold text-zinc-950 active:scale-95">{sent ? <><Check size={16} /> Signal broadcasted</> : <><Bell size={16} /> Broadcast Signal & Push Alert</>}</button></form></section><div className="space-y-6"><section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Track record</p><h2 className="mt-1 text-xl font-semibold">Signal track record</h2><div className="mt-4 space-y-3">{signals.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-400">No signals yet.</p> : signals.map((item) => <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"><div className="flex items-center justify-between"><div><p className="font-bold">{item.pair} <span className="font-mono text-sm text-slate-300">{item.direction}</span></p><p className="mt-1 font-mono text-sm text-slate-300">Entry {item.entry} · {[item.tp1, item.tp2, item.tp3, item.tp4].filter(Boolean).map((value, index) => `TP${index + 1} ${value}`).join(' · ')} · SL {item.sl}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.status === 'WIN' ? 'bg-emerald-500/15 text-emerald-300' : item.status === 'LOSS' ? 'bg-rose-500/15 text-rose-300' : 'bg-cyan-500/15 text-cyan-300'}`}>{item.status}</span></div>{item.status === 'ACTIVE' && <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => closeSignal(item.id, 'WIN')} className="rounded-lg bg-emerald-500/15 py-2 text-sm font-bold text-emerald-300 active:scale-95">Closed Win</button><button onClick={() => closeSignal(item.id, 'LOSS')} className="rounded-lg bg-rose-500/15 py-2 text-sm font-bold text-rose-300 active:scale-95">Closed Loss</button></div>}</div>)}</div></section><section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Manual activation</p><h2 className="mt-1 text-xl font-semibold">Grant VIP access</h2><form onSubmit={grantVip} className="mt-4 flex gap-2"><input required type="text" value={subscriber} onChange={(e) => setSubscriber(e.target.value)} placeholder="Email or username" className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-cyan-400" /><button type="submit" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-cyan-300 text-zinc-950 active:scale-95" aria-label="Grant VIP access"><UserPlus size={17} /></button></form>{vipExpiry && <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Check size={15} /> VIP granted until {vipExpiry}</p>}</section><section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-xl md:p-6"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Market notes</p><h2 className="mt-1 text-xl font-semibold">Post a tip</h2><form onSubmit={publishTip} className="mt-4 space-y-3"><input required value={tip.title} onChange={(e) => setTip({ ...tip, title: e.target.value })} placeholder="Title" className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-cyan-400" /><select value={tip.category} onChange={(e) => setTip({ ...tip, category: e.target.value })} className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"><option>Forex Strategy</option><option>Gold Analysis</option><option>Risk Management</option></select><textarea required value={tip.content} onChange={(e) => setTip({ ...tip, content: e.target.value })} placeholder="Write your market note..." className="min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm" /><button type="submit" className="h-11 w-full rounded-lg border border-cyan-400/50 text-sm font-bold text-cyan-300 active:scale-95">{tipSent ? 'Note published' : 'Publish market note'}</button></form></section></div></div></div></main>
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-sm text-zinc-400">{label}<input required value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 font-mono text-sm outline-none focus:border-cyan-400" /></label> }

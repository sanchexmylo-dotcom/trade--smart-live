import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db, enableFirestoreOfflineAccess } from './firebase'

export type SignalRecord = {
  id: string
  pair: string
  action: 'BUY' | 'SELL'
  entry: string
  sl: string
  tp1: string
  tp2?: string
  tp3?: string
  tp4?: string
  notes?: string
  status: 'ACTIVE' | 'WIN' | 'LOSS'
  createdAt?: unknown
}

export type TipRecord = { id: string; category: string; title: string; content: string; createdAt?: unknown }

export function subscribeToSignals(onChange: (signals: SignalRecord[]) => void) {
  enableFirestoreOfflineAccess()
  return onSnapshot(query(collection(db, 'signals'), orderBy('createdAt', 'desc'), limit(50)), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as SignalRecord)))
  })
}

export function subscribeToTips(onChange: (tips: TipRecord[]) => void) {
  enableFirestoreOfflineAccess()
  return onSnapshot(query(collection(db, 'tips'), orderBy('createdAt', 'desc'), limit(50)), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as TipRecord)))
  })
}

export async function createSignal(signal: Omit<SignalRecord, 'id' | 'createdAt' | 'status'>) {
  const signalRef = await addDoc(collection(db, 'signals'), { ...signal, status: 'ACTIVE', createdAt: serverTimestamp() })
  return signalRef.id
}

export async function createTip(tip: Omit<TipRecord, 'id' | 'createdAt'>) {
  const tipRef = await addDoc(collection(db, 'tips'), { ...tip, createdAt: serverTimestamp() })
  return tipRef.id
}

export async function closeSignal(signalId: string, status: 'WIN' | 'LOSS') {
  const payload = { status, closedAt: serverTimestamp() }
  await Promise.all([
    updateDoc(doc(db, 'signals', signalId), payload),
    setDoc(doc(db, 'track_record', signalId), { signalId, status, closedAt: serverTimestamp() }, { merge: true }),
  ])
}

import { getApp, getApps, initializeApp } from 'firebase/app'
import { enableMultiTabIndexedDbPersistence, getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: 'trade-smart-live.firebaseapp.com',
  projectId: 'trade-smart-live',
  storageBucket: 'trade-smart-live.firebasestorage.app',
  messagingSenderId: '535415985064',
  appId: '1:535415985064:web:ef89f492cede07a7e2839d',
  measurementId: 'G-MRCBW4MMTE',
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const db = getFirestore(app)

let persistencePromise: Promise<void> | undefined
export function enableFirestoreOfflineAccess() {
  if (typeof window === 'undefined' || persistencePromise) return persistencePromise
  persistencePromise = enableMultiTabIndexedDbPersistence(db).catch(() => undefined)
  return persistencePromise
}

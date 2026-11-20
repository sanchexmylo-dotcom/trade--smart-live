import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

const appName = 'trade-smart-live-server'
const projectId = 'trade-smart-live'

function getAdminApp() {
  const existingApp = getApps().find((app) => app.name === appName)
  if (existingApp) return existingApp

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!serviceAccountJson) throw new Error('Firebase server credentials are not configured.')

  const serviceAccount = JSON.parse(serviceAccountJson) as {
    project_id?: string
    client_email?: string
    private_key?: string
  }

  if (
    serviceAccount.project_id !== projectId ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new Error('Firebase server credentials do not match the configured project.')
  }

  return initializeApp(
    {
      credential: cert({
        projectId,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
      }),
      projectId,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'trade-smart-live.firebasestorage.app',
    },
    appName,
  )
}

export const adminApp = getAdminApp()
export const adminDb = getFirestore(adminApp)
export const adminStorage = getStorage(adminApp).bucket(process.env.FIREBASE_STORAGE_BUCKET || 'trade-smart-live.firebasestorage.app')
export { FieldValue, Timestamp }

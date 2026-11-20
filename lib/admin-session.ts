import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { adminDb } from '@/lib/firebase-admin'

const cookieName = 'tsl_admin_session'
const sessionDurationSeconds = 8 * 60 * 60

function signingKey() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!serviceAccountJson || serviceAccountJson.length < 32) return null
  return createHmac('sha256', serviceAccountJson)
    .update('trade-smart-live:admin-session:v1')
    .digest()
}

function signatureFor(payload: string, key: Buffer) {
  return createHmac('sha256', key).update(payload).digest('hex')
}

function cookieValue(request: Request) {
  const cookies = request.headers.get('cookie')?.split(';') ?? []
  const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${cookieName}=`))
  return entry?.slice(cookieName.length + 1) ?? null
}

export function adminPinMatches(candidate: string) {
  const configuredPin = process.env.VIP_ADMIN_PIN
  if (!configuredPin || candidate.length > 128) return false

  const expected = Buffer.from(configuredPin.trim())
  const received = Buffer.from(candidate.trim())
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function createAdminSessionCookie(request: Request) {
  const key = signingKey()
  if (!key) throw new Error('Admin session signing is not configured.')

  const expiresAt = Date.now() + sessionDurationSeconds * 1000
  const payload = `${expiresAt}.${randomBytes(24).toString('base64url')}`
  const value = `${payload}.${signatureFor(payload, key)}`
  const secure = new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production'

  return `${cookieName}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${sessionDurationSeconds}${secure ? '; Secure' : ''}`
}

export function hasValidAdminSession(request: Request) {
  const key = signingKey()
  const value = cookieValue(request)
  if (!key || !value) return false

  const signatureSeparator = value.lastIndexOf('.')
  if (signatureSeparator < 1) return false

  const payload = value.slice(0, signatureSeparator)
  const signature = value.slice(signatureSeparator + 1)
  if (!/^[a-f0-9]{64}$/.test(signature)) return false

  const expiresAt = Number(payload.slice(0, payload.indexOf('.')))
  const now = Date.now()
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + sessionDurationSeconds * 1000 + 60_000) {
    return false
  }

  const expected = Buffer.from(signatureFor(payload, key), 'hex')
  const received = Buffer.from(signature, 'hex')
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const adminLoginWindowMs = 15 * 60 * 1000
const adminLoginLimit = 5

function adminLoginRateRef(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
  const source = request.headers.get('x-real-ip')?.trim() || forwardedFor || 'unknown'
  const key = createHash('sha256').update(source).digest('hex')
  return adminDb.collection('adminLoginRateLimits').doc(key)
}

export async function isAdminLoginRateLimited(request: Request) {
  const snapshot = await adminLoginRateRef(request).get()
  return Number(snapshot.get('lockedUntil') ?? 0) > Date.now()
}

export async function recordAdminLoginFailure(request: Request) {
  const rateRef = adminLoginRateRef(request)
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateRef)
    const now = Date.now()
    const currentLock = Number(snapshot.get('lockedUntil') ?? 0)
    if (currentLock > now) return true

    const currentWindowStart = Number(snapshot.get('windowStart') ?? 0)
    const sameWindow = currentWindowStart + adminLoginWindowMs > now
    const attempts = sameWindow ? Number(snapshot.get('attempts') ?? 0) + 1 : 1
    const lockedUntil = attempts >= adminLoginLimit ? now + adminLoginWindowMs : 0

    transaction.set(rateRef, {
      windowStart: sameWindow ? currentWindowStart : now,
      attempts,
      lockedUntil,
      updatedAt: now,
    })
    return lockedUntil > 0
  })
}

export async function clearAdminLoginFailures(request: Request) {
  await adminLoginRateRef(request).delete()
}

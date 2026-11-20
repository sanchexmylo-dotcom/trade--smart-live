import { createHash, randomInt } from 'node:crypto'
import { adminDb, FieldValue, Timestamp } from '@/lib/firebase-admin'
import type { AdminDeviceRecord, DeviceProfile } from '@/lib/device-profile-types'

const deviceIdPattern = /^TSL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/
const referralCodePattern = /^REF-[A-HJ-NP-Z2-9]{6}$/
const tokenPattern = /^[a-f0-9]{64}$/
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const devices = () => adminDb.collection('devices')
const referralCodes = () => adminDb.collection('referralCodes')
const referrals = () => adminDb.collection('referrals')
const deviceTokens = () => adminDb.collection('deviceTokens')

export function isDeviceId(value: string) {
  return deviceIdPattern.test(value.trim().toUpperCase())
}

export function normalizeReferralCode(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return referralCodePattern.test(normalized) ? normalized : null
}

function isDeviceToken(value: unknown): value is string {
  return typeof value === 'string' && tokenPattern.test(value)
}

function createCode(length: number) {
  return Array.from({ length }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('')
}

function createDeviceId() {
  return `TSL-${createCode(4)}-${createCode(4)}`
}

function createReferralCode() {
  return `REF-${createCode(6)}`
}

function hashDeviceToken(deviceToken: string) {
  return createHash('sha256').update(deviceToken).digest('hex')
}

function dateFromFirestore(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function isStoredVipActive(data: Record<string, unknown>, now: number) {
  const expiresAt = dateFromFirestore(data.planExpiresAt)
  return data.vipActive === true && expiresAt !== null && expiresAt.getTime() > now
}

function nonNegativeInteger(value: unknown) {
  const parsed = typeof value === 'number' ? Math.floor(value) : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

async function buildProfile(deviceId: string, data: Record<string, unknown>): Promise<DeviceProfile> {
  const referralSnapshot = await referrals().where('referrerDeviceId', '==', deviceId).get()
  const now = Date.now()
  const referredDeviceSnapshots = await Promise.all(
    referralSnapshot.docs.map((referral) => {
      const referredDeviceId = referral.get('referredDeviceId')
      return typeof referredDeviceId === 'string'
        ? devices().doc(referredDeviceId).get()
        : Promise.resolve(null)
    }),
  )
  const activeVipReferrals = referredDeviceSnapshots.filter(
    (snapshot) => snapshot?.exists && isStoredVipActive(snapshot.data() ?? {}, now),
  ).length
  const planExpiresAt = dateFromFirestore(data.planExpiresAt)
  const createdAt = dateFromFirestore(data.createdAt)

  return {
    deviceId,
    referralCode: typeof data.referralCode === 'string' ? data.referralCode : '',
    vipActive: isStoredVipActive(data, now),
    planExpiresAt: planExpiresAt?.toISOString() ?? null,
    createdAt: createdAt?.toISOString() ?? null,
    invitedFriends: referralSnapshot.size,
    activeVipReferrals,
    rewardDaysEarned: nonNegativeInteger(data.rewardDaysEarned),
    rewardDaysAvailable: nonNegativeInteger(data.rewardDaysAvailable),
  }
}

export async function getDeviceIdForToken(deviceToken: string) {
  if (!isDeviceToken(deviceToken)) return null
  const tokenSnapshot = await deviceTokens().doc(hashDeviceToken(deviceToken)).get()
  const deviceId = tokenSnapshot.get('deviceId')
  return tokenSnapshot.exists && typeof deviceId === 'string' && isDeviceId(deviceId)
    ? deviceId.toUpperCase()
    : null
}

export async function getDeviceProfile(deviceId: string) {
  if (!isDeviceId(deviceId)) return null
  const normalizedId = deviceId.trim().toUpperCase()
  const snapshot = await devices().doc(normalizedId).get()
  if (!snapshot.exists) return null
  return buildProfile(normalizedId, snapshot.data() ?? {})
}

export async function getDeviceProfileForToken(deviceToken: string) {
  const deviceId = await getDeviceIdForToken(deviceToken)
  return deviceId ? getDeviceProfile(deviceId) : null
}

export async function getAdminDeviceRecord(deviceId: string): Promise<AdminDeviceRecord | null> {
  if (!isDeviceId(deviceId)) return null
  const normalizedId = deviceId.trim().toUpperCase()
  const snapshot = await devices().doc(normalizedId).get()
  if (!snapshot.exists) return null
  const data = snapshot.data() ?? {}
  const profile = await buildProfile(normalizedId, data)

  return {
    ...profile,
    referredByDeviceId: typeof data.referredByDeviceId === 'string' ? data.referredByDeviceId : null,
    referredByCode: typeof data.referredByCode === 'string' ? data.referredByCode : null,
  }
}

export async function registerDevice(deviceToken: string, rawReferralCode: unknown) {
  if (!isDeviceToken(deviceToken)) throw new Error('Invalid device token.')

  const tokenHash = hashDeviceToken(deviceToken)
  const tokenRef = deviceTokens().doc(tokenHash)
  const submittedReferralCode = normalizeReferralCode(rawReferralCode)
  const submittedReferralRef = submittedReferralCode ? referralCodes().doc(submittedReferralCode) : null

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidateDeviceId = createDeviceId()
    const candidateReferralCode = createReferralCode()
    const candidateDeviceRef = devices().doc(candidateDeviceId)
    const candidateCodeRef = referralCodes().doc(candidateReferralCode)

    const result = await adminDb.runTransaction(async (transaction) => {
      const tokenSnapshot = await transaction.get(tokenRef)
      const currentDeviceId = tokenSnapshot.exists
        ? tokenSnapshot.get('deviceId')
        : candidateDeviceId

      if (typeof currentDeviceId !== 'string' || !isDeviceId(currentDeviceId)) {
        throw new Error('Device identity could not be resolved.')
      }

      const normalizedDeviceId = currentDeviceId.toUpperCase()
      const currentDeviceRef = tokenSnapshot.exists ? devices().doc(normalizedDeviceId) : candidateDeviceRef
      const currentReferralRef = referrals().doc(normalizedDeviceId)
      const [deviceSnapshot, candidateCodeSnapshot, submittedCodeSnapshot, referralSnapshot] = await Promise.all([
        transaction.get(currentDeviceRef),
        transaction.get(candidateCodeRef),
        submittedReferralRef ? transaction.get(submittedReferralRef) : Promise.resolve(null),
        transaction.get(currentReferralRef),
      ])

      const referrerDeviceId = submittedCodeSnapshot?.exists
        ? submittedCodeSnapshot.get('deviceId')
        : null
      const normalizedReferrerId =
        typeof referrerDeviceId === 'string' && isDeviceId(referrerDeviceId)
          ? referrerDeviceId.toUpperCase()
          : null
      const referrerRef = normalizedReferrerId && normalizedReferrerId !== normalizedDeviceId
        ? devices().doc(normalizedReferrerId)
        : null
      const referrerSnapshot = referrerRef ? await transaction.get(referrerRef) : null

      if (tokenSnapshot.exists) {
        if (!deviceSnapshot.exists) throw new Error('Device profile is missing.')
        const existingData = deviceSnapshot.data() ?? {}
        const canAttachReferral =
          !existingData.referredByDeviceId &&
          !existingData.firstPaidAt &&
          existingData.vipActive !== true &&
          !referralSnapshot.exists &&
          normalizedReferrerId !== null &&
          referrerSnapshot?.exists === true

        if (canAttachReferral && submittedReferralCode && referrerRef) {
          transaction.update(currentDeviceRef, {
            referredByDeviceId: normalizedReferrerId,
            referredByCode: submittedReferralCode,
            updatedAt: FieldValue.serverTimestamp(),
          })
          transaction.create(currentReferralRef, {
            referralCode: submittedReferralCode,
            referrerDeviceId: normalizedReferrerId,
            referredDeviceId: normalizedDeviceId,
            rewardDays: 0,
            rewardGranted: false,
            status: 'registered',
            createdAt: FieldValue.serverTimestamp(),
          })
          transaction.update(referrerRef, {
            invitedFriends: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }

        return { deviceId: normalizedDeviceId, collision: false }
      }

      if (deviceSnapshot.exists || candidateCodeSnapshot.exists) {
        return { deviceId: normalizedDeviceId, collision: true }
      }

      const shouldCreateReferral =
        submittedReferralCode !== null &&
        normalizedReferrerId !== null &&
        normalizedReferrerId !== normalizedDeviceId &&
        referrerRef !== null &&
        referrerSnapshot?.exists === true

      transaction.create(currentDeviceRef, {
        deviceId: normalizedDeviceId,
        referralCode: candidateReferralCode,
        referredByDeviceId: shouldCreateReferral ? normalizedReferrerId : null,
        referredByCode: shouldCreateReferral ? submittedReferralCode : null,
        vipActive: false,
        planExpiresAt: null,
        firstPaidAt: null,
        invitedFriends: 0,
        rewardDaysEarned: 0,
        rewardDaysAvailable: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(candidateCodeRef, {
        deviceId: normalizedDeviceId,
        createdAt: FieldValue.serverTimestamp(),
      })
      transaction.create(tokenRef, {
        deviceId: normalizedDeviceId,
        createdAt: FieldValue.serverTimestamp(),
      })

      if (shouldCreateReferral && submittedReferralCode && referrerRef) {
        transaction.create(currentReferralRef, {
          referralCode: submittedReferralCode,
          referrerDeviceId: normalizedReferrerId,
          referredDeviceId: normalizedDeviceId,
          rewardDays: 0,
          rewardGranted: false,
          status: 'registered',
          createdAt: FieldValue.serverTimestamp(),
        })
        transaction.update(referrerRef, {
          invitedFriends: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }

      return { deviceId: normalizedDeviceId, collision: false }
    })

    if (result.collision) continue
    const profile = await getDeviceProfile(result.deviceId)
    if (profile) return profile
    throw new Error('Device profile could not be loaded.')
  }

  throw new Error('Could not allocate a unique device identifier.')
}

export async function changeVipAccess(
  deviceId: string,
  action: { type: 'set'; active: boolean } | { type: 'extend'; days: number },
) {
  if (!isDeviceId(deviceId)) return false
  const normalizedId = deviceId.trim().toUpperCase()
  const deviceRef = devices().doc(normalizedId)
  const referralRef = referrals().doc(normalizedId)

  return adminDb.runTransaction(async (transaction) => {
    const [deviceSnapshot, referralSnapshot] = await Promise.all([
      transaction.get(deviceRef),
      transaction.get(referralRef),
    ])
    if (!deviceSnapshot.exists) return false

    const now = Date.now()
    const currentData = deviceSnapshot.data() ?? {}
    const currentExpiry = dateFromFirestore(currentData.planExpiresAt)?.getTime() ?? 0
    let nextExpiry = currentExpiry
    let active = action.type === 'set' ? action.active : true

    if (action.type === 'extend') {
      nextExpiry = Math.max(now, currentExpiry) + action.days * 24 * 60 * 60 * 1000
    } else if (action.active && currentExpiry <= now) {
      nextExpiry = now + 30 * 24 * 60 * 60 * 1000
    }

    transaction.update(deviceRef, {
      vipActive: active,
      planExpiresAt: nextExpiry > 0 ? Timestamp.fromMillis(nextExpiry) : null,
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (referralSnapshot.exists) {
      transaction.update(referralRef, {
        status: active && nextExpiry > now ? 'vip_active' : 'registered',
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    return true
  })
}

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { adminDb, FieldValue, Timestamp } from '@/lib/firebase-admin'
import { verifyMonnifyPayment } from '@/lib/monnify'
import { syncOneSignalVipTag } from '@/lib/onesignal-server'

export const runtime = 'nodejs'

const VIP_PLAN_AMOUNT_NGN = 15_000
const VIP_PLAN_DAYS = 30
const REFERRAL_REWARD_DAYS = 7
const noStore = { 'Cache-Control': 'no-store' }

function validSignature(rawBody: string, suppliedSignature: string | null, secret: string) {
  if (!suppliedSignature || !/^[a-f0-9]{128}$/i.test(suppliedSignature)) return false
  const expected = Buffer.from(createHmac('sha512', secret).update(rawBody).digest('hex'), 'hex')
  const received = Buffer.from(suppliedSignature, 'hex')
  return expected.length === received.length && timingSafeEqual(expected, received)
}

function expiryMillis(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  return 0
}

async function creditVerifiedPayment(
  paymentReference: string,
  transactionReference: string,
  amountPaid: number,
) {
  const paymentRef = adminDb.collection('payments').doc(paymentReference)

  return adminDb.runTransaction(async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef)
    if (!paymentSnapshot.exists) return false

    const payment = paymentSnapshot.data() ?? {}
    if (payment.status === 'paid') return true
    if (Number(payment.amount) !== amountPaid || payment.currency !== 'NGN') return false

    const deviceId = typeof payment.deviceId === 'string' ? payment.deviceId : ''
    if (!/^TSL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(deviceId)) return false

    const deviceRef = adminDb.collection('devices').doc(deviceId)
    const referralRef = adminDb.collection('referrals').doc(deviceId)
    const referrerDeviceId = typeof payment.referrerDeviceId === 'string' ? payment.referrerDeviceId : null
    const referrerRef = referrerDeviceId
      ? adminDb.collection('devices').doc(referrerDeviceId)
      : null
    const [deviceSnapshot, referralSnapshot, referrerSnapshot] = await Promise.all([
      transaction.get(deviceRef),
      transaction.get(referralRef),
      referrerRef ? transaction.get(referrerRef) : Promise.resolve(null),
    ])

    if (!deviceSnapshot.exists) return false

    const device = deviceSnapshot.data() ?? {}
    const now = Date.now()
    const currentExpiry = expiryMillis(device.planExpiresAt)
    const nextExpiry = Math.max(now, currentExpiry) + VIP_PLAN_DAYS * 24 * 60 * 60 * 1000
    const storedPlanDays = Number(device.planDurationDays)
    const currentPlanDays = Number.isSafeInteger(storedPlanDays) && storedPlanDays > 0 ? storedPlanDays : VIP_PLAN_DAYS

    transaction.update(deviceRef, {
      vipActive: true,
      planDurationDays: currentExpiry > now ? currentPlanDays + VIP_PLAN_DAYS : VIP_PLAN_DAYS,
      planExpiresAt: Timestamp.fromMillis(nextExpiry),
      firstPaidAt: device.firstPaidAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.update(paymentRef, {
      status: 'paid',
      transactionReference,
      verifiedAmount: amountPaid,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const referral = referralSnapshot.data() ?? {}
    const eligibleReferrer =
      referrerRef !== null &&
      referrerSnapshot?.exists === true &&
      referralSnapshot.exists &&
      referral.referrerDeviceId === referrerDeviceId &&
      referral.rewardGranted !== true

    if (eligibleReferrer && referrerRef) {
      transaction.update(referralRef, {
        status: 'vip_active',
        rewardGranted: true,
        rewardDays: REFERRAL_REWARD_DAYS,
        rewardPaymentReference: paymentReference,
        rewardedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(referrerRef, {
        rewardDaysEarned: FieldValue.increment(REFERRAL_REWARD_DAYS),
        rewardDaysAvailable: FieldValue.increment(REFERRAL_REWARD_DAYS),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else if (referralSnapshot.exists) {
      transaction.update(referralRef, {
        status: 'vip_active',
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    return true
  })
}

export async function POST(request: Request) {
  const secret = process.env.MONNIFY_SECRET_KEY?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'Webhook verification is not configured.' }, { status: 503, headers: noStore })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('monnify-signature') ?? request.headers.get('x-monnify-signature')
  if (!validSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401, headers: noStore })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid webhook body.' }, { status: 400, headers: noStore })
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid webhook body.' }, { status: 400, headers: noStore })
  }

  const event = payload as {
    eventType?: unknown
    eventData?: { paymentReference?: unknown }
  }
  if (event.eventType !== 'SUCCESSFUL_COLLECTION') {
    return NextResponse.json({ received: true }, { headers: noStore })
  }

  const paymentReference = event.eventData?.paymentReference
  if (typeof paymentReference !== 'string' || paymentReference.length < 8 || paymentReference.length > 100) {
    return NextResponse.json({ error: 'Invalid payment reference.' }, { status: 400, headers: noStore })
  }

  try {
    const paymentSnapshot = await adminDb.collection('payments').doc(paymentReference).get()
    if (!paymentSnapshot.exists) return NextResponse.json({ received: true }, { headers: noStore })
    if (paymentSnapshot.get('status') === 'paid') return NextResponse.json({ received: true }, { headers: noStore })

    const verified = await verifyMonnifyPayment(paymentReference)
    const expectedAmount = Number(paymentSnapshot.get('amount'))
    if (
      verified.paymentReference !== paymentReference ||
      verified.paymentStatus !== 'PAID' ||
      verified.currency !== 'NGN' ||
      verified.amountPaid !== expectedAmount ||
      expectedAmount !== VIP_PLAN_AMOUNT_NGN
    ) {
      return NextResponse.json({ error: 'Payment is not verified.' }, { status: 409, headers: noStore })
    }

    const credited = await creditVerifiedPayment(
      paymentReference,
      verified.transactionReference,
      verified.amountPaid,
    )
    if (!credited) {
      return NextResponse.json({ error: 'Payment could not be applied.' }, { status: 409, headers: noStore })
    }

    const deviceId = paymentSnapshot.get('deviceId')
    if (typeof deviceId === 'string') await syncOneSignalVipTag(deviceId, true)

    return NextResponse.json({ received: true }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'Payment processing is temporarily unavailable.' }, { status: 503, headers: noStore })
  }
}

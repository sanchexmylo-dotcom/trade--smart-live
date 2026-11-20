import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { adminDb, FieldValue } from '@/lib/firebase-admin'
import { getDeviceIdForToken } from '@/lib/device-profile-server'
import { initializeMonnifyCheckout } from '@/lib/monnify'

export const runtime = 'nodejs'

const VIP_PLAN_AMOUNT_NGN = 15_000
const VIP_PLAN_DAYS = 30
const noStore = { 'Cache-Control': 'no-store' }

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer ([a-f0-9]{64})$/)
  return match?.[1] ?? null
}

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function redirectBaseUrl(request: Request) {
  if (process.env.VERCEL_ENV === 'production') return 'https://trade-smart-live.vercel.app'
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return new URL(request.url).origin
}

export async function POST(request: Request) {
  const deviceToken = bearerToken(request)
  if (!deviceToken) {
    return NextResponse.json({ error: 'Device authorization is required.' }, { status: 401, headers: noStore })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore })
  }

  if (!body || typeof body !== 'object' || !('customerEmail' in body) || !isValidEmail(body.customerEmail)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400, headers: noStore })
  }

  try {
    const deviceId = await getDeviceIdForToken(deviceToken)
    if (!deviceId) {
      return NextResponse.json({ error: 'Device profile was not found.' }, { status: 404, headers: noStore })
    }

    const deviceRef = adminDb.collection('devices').doc(deviceId)
    const deviceSnapshot = await deviceRef.get()
    if (!deviceSnapshot.exists) {
      return NextResponse.json({ error: 'Device profile was not found.' }, { status: 404, headers: noStore })
    }

    const device = deviceSnapshot.data() ?? {}
    const paymentReference = randomUUID()
    const referralCode = typeof device.referredByCode === 'string' ? device.referredByCode : null
    const referrerDeviceId = typeof device.referredByDeviceId === 'string' ? device.referredByDeviceId : null
    const paymentRef = adminDb.collection('payments').doc(paymentReference)

    await paymentRef.create({
      paymentReference,
      deviceId,
      customerEmail: body.customerEmail.trim().toLowerCase(),
      amount: VIP_PLAN_AMOUNT_NGN,
      currency: 'NGN',
      planDays: VIP_PLAN_DAYS,
      referralCode,
      referrerDeviceId,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const redirectUrl = new URL('/', redirectBaseUrl(request))
    redirectUrl.searchParams.set('payment', 'return')
    redirectUrl.searchParams.set('paymentReference', paymentReference)

    try {
      const checkout = await initializeMonnifyCheckout({
        amount: VIP_PLAN_AMOUNT_NGN,
        customerEmail: body.customerEmail.trim().toLowerCase(),
        customerName: deviceId,
        paymentReference,
        redirectUrl: redirectUrl.toString(),
        metadata: { deviceId, referralCode },
      })
      await paymentRef.update({
        transactionReference: checkout.transactionReference,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return NextResponse.json({ checkoutUrl: checkout.checkoutUrl }, { headers: noStore })
    } catch {
      await paymentRef.update({
        status: 'initialization_failed',
        updatedAt: FieldValue.serverTimestamp(),
      })
      return NextResponse.json(
        { error: 'Secure checkout could not be started. Please try again.' },
        { status: 502, headers: noStore },
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Secure checkout could not be started. Please try again.' },
      { status: 503, headers: noStore },
    )
  }
}

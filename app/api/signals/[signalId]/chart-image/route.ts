import { NextResponse } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { getDeviceProfileForToken } from '@/lib/device-profile-server'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }

function getDeviceToken(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)
  return match?.[1] ?? null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ signalId: string }> },
) {
  const deviceToken = getDeviceToken(request)
  if (!deviceToken) {
    return NextResponse.json({ error: 'VIP device authorization is required.' }, { status: 401, headers: noStore })
  }

  const { signalId } = await params
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(signalId)) {
    return NextResponse.json({ error: 'Chart image was not found.' }, { status: 404, headers: noStore })
  }

  try {
    const profile = await getDeviceProfileForToken(deviceToken)
    if (!profile?.vipActive) {
      return NextResponse.json({ error: 'Active VIP access is required.' }, { status: 403, headers: noStore })
    }

    const signalSnapshot = await adminDb.collection('signals').doc(signalId).get()
    const chartImagePath = signalSnapshot.get('chartImagePath')
    if (
      !signalSnapshot.exists ||
      typeof chartImagePath !== 'string' ||
      !chartImagePath.startsWith(`signals/${signalId}/`)
    ) {
      return NextResponse.json({ error: 'Chart image was not found.' }, { status: 404, headers: noStore })
    }

    const [url] = await adminStorage.file(chartImagePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 5 * 60 * 1000,
    })

    return NextResponse.json({ url }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'Chart image is temporarily unavailable.' }, { status: 503, headers: noStore })
  }
}

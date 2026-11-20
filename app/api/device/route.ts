import { NextResponse } from 'next/server'
import {
  getDeviceProfileForToken,
  registerDevice,
} from '@/lib/device-profile-server'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer ([a-f0-9]{64})$/)
  return match?.[1] ?? null
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore })
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('deviceToken' in body) ||
    typeof body.deviceToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.deviceToken)
  ) {
    return NextResponse.json({ error: 'Invalid device identity.' }, { status: 400, headers: noStore })
  }

  try {
    const profile = await registerDevice(body.deviceToken, 'referralCode' in body ? body.referralCode : null)
    return NextResponse.json({ profile }, { headers: noStore })
  } catch {
    return NextResponse.json(
      { error: 'Your device profile could not be loaded. Please try again.' },
      { status: 503, headers: noStore },
    )
  }
}

export async function GET(request: Request) {
  const deviceToken = bearerToken(request)
  if (!deviceToken) {
    return NextResponse.json({ error: 'Device authorization is required.' }, { status: 401, headers: noStore })
  }

  try {
    const profile = await getDeviceProfileForToken(deviceToken)
    if (!profile) {
      return NextResponse.json({ error: 'Device profile was not found.' }, { status: 404, headers: noStore })
    }
    return NextResponse.json({ profile }, { headers: noStore })
  } catch {
    return NextResponse.json(
      { error: 'Your device profile could not be loaded. Please try again.' },
      { status: 503, headers: noStore },
    )
  }
}

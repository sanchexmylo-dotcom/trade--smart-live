import { NextResponse } from 'next/server'
import {
  getDeviceProfileForToken,
  registerDevice,
  updateDeviceMemberName,
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

export async function PATCH(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore })
  }

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

  if (!body || typeof body !== 'object' || !('memberName' in body) || typeof body.memberName !== 'string') {
    return NextResponse.json({ error: 'Enter a valid member name.' }, { status: 400, headers: noStore })
  }

  const memberName = body.memberName.trim()
  if (memberName.length > 80 || /[\u0000-\u001f\u007f]/.test(memberName)) {
    return NextResponse.json({ error: 'Enter a name with no more than 80 characters.' }, { status: 400, headers: noStore })
  }

  try {
    const profile = await updateDeviceMemberName(deviceToken, memberName)
    if (!profile) {
      return NextResponse.json({ error: 'Device profile was not found.' }, { status: 404, headers: noStore })
    }
    return NextResponse.json({ profile }, { headers: noStore })
  } catch {
    return NextResponse.json(
      { error: 'Your member name could not be saved. Please try again.' },
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

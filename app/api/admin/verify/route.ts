import { NextResponse } from 'next/server'
import {
  adminPinMatches,
  clearAdminLoginFailures,
  createAdminSessionCookie,
  hasValidAdminSession,
  isAdminLoginRateLimited,
  recordAdminLoginFailure,
} from '@/lib/admin-session'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: hasValidAdminSession(request) }, { headers: noStore })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore })
  }

  if (!body || typeof body !== 'object' || !('passcode' in body) || typeof body.passcode !== 'string' || body.passcode.length > 128) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore })
  }

  if (!process.env.VIP_ADMIN_PIN || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return NextResponse.json({ error: 'Admin access is not configured.' }, { status: 503, headers: noStore })
  }

  try {
    if (await isAdminLoginRateLimited(request)) {
      return NextResponse.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, { status: 429, headers: noStore })
    }

    if (!adminPinMatches(body.passcode)) {
      const locked = await recordAdminLoginFailure(request)
      return NextResponse.json(
        { authenticated: false, error: locked ? 'Too many failed attempts. Try again in 15 minutes.' : undefined },
        { status: locked ? 429 : 401, headers: noStore },
      )
    }

    await clearAdminLoginFailures(request)
    const response = NextResponse.json({ authenticated: true }, { headers: noStore })
    response.headers.set('Set-Cookie', createAdminSessionCookie(request))
    return response
  } catch {
    return NextResponse.json({ error: 'Admin access is temporarily unavailable.' }, { status: 503, headers: noStore })
  }
}

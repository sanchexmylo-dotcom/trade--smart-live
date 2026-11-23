import { NextResponse } from 'next/server'
import { hasValidAdminSession } from '@/lib/admin-session'
import { sendVipSignalPush } from '@/lib/onesignal-server'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: 'Admin access is required.' }, { status: 401, headers: noStore })
  }
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid notification request.' }, { status: 400, headers: noStore })
  }
  if (!body || typeof body !== 'object' || !('pair' in body) || typeof body.pair !== 'string' || !('action' in body) || !['BUY', 'SELL'].includes(String(body.action)) || !('entry' in body) || typeof body.entry !== 'string' || !('sl' in body) || typeof body.sl !== 'string' || !('tp1' in body) || typeof body.tp1 !== 'string' || ('tp2' in body && typeof body.tp2 !== 'string') || ('tp3' in body && typeof body.tp3 !== 'string') || ('tp4' in body && typeof body.tp4 !== 'string')) {
    return NextResponse.json({ error: 'Invalid signal details.' }, { status: 400, headers: noStore })
  }

  const result = await sendVipSignalPush({
    pair: body.pair.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 30),
    action: body.action as 'BUY' | 'SELL',
    entry: body.entry.trim().slice(0, 50),
    sl: body.sl.trim().slice(0, 50),
    tp1: body.tp1.trim().slice(0, 50),
    ...('tp2' in body && typeof body.tp2 === 'string' && body.tp2.trim() ? { tp2: body.tp2.trim().slice(0, 50) } : {}),
    ...('tp3' in body && typeof body.tp3 === 'string' && body.tp3.trim() ? { tp3: body.tp3.trim().slice(0, 50) } : {}),
    ...('tp4' in body && typeof body.tp4 === 'string' && body.tp4.trim() ? { tp4: body.tp4.trim().slice(0, 50) } : {}),
  })
  return NextResponse.json(result, { status: result.accepted ? 200 : 502, headers: noStore })
}

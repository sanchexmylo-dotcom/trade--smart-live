import { NextResponse } from 'next/server'
import { hasValidAdminSession } from '@/lib/admin-session'
import { adminDb } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

function normalizePair(value: unknown) {
  if (typeof value !== 'string') return []
  const pair = value.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 30)
  return pair ? [pair] : []
}

export async function GET(request: Request) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: 'Admin access is required.' }, { status: 401, headers: noStore })
  }

  try {
    const [savedPairs, recentSignals] = await Promise.all([
      adminDb.collection('asset_pairs').orderBy('updatedAt', 'desc').get(),
      adminDb.collection('signals').orderBy('createdAt', 'desc').limit(100).get(),
    ])
    const pairs = Array.from(new Set([
      ...savedPairs.docs.flatMap((item) => normalizePair(item.get('pair'))),
      ...recentSignals.docs.flatMap((item) => normalizePair(item.get('pair'))),
    ]))
    return NextResponse.json({ pairs }, { headers: noStore })
  } catch (error) {
    console.error('[Admin] Asset pair lookup failed.', error instanceof Error ? error.message : 'Unknown Firestore error.')
    return NextResponse.json({ error: 'Saved asset pairs could not be loaded.' }, { status: 503, headers: noStore })
  }
}

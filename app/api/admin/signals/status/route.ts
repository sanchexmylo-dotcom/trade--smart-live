import { NextResponse } from 'next/server'
import { hasValidAdminSession } from '@/lib/admin-session'
import { adminDb, adminStorage, FieldValue } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }
const signalIdPattern = /^[A-Za-z0-9_-]{1,128}$/

function hasSameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin
}

async function readBody(request: Request) {
  try {
    return await request.json() as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export async function PATCH(request: Request) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: 'Admin access is required.' }, { status: 401, headers: noStore })
  }
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore })
  }

  const body = await readBody(request)
  const id = isRecord(body) ? body.id : null
  const status = isRecord(body) ? body.status : null
  if (typeof id !== 'string' || !signalIdPattern.test(id) || (status !== 'WIN' && status !== 'LOSS')) {
    return NextResponse.json({ error: 'A valid signal and closed status are required.' }, { status: 400, headers: noStore })
  }

  try {
    const signalRef = adminDb.collection('signals').doc(id)
    const trackRecordRef = adminDb.collection('track_record').doc(id)
    const result = await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(signalRef)
      if (!snapshot.exists) return 'not-found' as const

      const currentStatus = snapshot.get('status')
      if ((currentStatus === 'WIN' || currentStatus === 'LOSS') && currentStatus !== status) {
        return 'conflict' as const
      }
      if (currentStatus !== 'ACTIVE' && currentStatus !== 'WIN' && currentStatus !== 'LOSS') {
        return 'conflict' as const
      }

      const existingClosedAt = snapshot.get('closedAt')
      const closedAt = currentStatus === status && existingClosedAt !== undefined && existingClosedAt !== null
        ? existingClosedAt
        : FieldValue.serverTimestamp()
      transaction.set(signalRef, { status, closedAt }, { merge: true })
      transaction.set(trackRecordRef, { signalId: id, status, closedAt }, { merge: true })
      return 'updated' as const
    })

    if (result === 'not-found') return NextResponse.json({ error: 'This signal no longer exists.' }, { status: 404, headers: noStore })
    if (result === 'conflict') return NextResponse.json({ error: 'A closed signal cannot be reopened or changed.' }, { status: 409, headers: noStore })
    return NextResponse.json({ id, status }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'The signal status could not be saved. Please try again.' }, { status: 503, headers: noStore })
  }
}

export async function DELETE(request: Request) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: 'Admin access is required.' }, { status: 401, headers: noStore })
  }
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore })
  }

  const body = await readBody(request)
  const id = isRecord(body) ? body.id : null
  if (typeof id !== 'string' || !signalIdPattern.test(id)) {
    return NextResponse.json({ error: 'A valid signal identifier is required.' }, { status: 400, headers: noStore })
  }

  try {
    const signalRef = adminDb.collection('signals').doc(id)
    const trackRecordRef = adminDb.collection('track_record').doc(id)
    const result = await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(signalRef)
      if (!snapshot.exists) return { kind: 'not-found' as const }
      if (snapshot.get('status') === 'WIN' || snapshot.get('status') === 'LOSS') {
        return { kind: 'closed' as const }
      }

      const chartImagePath = snapshot.get('chartImagePath')
      transaction.delete(signalRef)
      transaction.delete(trackRecordRef)
      return {
        kind: 'deleted' as const,
        chartImagePath: typeof chartImagePath === 'string' ? chartImagePath : null,
      }
    })

    if (result.kind === 'not-found') return NextResponse.json({ error: 'This signal no longer exists.' }, { status: 404, headers: noStore })
    if (result.kind === 'closed') return NextResponse.json({ error: 'Closed signals cannot be deleted.' }, { status: 409, headers: noStore })
    if (result.chartImagePath?.startsWith(`signals/${id}/`)) {
      await adminStorage.file(result.chartImagePath).delete({ ignoreNotFound: true }).catch(() => undefined)
    }
    return NextResponse.json({ id, deleted: true }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'The signal could not be deleted. Please try again.' }, { status: 503, headers: noStore })
  }
}

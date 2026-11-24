import { NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { hasValidAdminSession } from '@/lib/admin-session'
import { adminDb, adminStorage, FieldValue } from '@/lib/firebase-admin'
import { sendVipSignalPush } from '@/lib/onesignal-server'
import { sendNativeVipSignalPush } from '@/lib/native-push-server'

export const runtime = 'nodejs'

const maxImageBytes = 4 * 1024 * 1024
const supportedImageTypes = new Map([
  ['image/png', { extension: 'png', matches: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['image/jpeg', { extension: 'jpg', matches: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ['image/webp', { extension: 'webp', matches: (bytes: Buffer) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' }],
])

function formText(form: FormData, name: string, maxLength = 100) {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export async function POST(request: Request) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: 'Admin access is required.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > maxImageBytes + 64 * 1024) {
    return NextResponse.json({ error: 'Chart images must be 4 MB or smaller.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid signal submission.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const pair = formText(form, 'pair', 30).replace(/\s+/g, ' ').toUpperCase()
  const action = formText(form, 'action', 4)
  const entry = formText(form, 'entry', 50)
  const sl = formText(form, 'sl', 50)
  const tp1 = formText(form, 'tp1', 50)
  const tp2 = formText(form, 'tp2', 50)
  const tp3 = formText(form, 'tp3', 50)
  const tp4 = formText(form, 'tp4', 50)
  const notes = formText(form, 'notes', 2000)

  if (!pair || !entry || !sl || !tp1 || !['BUY', 'SELL'].includes(action)) {
    return NextResponse.json({ error: 'Complete the pair, direction, entry, stop loss, and first take profit.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const submittedFile = form.get('chartImage')
  if (submittedFile !== null && !(submittedFile instanceof File)) {
    return NextResponse.json({ error: 'The chart image is invalid.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  if (submittedFile instanceof File && submittedFile.size === 0) {
    return NextResponse.json({ error: 'The chart image is empty.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const image = submittedFile instanceof File ? submittedFile : null
  if (image && image.size > maxImageBytes) {
    return NextResponse.json({ error: 'Chart images must be 4 MB or smaller.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } })
  }

  const signalRef = adminDb.collection('signals').doc()
  let uploadedObject: ReturnType<typeof adminStorage.file> | null = null
  let chartImagePath: string | undefined

  try {
    if (image) {
      const bytes = Buffer.from(await image.arrayBuffer())
      const imageType = supportedImageTypes.get(image.type)
      if (!imageType || !imageType.matches(bytes)) {
        return NextResponse.json({ error: 'Choose a valid PNG, JPG, or WEBP chart image.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }

      chartImagePath = `signals/${signalRef.id}/${randomUUID()}.${imageType.extension}`
      uploadedObject = adminStorage.file(chartImagePath)
      await uploadedObject.save(bytes, {
        resumable: false,
        metadata: {
          contentType: image.type,
          cacheControl: 'private, max-age=300',
          contentDisposition: 'inline',
        },
      })
    }

    const assetPairId = createHash('sha256').update(pair).digest('hex')
    const batch = adminDb.batch()
    batch.set(signalRef, {
      pair,
      action,
      entry,
      sl,
      tp1,
      ...(tp2 ? { tp2 } : {}),
      ...(tp3 ? { tp3 } : {}),
      ...(tp4 ? { tp4 } : {}),
      ...(notes ? { notes } : {}),
      ...(chartImagePath ? { chartImagePath } : {}),
      status: 'ACTIVE',
      createdAt: FieldValue.serverTimestamp(),
    })
    batch.set(adminDb.collection('asset_pairs').doc(assetPairId), {
      pair,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await batch.commit()

    const signalForPush = {
      id: signalRef.id,
      pair,
      action: action as 'BUY' | 'SELL',
      entry,
      sl,
      tp1,
      ...(tp2 ? { tp2 } : {}),
      ...(tp3 ? { tp3 } : {}),
      ...(tp4 ? { tp4 } : {}),
    }
    const [push, nativePush] = await Promise.all([
      sendVipSignalPush(signalForPush),
      sendNativeVipSignalPush(signalForPush),
    ])
    return NextResponse.json({
      id: signalRef.id,
      pushAccepted: push.accepted,
      pushRecipients: push.recipients,
      ...(push.notificationId ? { pushNotificationId: push.notificationId } : {}),
      ...(push.error ? { pushError: push.error } : {}),
      nativePush: {
        accepted: nativePush.accepted,
        recipients: nativePush.recipients,
        sent: nativePush.sent,
        failed: nativePush.failed,
        invalidTokensRemoved: nativePush.invalidTokensRemoved,
        ...(nativePush.error ? { error: nativePush.error } : {}),
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (uploadedObject) await uploadedObject.delete({ ignoreNotFound: true }).catch(() => undefined)
    console.error('[Admin] Signal creation failed.', error instanceof Error ? error.message : 'Unknown Firestore or storage error.')
    return NextResponse.json({ error: 'Could not save this signal. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}

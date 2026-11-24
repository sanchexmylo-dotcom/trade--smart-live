import { getMessaging } from 'firebase-admin/messaging'
import type { DocumentReference } from 'firebase-admin/firestore'
import { adminApp, adminDb, FieldValue } from '@/lib/firebase-admin'

type NativeVipSignal = {
  id: string
  pair: string
  action: 'BUY' | 'SELL'
  entry: string
  sl: string
  tp1: string
  tp2?: string
  tp3?: string
  tp4?: string
}

export type NativeVipSignalPushResult = {
  accepted: boolean
  recipients: number
  sent: number
  failed: number
  invalidTokensRemoved: number
  error?: string
}

const invalidRegistrationTokenCodes = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

export async function sendNativeVipSignalPush(signal: NativeVipSignal): Promise<NativeVipSignalPushResult> {
  let recipients = 0
  let sent = 0
  let failed = 0
  let invalidTokensRemoved = 0

  try {
    const vipDevices = await adminDb.collection('devices').where('vipActive', '==', true).get()
    const deviceRefsByToken = new Map<string, DocumentReference[]>()

    for (const device of vipDevices.docs) {
      const token = device.get('fcmToken')
      if (typeof token !== 'string' || !token.trim()) continue
      const normalizedToken = token.trim()
      const deviceRefs = deviceRefsByToken.get(normalizedToken) ?? []
      deviceRefs.push(device.ref)
      deviceRefsByToken.set(normalizedToken, deviceRefs)
    }

    const targets = Array.from(deviceRefsByToken, ([token, deviceRefs]) => ({ token, deviceRefs }))
    recipients = targets.length
    if (recipients === 0) {
      return { accepted: true, recipients, sent, failed, invalidTokensRemoved }
    }

    const takeProfits = [
      { label: 'TP1', value: signal.tp1 },
      { label: 'TP2', value: signal.tp2 },
      { label: 'TP3', value: signal.tp3 },
      { label: 'TP4', value: signal.tp4 },
    ].filter((target): target is { label: string; value: string } => Boolean(target.value?.trim()))
    const body = [
      `${signal.pair} ${signal.action}`,
      `Entry: ${signal.entry} | SL: ${signal.sl}`,
      takeProfits.map((target) => `${target.label}: ${target.value}`).join(' | '),
    ].join('\n')
    const messaging = getMessaging(adminApp)

    for (let offset = 0; offset < targets.length; offset += 500) {
      const batch = targets.slice(offset, offset + 500)
      const result = await messaging.sendEachForMulticast({
        tokens: batch.map((target) => target.token),
        notification: {
          title: 'New VIP Signal',
          body,
        },
        data: {
          type: 'vip_signal',
          signalId: signal.id,
          pair: signal.pair,
          direction: signal.action,
        },
        android: {
          priority: 'high',
          ttl: 86_400_000,
          notification: {
            channelId: 'vip-signals',
            priority: 'high',
            sound: 'default',
            tag: `signal-${signal.id}`,
          },
        },
      })

      sent += result.successCount
      failed += result.failureCount

      const invalidTokenUpdates = result.responses.flatMap((response, index) => {
        const errorCode = response.error?.code
        if (response.success || !errorCode || !invalidRegistrationTokenCodes.has(errorCode)) return []
        return batch[index].deviceRefs.map(async (deviceRef) => {
          try {
            await deviceRef.update({
              fcmToken: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
            })
            return true
          } catch {
            return false
          }
        })
      })
      const removed = await Promise.all(invalidTokenUpdates)
      invalidTokensRemoved += removed.filter(Boolean).length
    }

    return { accepted: sent > 0, recipients, sent, failed, invalidTokensRemoved }
  } catch (error) {
    console.error('[Firebase Messaging] Native VIP signal delivery failed.', error instanceof Error ? error.message : 'Unknown Firebase error.')
    return {
      accepted: sent > 0,
      recipients,
      sent,
      failed: Math.max(failed, recipients - sent),
      invalidTokensRemoved,
      error: 'Native Android push delivery could not be completed.',
    }
  }
}

import type { OneSignalVipTagStatus } from '@/lib/device-profile-types'

const oneSignalAppId = process.env.ONESIGNAL_APP_ID || '7a6d4de7-44d2-4a15-9e28-b1130c08c153'

function oneSignalUserUrl(deviceId: string) {
  return `https://api.onesignal.com/apps/${oneSignalAppId}/users/by/external_id/${encodeURIComponent(deviceId)}`
}

function pushSubscriptionStatus(subscriptions: unknown): OneSignalVipTagStatus['pushSubscription'] {
  if (!Array.isArray(subscriptions)) return 'unknown'
  const pushSubscriptions = subscriptions.filter((subscription: unknown): subscription is { type: string; enabled?: boolean } =>
    typeof subscription === 'object' && subscription !== null &&
    'type' in subscription && typeof subscription.type === 'string' && subscription.type.endsWith('Push'),
  )
  return pushSubscriptions.some((subscription) => subscription.enabled === true) ? 'subscribed' : 'not_subscribed'
}

function oneSignalIssueMessage(status: number) {
  if (status === 401 || status === 403) return 'OneSignal rejected the REST API key or its permissions.'
  if (status === 404) return 'No OneSignal user is linked to this device ID.'
  if (status === 429) return 'OneSignal rate-limited the VIP tag check. Try again shortly.'
  return `OneSignal VIP tag verification failed (HTTP ${status}).`
}

async function readOneSignalResponse(response: Response) {
  const text = await response.text()
  try {
    return { text, data: JSON.parse(text) as Record<string, unknown> }
  } catch {
    return { text, data: {} as Record<string, unknown> }
  }
}

function logOneSignalApiIssue(action: string, deviceId: string, status: number, details: string) {
  console.error(`[OneSignal] VIP tag ${action} failed.`, {
    deviceId,
    status,
    details: details.slice(0, 500),
  })
}

export async function getOneSignalVipTagStatus(deviceId: string): Promise<OneSignalVipTagStatus> {
  const restApiKey = process.env.ONESIGNAL_REST_API_KEY
  if (!restApiKey) {
    console.error('[OneSignal] VIP tag verification is unavailable because ONESIGNAL_REST_API_KEY is missing.', { deviceId })
    return {
      state: 'unavailable',
      pushSubscription: 'unknown',
      message: 'OneSignal REST API key is not available to verify this device.',
    }
  }

  try {
    const response = await fetch(oneSignalUserUrl(deviceId), {
      headers: { Authorization: `Key ${restApiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    const { text, data } = await readOneSignalResponse(response)
    if (response.status === 404) {
      console.warn('[OneSignal] VIP tag check found no user for the device external ID.', { deviceId })
      return {
        state: 'not_found',
        pushSubscription: 'unknown',
        message: 'No OneSignal user is linked to this device ID. Open the app on the device and enable push alerts to link it.',
      }
    }
    if (!response.ok) {
      const details = text.replaceAll(restApiKey, '[redacted]')
      logOneSignalApiIssue('verification', deviceId, response.status, details)
      return {
        state: 'error',
        pushSubscription: 'unknown',
        message: oneSignalIssueMessage(response.status),
      }
    }

    const properties = data.properties && typeof data.properties === 'object'
      ? data.properties as Record<string, unknown>
      : {}
    const tags = properties.tags && typeof properties.tags === 'object'
      ? properties.tags as Record<string, unknown>
      : {}
    const hasVipTag = tags.vip === 'true'

    return {
      state: hasVipTag ? 'confirmed_active' : 'confirmed_inactive',
      pushSubscription: pushSubscriptionStatus(data.subscriptions),
      message: hasVipTag
        ? 'OneSignal confirms the vip=true tag on this device.'
        : 'OneSignal does not currently report vip=true for this device.',
    }
  } catch (error) {
    const details = error instanceof Error
      ? error.message.replaceAll(restApiKey, '[redacted]').slice(0, 500)
      : 'Unknown network error.'
    console.error('[OneSignal] VIP tag verification request could not be completed.', { deviceId, details })
    return {
      state: 'error',
      pushSubscription: 'unknown',
      message: 'OneSignal VIP tag verification could not be completed. Check the server connection and try again.',
    }
  }
}

export async function syncOneSignalVipTag(deviceId: string, active: boolean): Promise<OneSignalVipTagStatus> {
  const restApiKey = process.env.ONESIGNAL_REST_API_KEY
  if (!restApiKey) {
    console.error('[OneSignal] VIP tag sync could not run because ONESIGNAL_REST_API_KEY is missing.', { deviceId, active })
    return {
      state: 'unavailable',
      pushSubscription: 'unknown',
      message: 'OneSignal REST API key is not available to sync this device.',
    }
  }

  try {
    const response = await fetch(oneSignalUserUrl(deviceId), {
      method: 'PATCH',
      headers: {
        Authorization: `Key ${restApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: { tags: { vip: active ? 'true' : '' } } }),
      signal: AbortSignal.timeout(10000),
    })
    const { text } = await readOneSignalResponse(response)
    if (response.status === 404) {
      console.warn('[OneSignal] VIP tag sync could not find a OneSignal user for the device external ID.', { deviceId, active })
      return {
        state: 'not_found',
        pushSubscription: 'unknown',
        message: 'No OneSignal user is linked to this device ID. Open the app on the device and enable push alerts, then sync again.',
      }
    }
    if (!response.ok) {
      const details = text.replaceAll(restApiKey, '[redacted]')
      logOneSignalApiIssue('sync', deviceId, response.status, details)
      return {
        state: 'error',
        pushSubscription: 'unknown',
        message: oneSignalIssueMessage(response.status),
      }
    }

    const expectedState = active ? 'confirmed_active' : 'confirmed_inactive'
    let latestStatus: OneSignalVipTagStatus = {
      state: 'pending',
      pushSubscription: 'unknown',
      message: `OneSignal accepted the VIP tag update; verifying vip=${active ? 'true' : 'inactive'}.`,
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      latestStatus = await getOneSignalVipTagStatus(deviceId)
      if (latestStatus.state === expectedState) {
        console.info('[OneSignal] VIP tag sync confirmed.', { deviceId, vipTag: active ? 'true' : 'inactive' })
        return latestStatus
      }
      if (latestStatus.state !== 'confirmed_active' && latestStatus.state !== 'confirmed_inactive') return latestStatus
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300))
    }

    const pendingStatus: OneSignalVipTagStatus = {
      ...latestStatus,
      state: 'pending',
      message: `OneSignal accepted the VIP tag update, but a follow-up read has not confirmed vip=${active ? 'true' : 'inactive'} yet.`,
    }
    console.warn('[OneSignal] VIP tag update was accepted but the requested value is not confirmed yet.', {
      deviceId,
      expectedVipTag: active ? 'true' : 'inactive',
      actualState: latestStatus.state,
    })
    return pendingStatus
  } catch (error) {
    const details = error instanceof Error
      ? error.message.replaceAll(restApiKey, '[redacted]').slice(0, 500)
      : 'Unknown network error.'
    console.error('[OneSignal] VIP tag sync request could not be completed.', { deviceId, active, details })
    return {
      state: 'error',
      pushSubscription: 'unknown',
      message: 'OneSignal VIP tag sync could not be completed. Check the server connection and try again.',
    }
  }
}

type VipSignalNotification = {
  pair: string
  action: 'BUY' | 'SELL'
  entry: string
  sl: string
  tp1: string
  tp2?: string
  tp3?: string
  tp4?: string
}

type OneSignalResponse = {
  id?: unknown
  recipients?: unknown
}

export type VipSignalPushResult = {
  accepted: boolean
  recipients: number | null
  notificationId?: string
  error?: string
}

export async function sendVipSignalPush(signal: VipSignalNotification): Promise<VipSignalPushResult> {
  const restApiKey = process.env.ONESIGNAL_REST_API_KEY

  if (!restApiKey) {
    console.error('[OneSignal] Push not sent: ONESIGNAL_REST_API_KEY is missing from the server environment.')
    return { accepted: false, recipients: null, error: 'OneSignal server API key is not configured.' }
  }

  try {
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        Authorization: `Key ${restApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: oneSignalAppId,
        target_channel: 'push',
        filters: [{ field: 'tag', key: 'vip', relation: '=', value: 'true' }],
        headings: { en: 'New VIP Signal' },
        contents: {
          en: [
            `${signal.pair} ${signal.action}`,
            `Entry: ${signal.entry} | SL: ${signal.sl}`,
            [
              { label: 'TP1', value: signal.tp1 },
              { label: 'TP2', value: signal.tp2 },
              { label: 'TP3', value: signal.tp3 },
              { label: 'TP4', value: signal.tp4 },
            ]
              .filter((target): target is { label: string; value: string } => typeof target.value === 'string' && target.value.trim().length > 0)
              .map((target) => `${target.label}: ${target.value}`)
              .join(' | '),
          ].join('\n'),
        },
        priority: 10,
        ttl: 86400,
        isAnyWeb: true,
        data: { type: 'vip_signal', pair: signal.pair },
      }),
      signal: AbortSignal.timeout(10000),
    })

    const responseText = await response.text()
    let result: OneSignalResponse = {}
    try {
      result = JSON.parse(responseText) as OneSignalResponse
    } catch {
      result = {}
    }

    const notificationId = typeof result.id === 'string' && result.id.trim().length > 0 ? result.id.trim() : undefined
    const recipients = typeof result.recipients === 'number' && Number.isInteger(result.recipients) ? result.recipients : null
    const accepted = response.ok && notificationId !== undefined

    if (!accepted) {
      const details = responseText.replaceAll(restApiKey, '[redacted]').slice(0, 1000)
      const error = response.ok
        ? 'OneSignal did not return a notification ID. Check that subscribed VIP devices match the audience.'
        : `OneSignal rejected the notification (HTTP ${response.status}).`
      console.error('[OneSignal] Push notification was not accepted for the vip=true tag filter.', {
        status: response.status,
        details,
        recipients,
        tagFilter: 'vip=true',
      })
      return { accepted: false, recipients, error }
    }

    console.info('[OneSignal] Signal push sent to VIP subscribers.', {
      status: response.status,
      notificationId,
      tagFilter: 'vip=true',
    })
    return { accepted: true, recipients, notificationId }
  } catch (error) {
    const details = error instanceof Error ? error.message.replaceAll(restApiKey, '[redacted]').slice(0, 500) : 'Unknown network error.'
    console.error('[OneSignal] Push request for the vip=true tag filter could not be completed.', {
      details,
      tagFilter: 'vip=true',
    })
    return { accepted: false, recipients: null, error: 'OneSignal push delivery could not be completed.' }
  }
}

const oneSignalAppId = '7a6d4de7-44d2-4a15-9e28-b1130c08c153'

type VipSignalNotification = {
  pair: string
  action: 'BUY' | 'SELL'
  entry: string
  sl: string
  tp1: string
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
        contents: { en: `${signal.pair} ${signal.action} · Entry ${signal.entry} · TP1 ${signal.tp1} · SL ${signal.sl}` },
        priority: 10,
        ttl: 86400,
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

    const notificationId = typeof result.id === 'string' && result.id.length > 0 ? result.id : undefined
    const recipients = typeof result.recipients === 'number' && Number.isInteger(result.recipients) ? result.recipients : null
    const accepted = response.ok && notificationId !== undefined

    if (!accepted) {
      const details = responseText.replaceAll(restApiKey, '[redacted]').slice(0, 1000)
      const error = response.ok
        ? 'OneSignal did not return a notification ID. Check that subscribed VIP devices match the audience.'
        : `OneSignal rejected the notification (HTTP ${response.status}).`
      console.error('[OneSignal] Push notification was not accepted.', { status: response.status, details, recipients })
      return { accepted: false, recipients, error }
    }

    console.info('[OneSignal] VIP signal push accepted.', { status: response.status, notificationId, recipients })
    return { accepted: true, recipients, notificationId }
  } catch (error) {
    const details = error instanceof Error ? error.message.replaceAll(restApiKey, '[redacted]').slice(0, 500) : 'Unknown network error.'
    console.error('[OneSignal] Push request could not be completed.', { details })
    return { accepted: false, recipients: null, error: 'OneSignal push delivery could not be completed.' }
  }
}

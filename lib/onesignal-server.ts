const fallbackAppId = '7a6d4de7-44d2-4a15-9e28-b1130c08c153'

type VipSignalNotification = {
  pair: string
  action: 'BUY' | 'SELL'
  entry: string
  sl: string
  tp1: string
}

export async function sendVipSignalPush(signal: VipSignalNotification) {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || process.env.ONESIGNAL_APP_ID || fallbackAppId
  const restApiKey = process.env.ONESIGNAL_REST_API_KEY

  if (!restApiKey) {
    console.error('[OneSignal] Push not sent: ONESIGNAL_REST_API_KEY is missing from the server environment.')
    return { sent: false, error: 'OneSignal is not configured.' }
  }

  try {
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        Authorization: `Key ${restApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: appId,
        target_channel: 'push',
        filters: [{ field: 'tag', key: 'vip', relation: '=', value: 'true' }],
        headings: { en: 'New VIP Signal' },
        contents: { en: `${signal.pair} ${signal.action} · Entry ${signal.entry} · TP1 ${signal.tp1} · SL ${signal.sl}` },
        priority: 10,
        ttl: 86400,
        data: { type: 'vip_signal', pair: signal.pair },
      }),
    })

    const responseText = await response.text()
    if (!response.ok) {
      const details = responseText.replaceAll(restApiKey, '[redacted]').slice(0, 1000)
      console.error('[OneSignal] Push request rejected.', { status: response.status, details })
      return { sent: false, error: 'OneSignal rejected the push notification.' }
    }

    let notificationId: string | undefined
    let recipients: number | undefined
    try {
      const result = JSON.parse(responseText) as { id?: unknown; recipients?: unknown }
      notificationId = typeof result.id === 'string' ? result.id : undefined
      recipients = typeof result.recipients === 'number' ? result.recipients : undefined
    } catch {
      notificationId = undefined
      recipients = undefined
    }
    if (recipients === 0) {
      console.error('[OneSignal] Push accepted, but no subscribed VIP recipients matched.', { status: response.status, notificationId, recipients })
      return { sent: false, error: 'No subscribed VIP devices matched the push audience.' }
    }
    console.info('[OneSignal] VIP signal push accepted.', { status: response.status, notificationId, recipients })
    return { sent: true }
  } catch (error) {
    const details = error instanceof Error ? error.message.replaceAll(restApiKey, '[redacted]').slice(0, 500) : 'Unknown network error.'
    console.error('[OneSignal] Push request could not be completed.', { details })
    return { sent: false, error: 'OneSignal push delivery could not be completed.' }
  }
}

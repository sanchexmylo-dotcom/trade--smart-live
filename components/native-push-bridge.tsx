'use client'

import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { PushNotifications, type PushNotificationSchema } from '@capacitor/push-notifications'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

type NativePushBridgeProps = {
  deviceToken: string | null
  enabled: boolean
  onOpenSignal: (signalId: string | null) => void
}

function getSignalId(data: Record<string, unknown> | undefined) {
  const signalId = data?.signalId
  return typeof signalId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(signalId)
    ? signalId
    : null
}

function saveFcmToken(deviceToken: string, fcmToken: string) {
  return fetch('/api/device', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({ fcmToken }),
  })
}

export default function NativePushBridge({ deviceToken, enabled, onOpenSignal }: NativePushBridgeProps) {
  const onOpenSignalRef = useRef(onOpenSignal)

  useEffect(() => {
    onOpenSignalRef.current = onOpenSignal
  }, [onOpenSignal])

  useEffect(() => {
    if (
      !deviceToken ||
      !enabled ||
      !Capacitor.isNativePlatform() ||
      Capacitor.getPlatform() !== 'android'
    ) return

    let disposed = false
    let mostRecentSignalId: string | null = null
    const listeners: Promise<PluginListenerHandle>[] = [
      PushNotifications.addListener('registration', async ({ value }) => {
        if (disposed) return
        try {
          const response = await saveFcmToken(deviceToken, value)
          if (!response.ok) {
            console.error('[Native Push] FCM token could not be saved.', { status: response.status })
          }
        } catch {
          console.error('[Native Push] FCM token could not be saved.')
        }
      }),
      PushNotifications.addListener('registrationError', (error) => {
        if (!disposed) console.error('[Native Push] Registration failed.', error.error)
      }),
      PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
        if (disposed) return
        const signalId = getSignalId(notification.data)
        if (signalId) mostRecentSignalId = signalId
        toast.info(notification.title || 'New VIP signal', {
          description: notification.body || 'A new VIP trading setup is available.',
          ...(signalId ? {
            action: {
              label: 'View signal',
              onClick: () => onOpenSignalRef.current(signalId),
            },
          } : {}),
        })
      }),
      PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        if (disposed) return
        onOpenSignalRef.current(getSignalId(notification.data) ?? mostRecentSignalId)
      }),
    ]

    const removeListeners = () => {
      void Promise.all(listeners)
        .then((handles) => Promise.all(handles.map((handle) => handle.remove())))
        .catch(() => undefined)
    }

    void (async () => {
      try {
        await PushNotifications.createChannel({
          id: 'vip-signals',
          name: 'VIP Signal Alerts',
          description: 'High-priority trading signal notifications.',
          importance: 5,
          visibility: 1,
          sound: 'default',
          vibration: true,
          lights: true,
        }).catch(() => undefined)

        const permission = await PushNotifications.requestPermissions()
        if (disposed || permission.receive !== 'granted') return
        await PushNotifications.register()
      } catch (error) {
        if (!disposed) {
          console.error('[Native Push] Setup failed.', error instanceof Error ? error.message : 'Unknown plugin error.')
        }
      }
    })()

    return () => {
      disposed = true
      removeListeners()
    }
  }, [deviceToken, enabled])

  return null
}

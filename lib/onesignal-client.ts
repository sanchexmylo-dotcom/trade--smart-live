export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type OneSignalClient = {
  init: (options: Record<string, unknown>) => Promise<void>
  login: (externalId: string) => Promise<void> | void
  Notifications: {
    permission: boolean
    isPushSupported: () => boolean
    requestPermission: () => Promise<void>
    addEventListener: (eventName: string, listener: (...args: unknown[]) => void) => void
    removeEventListener: (eventName: string, listener: (...args: unknown[]) => void) => void
  }
  User: {
    addTag: (key: string, value: string) => Promise<void> | void
    removeTag: (key: string) => Promise<void> | void
    PushSubscription: {
      optedIn: boolean
      optIn: () => Promise<void> | void
      addEventListener?: (eventName: string, listener: (...args: unknown[]) => void) => void
      removeEventListener?: (eventName: string, listener: (...args: unknown[]) => void) => void
    }
  }
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: OneSignalClient) => void>
    tradeSmartOneSignal?: OneSignalClient
    tradeSmartOneSignalInitQueued?: boolean
    tradeSmartOneSignalInitError?: boolean
    tradeSmartInstallPrompt?: InstallPromptEvent | null
    tradeSmartAppInstalled?: boolean
  }
}

export function getOneSignalClient() {
  return typeof window === 'undefined' ? null : window.tradeSmartOneSignal ?? null
}

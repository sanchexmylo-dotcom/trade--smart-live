export type DeviceProfile = {
  deviceId: string
  referralCode: string
  vipActive: boolean
  planExpiresAt: string | null
  createdAt: string | null
  invitedFriends: number
  activeVipReferrals: number
  rewardDaysEarned: number
  rewardDaysAvailable: number
}

export type OneSignalVipTagStatus = {
  state: 'confirmed_active' | 'confirmed_inactive' | 'pending' | 'not_found' | 'unavailable' | 'error'
  pushSubscription: 'subscribed' | 'not_subscribed' | 'unknown'
  message: string
}

export type AdminDeviceRecord = DeviceProfile & {
  referredByDeviceId: string | null
  referredByCode: string | null
}

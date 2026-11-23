export type DeviceProfile = {
  deviceId: string
  memberName: string
  displayName: string
  referralCode: string
  vipActive: boolean
  planDurationDays: number
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

export type AdminDeviceDirectoryEntry = Pick<
  DeviceProfile,
  'deviceId' | 'memberName' | 'displayName' | 'vipActive' | 'planDurationDays' | 'planExpiresAt' | 'createdAt'
>

export type AdminDeviceRecord = DeviceProfile & {
  referredByDeviceId: string | null
  referredByCode: string | null
}

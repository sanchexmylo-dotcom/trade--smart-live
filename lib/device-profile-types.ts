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

export type AdminDeviceRecord = DeviceProfile & {
  referredByDeviceId: string | null
  referredByCode: string | null
}

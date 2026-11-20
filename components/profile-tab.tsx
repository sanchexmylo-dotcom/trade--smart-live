'use client'

import { useState } from 'react'
import { Check, Copy, Crown, Gift, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { DeviceProfile } from '@/lib/device-profile-types'

const appUrl = 'https://trade-smart-live.vercel.app'

type ProfileTabProps = {
  profile: DeviceProfile | undefined
  isLoading: boolean
  error?: string
  onRetry: () => void
  onUpgrade: () => void
}

function formatDate(value: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not set'
    : date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ProfileTab({ profile, isLoading, error, onRetry, onUpgrade }: ProfileTabProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState('')
  const referralLink = profile
    ? `${appUrl}/?ref=${encodeURIComponent(profile.referralCode)}`
    : ''

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setCopyError('')
      window.setTimeout(() => setCopied(null), 1800)
    } catch {
      setCopyError('Clipboard access is unavailable. Select and copy the value instead.')
    }
  }

  return <div className="flex flex-col gap-4">
    <Card className="border-slate-800/80 bg-slate-900/70 text-slate-100">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardDescription className="text-slate-400">ACCOUNT</CardDescription>
          <CardTitle className="mt-1 text-xl text-white">Your membership</CardTitle>
        </div>
        {profile && <Badge variant={profile.vipActive ? 'secondary' : 'outline'} className={profile.vipActive ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-slate-700 text-slate-300'}>
          {profile.vipActive ? 'VIP active' : 'Free plan'}
        </Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading && !profile && <p role="status" className="text-sm text-slate-300">Creating your persistent device profile…</p>}
        {error && <div role="alert" className="flex flex-col gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          <p>{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry} className="w-fit border-amber-300/30 text-amber-100">Retry profile sync</Button>
        </div>}
        {profile && <>
          <p className="text-sm leading-relaxed text-slate-300">
            {profile.vipActive
              ? `VIP access is active through ${formatDate(profile.planExpiresAt)}.`
              : 'Your account is on the Free plan. VIP access is enabled after verified payment.'}
          </p>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="device-id" className="text-slate-200">Persistent device ID</FieldLabel>
              <div className="flex gap-2">
                <Input id="device-id" readOnly value={profile.deviceId} className="border-slate-700 bg-slate-950 font-mono text-sm text-white" />
                <Button type="button" variant="outline" size="icon" onClick={() => void copyValue('device', profile.deviceId)} aria-label="Copy device ID" className="shrink-0 border-slate-700">
                  {copied === 'device' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                </Button>
              </div>
              <FieldDescription className="text-slate-400">Saved on this browser and registered securely to your device profile.</FieldDescription>
            </Field>
          </FieldGroup>
          {!profile.vipActive && <Button type="button" onClick={onUpgrade} className="min-h-11 bg-cyan-300 font-semibold text-slate-950 hover:bg-cyan-200">View VIP membership</Button>}
        </>}
      </CardContent>
    </Card>

    <Card className="border-slate-800/80 bg-slate-900/70 text-slate-100">
      <CardHeader>
        <div className="flex items-center gap-2 text-cyan-200"><Gift aria-hidden="true" /><CardDescription className="text-cyan-200">INVITE &amp; EARN</CardDescription></div>
        <CardTitle className="text-xl text-white">Share your referral link</CardTitle>
        <CardDescription className="leading-relaxed text-slate-400">Earn 7 VIP days when a referred friend completes their first successful paid subscription.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {profile ? <>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="referral-code" className="text-slate-200">Your referral code</FieldLabel>
              <div className="flex gap-2">
                <Input id="referral-code" readOnly value={profile.referralCode} className="border-slate-700 bg-slate-950 font-mono text-sm uppercase text-white" />
                <Button type="button" variant="outline" size="icon" onClick={() => void copyValue('code', profile.referralCode)} aria-label="Copy referral code" className="shrink-0 border-slate-700">
                  {copied === 'code' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                </Button>
              </div>
            </Field>
            <div className="flex flex-col gap-2">
              <p id="referral-link-label" className="text-sm font-medium text-slate-200">Invite link</p>
              <div className="flex min-w-0 items-stretch gap-2">
                <a id="referral-link" href={referralLink} aria-labelledby="referral-link-label" className="min-w-0 flex-1 break-all rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs leading-relaxed text-cyan-200 underline underline-offset-2">
                  {referralLink}
                </a>
                <Button type="button" variant="outline" size="icon" onClick={() => void copyValue('link', referralLink)} aria-label="Copy referral link" className="shrink-0 border-slate-700">
                  {copied === 'link' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                </Button>
              </div>
            </div>
          </FieldGroup>
          {copyError && <p role="alert" className="text-sm text-amber-200">{copyError}</p>}
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={<Users aria-hidden="true" />} label="Invited friends" value={profile.invitedFriends} />
            <Stat icon={<Crown aria-hidden="true" />} label="Active VIP referrals" value={profile.activeVipReferrals} />
            <Stat icon={<Gift aria-hidden="true" />} label="Days available" value={profile.rewardDaysAvailable} />
          </div>
          <p className="text-xs leading-relaxed text-slate-400">Total VIP reward days earned: {profile.rewardDaysEarned}. Reward days are credited after Monnify confirms payment.</p>
        </> : <p role="status" className="text-sm text-slate-300">Referral counts and reward balance will appear when your device profile syncs.</p>}
      </CardContent>
    </Card>
    <p aria-live="polite" className="sr-only">{copied ? `${copied === 'device' ? 'Device ID' : copied === 'code' ? 'Referral code' : 'Invite link'} copied.` : ''}</p>
  </div>
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
    <span className="text-cyan-200">{icon}</span>
    <span className="text-xl font-semibold text-white">{value.toLocaleString('en-NG')}</span>
    <span className="text-xs leading-snug text-slate-400">{label}</span>
  </div>
}

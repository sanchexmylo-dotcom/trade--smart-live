'use client'

import { FormEvent, useState } from 'react'
import useSWR from 'swr'
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
import type { AdminDeviceRecord } from '@/lib/device-profile-types'

const deviceIdPattern = /^TSL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/i

type DeviceResponse = { device: AdminDeviceRecord }
type ErrorResponse = { error?: string }

async function fetchDevice(url: string): Promise<DeviceResponse> {
  const response = await fetch(url, { cache: 'no-store' })
  const result = await response.json() as DeviceResponse & ErrorResponse
  if (!response.ok) throw new Error(result.error || 'Device lookup failed.')
  return result
}

function formatDate(value: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not set'
    : date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function VipDeviceManager() {
  const [deviceIdInput, setDeviceIdInput] = useState('')
  const [lookupId, setLookupId] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [actionError, setActionError] = useState('')
  const [extensionDays, setExtensionDays] = useState('30')
  const [isSaving, setIsSaving] = useState(false)
  const { data, error: requestError, isLoading, mutate } = useSWR<DeviceResponse>(
    lookupId ? `/api/admin/devices?deviceId=${encodeURIComponent(lookupId)}` : null,
    fetchDevice,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedId = deviceIdInput.trim().toUpperCase()
    if (!deviceIdPattern.test(normalizedId)) {
      setLookupError('Enter a complete device ID, such as TSL-ABCD-EFGH.')
      return
    }
    setLookupError('')
    setActionError('')
    setLookupId(normalizedId)
  }

  async function updateDevice(change: { action: 'set'; active: boolean } | { action: 'extend'; days: number }) {
    if (!data?.device) return
    setIsSaving(true)
    setActionError('')

    try {
      const response = await fetch('/api/admin/devices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: data.device.deviceId, ...change }),
      })
      const result = await response.json() as DeviceResponse & ErrorResponse
      if (!response.ok) throw new Error(result.error || 'VIP access could not be updated.')
      await mutate(result, { revalidate: false })
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'VIP access could not be updated.')
    } finally {
      setIsSaving(false)
    }
  }

  const device = data?.device
  const requestErrorMessage = requestError instanceof Error ? requestError.message : ''

  return <Card className="mb-8 border-zinc-800/80 bg-zinc-900/60 text-zinc-100">
    <CardHeader>
      <CardDescription className="text-slate-300">VIP MEMBERSHIP ADMIN</CardDescription>
      <CardTitle className="text-xl text-white">Find a device &amp; manage access</CardTitle>
      <CardDescription className="max-w-2xl leading-relaxed text-zinc-400">Look up a TSL device ID, check its Firestore membership record, then activate, deactivate, or extend VIP access.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-5">
      <form onSubmit={lookup} noValidate>
        <FieldGroup className="gap-3 sm:flex-row sm:items-end">
          <Field className="flex-1">
            <FieldLabel htmlFor="admin-device-id" className="text-zinc-200">Device ID</FieldLabel>
            <Input id="admin-device-id" value={deviceIdInput} onChange={(event) => setDeviceIdInput(event.target.value)} placeholder="TSL-ABCD-EFGH" autoComplete="off" spellCheck={false} aria-invalid={Boolean(lookupError)} className="h-10 border-zinc-700 bg-zinc-950 font-mono uppercase text-zinc-100" />
            <FieldDescription className="text-zinc-500">Paste the complete ID shown in the member&apos;s Profile tab.</FieldDescription>
          </Field>
          <Button type="submit" variant="outline" className="h-10 border-zinc-700 text-zinc-100">Search device</Button>
        </FieldGroup>
      </form>
      {lookupError && <p role="alert" className="text-sm text-rose-300">{lookupError}</p>}
      {isLoading && <p role="status" className="text-sm text-zinc-300">Searching Firestore…</p>}
      {requestErrorMessage && lookupId && <p role="alert" className="text-sm text-rose-300">{requestErrorMessage}</p>}
      {device && <section aria-label={`Membership record for ${device.deviceId}`} className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-sm font-semibold text-white">{device.deviceId}</p>
            <p className="mt-1 text-xs text-zinc-400">Created {formatDate(device.createdAt)}</p>
          </div>
          <Badge variant={device.vipActive ? 'secondary' : 'outline'} className={device.vipActive ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-zinc-700 text-zinc-300'}>
            {device.vipActive ? 'VIP active' : 'VIP inactive'}
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <RecordValue label="Plan expiry" value={formatDate(device.planExpiresAt)} />
          <RecordValue label="Referral code" value={device.referralCode} />
          <RecordValue label="Invited friends" value={device.invitedFriends.toLocaleString('en-NG')} />
          <RecordValue label="Reward days" value={`${device.rewardDaysAvailable} available`} />
          <RecordValue label="Referred by" value={device.referredByDeviceId ?? 'None'} />
          <RecordValue label="Active VIP referrals" value={device.activeVipReferrals.toLocaleString('en-NG')} />
          <RecordValue label="Reward days earned" value={device.rewardDaysEarned.toLocaleString('en-NG')} />
        </dl>
        <div className="grid gap-4 border-t border-zinc-800 pt-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="vip-extension-days" className="text-zinc-200">Extend subscription</FieldLabel>
            <Input id="vip-extension-days" type="number" min={1} max={365} step={1} value={extensionDays} onChange={(event) => setExtensionDays(event.target.value)} className="h-10 border-zinc-700 bg-zinc-950 text-zinc-100" />
            <FieldDescription className="text-zinc-500">Choose 1–365 days.</FieldDescription>
          </Field>
          <Button type="button" variant="outline" disabled={isSaving || !Number.isInteger(Number(extensionDays)) || Number(extensionDays) < 1 || Number(extensionDays) > 365} onClick={() => void updateDevice({ action: 'extend', days: Number(extensionDays) })} className="h-10 border-cyan-400/30 text-cyan-100">
            {isSaving ? 'Saving…' : `Add ${extensionDays || '0'} days`}
          </Button>
          <Button type="button" variant={device.vipActive ? 'destructive' : 'default'} disabled={isSaving} onClick={() => void updateDevice({ action: 'set', active: !device.vipActive })} className={!device.vipActive ? 'h-10 bg-emerald-300 text-zinc-950 hover:bg-emerald-200' : 'h-10'}>
            {device.vipActive ? 'Turn VIP off' : 'Activate VIP'}
          </Button>
        </div>
        {actionError && <p role="alert" className="text-sm text-rose-300">{actionError}</p>}
      </section>}
    </CardContent>
  </Card>
}

function RecordValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
    <dt className="text-xs text-zinc-500">{label}</dt>
    <dd className="mt-1 break-words font-mono text-xs text-zinc-200">{value}</dd>
  </div>
}

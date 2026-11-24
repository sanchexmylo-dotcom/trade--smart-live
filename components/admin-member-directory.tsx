'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Check, ChevronDown, Copy, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { AdminDeviceDirectoryEntry } from '@/lib/device-profile-types'

type DirectoryFilter = 'all' | 'active' | 'expired'
type DirectoryResponse = { devices: AdminDeviceDirectoryEntry[]; error?: string }
type Props = { onManage: (deviceId: string) => void }

async function fetchDirectory(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  const result = await response.json() as DirectoryResponse
  if (!response.ok) throw new Error(result.error || 'Member directory could not be loaded.')
  return result.devices
}

function getStatus(device: AdminDeviceDirectoryEntry) {
  const expiry = device.planExpiresAt ? new Date(device.planExpiresAt).getTime() : null
  if (expiry !== null && expiry <= Date.now()) return 'Expired' as const
  if (!device.vipActive) return 'Standard' as const
  if (expiry !== null && expiry - Date.now() <= 7 * 24 * 60 * 60 * 1000) return 'Expiring Soon' as const
  return 'Active' as const
}

function isActiveVip(device: AdminDeviceDirectoryEntry) {
  return device.vipActive && getStatus(device) !== 'Expired'
}

function formatDateTime(value: string | null) {
  if (!value) return 'No VIP expiry'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'No VIP expiry'
    : date.toLocaleString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
}

function statusClasses(status: ReturnType<typeof getStatus>) {
  if (status === 'Active') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  if (status === 'Expiring Soon') return 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  if (status === 'Expired') return 'border-rose-400/30 bg-rose-400/10 text-rose-200'
  return 'border-slate-700 bg-slate-800/60 text-slate-300'
}

export default function AdminMemberDirectory({ onManage }: Props) {
  const { data: devices = [], error, isLoading } = useSWR(
    '/api/admin/devices?directory=1',
    fetchDirectory,
    { revalidateOnFocus: true, refreshInterval: 60_000, shouldRetryOnError: false },
  )
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DirectoryFilter>('all')
  const [copiedId, setCopiedId] = useState('')
  const [copyError, setCopyError] = useState('')
  const activeCount = devices.filter(isActiveVip).length
  const expiredCount = devices.filter((device) => getStatus(device) === 'Expired').length
  const counts: Record<DirectoryFilter, number> = {
    all: devices.length,
    active: activeCount,
    expired: expiredCount,
  }
  const visibleDevices = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return devices.filter((device) => {
      const status = getStatus(device)
      const matchesFilter = filter === 'all'
        || (filter === 'active' && isActiveVip(device))
        || (filter === 'expired' && status === 'Expired')
      const matchesName = [device.memberName, device.displayName]
        .some((name) => name.toLocaleLowerCase().includes(normalizedQuery))
      const matchesQuery = !normalizedQuery
        || matchesName
        || device.deviceId.toLocaleLowerCase().includes(normalizedQuery)
      return matchesFilter && matchesQuery
    }).sort((first, second) => {
      const firstName = first.memberName.trim() || first.displayName.trim()
      const secondName = second.memberName.trim() || second.displayName.trim()
      const nameOrder = firstName.localeCompare(secondName)
      return nameOrder || first.deviceId.localeCompare(second.deviceId)
    })
  }, [devices, filter, query])

  async function copyDeviceId(deviceId: string) {
    try {
      await navigator.clipboard.writeText(deviceId)
      setCopiedId(deviceId)
      setCopyError('')
      window.setTimeout(() => setCopiedId(''), 1800)
    } catch {
      setCopyError('Clipboard access is unavailable. Select the device ID to copy it.')
    }
  }

  return (
    <Card className="border-slate-800/80 bg-slate-900/70 text-slate-100 shadow-xl shadow-blue-950/15">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/70 md:px-6 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Membership overview</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Member &amp; VIP directory</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">Search members and jump straight to VIP access controls.</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex flex-col items-end gap-1 text-xs text-slate-300 sm:flex-row sm:items-center sm:gap-3 sm:text-sm">
              <span><strong className="font-semibold text-white">{devices.length}</strong> members</span>
              <span><strong className="font-semibold text-emerald-200">{activeCount}</strong> active VIP</span>
            </div>
            <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-cyan-200 transition-transform group-open:rotate-180" />
          </div>
        </summary>
        <CardContent className="flex flex-col gap-4 pb-5 md:pb-6">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            aria-label="Search members by name or device ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search member name or TSL device ID"
            className="h-12 border-slate-700 bg-slate-950/80 pl-10 text-slate-100 placeholder:text-slate-500 focus-visible:border-cyan-300"
          />
        </div>
        <div role="group" aria-label="Filter members by VIP status" className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950/70 p-1">
          {(['all', 'active', 'expired'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
              className={`min-h-10 rounded-lg px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 sm:text-sm ${filter === item ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-100'}`}
            >
              {item === 'all' ? 'All' : item === 'active' ? 'Active VIP' : 'Expired'}
              <span className="ml-1.5 font-mono tabular-nums text-slate-400">{counts[item]}</span>
            </button>
          ))}
        </div>

        {isLoading && <p role="status" className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-6 text-center text-sm text-slate-300">Loading member records…</p>}
        {error && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error.message}</p>}
        {!isLoading && !error && visibleDevices.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
            {devices.length === 0 ? 'No registered devices yet.' : 'No members match this search and status filter.'}
          </p>
        )}
        {visibleDevices.length > 0 && (
          <ul className="grid gap-3 lg:grid-cols-2">
            {visibleDevices.map((device) => {
              const status = getStatus(device)
              const memberName = device.memberName.trim() || device.displayName.trim() || 'Name not added'
              const plan = device.planDurationDays > 0
                ? `${device.planDurationDays}-day VIP`
                : device.planExpiresAt
                  ? '30-day VIP'
                  : 'Standard plan'

              return (
                <li key={device.deviceId}>
                  <article className="flex h-full min-w-0 flex-col gap-4 rounded-xl border border-slate-800/90 bg-slate-950/65 p-4 transition-colors hover:border-slate-700">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-white">{memberName}</h3>
                        <div className="mt-2 flex min-w-0 items-center gap-1.5">
                          <code className="min-w-0 truncate rounded-md bg-slate-900 px-2 py-1 font-mono text-xs text-cyan-100">{device.deviceId}</code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Copy device ID ${device.deviceId}`}
                            title="Copy device ID"
                            onClick={() => void copyDeviceId(device.deviceId)}
                            className="size-8 shrink-0 text-slate-400 hover:bg-cyan-400/10 hover:text-cyan-100"
                          >
                            {copiedId === device.deviceId ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                          </Button>
                        </div>
                      </div>
                      <Badge variant="outline" className={`shrink-0 ${statusClasses(status)}`}>{status === 'Active' ? 'Active VIP' : status}</Badge>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-3 text-sm">
                      <div className="min-w-0">
                        <dt className="text-xs text-slate-500">Plan / duration</dt>
                        <dd className="mt-1 truncate font-medium text-slate-200">{plan}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-slate-500">VIP expires</dt>
                        <dd className="mt-1 text-xs font-medium tabular-nums text-slate-200">{formatDateTime(device.planExpiresAt)}</dd>
                      </div>
                    </dl>
                    <Button type="button" variant="outline" onClick={() => onManage(device.deviceId)} className="min-h-10 w-full border-cyan-400/25 bg-cyan-400/5 text-cyan-100 hover:bg-cyan-400/10 hover:text-white">
                      Manage member
                    </Button>
                  </article>
                </li>
              )
            })}
          </ul>
        )}
        {copyError && <p role="alert" className="text-sm text-amber-200">{copyError}</p>}
        <p aria-live="polite" className="sr-only">{copiedId ? `${copiedId} copied to clipboard.` : ''}</p>
        </CardContent>
      </details>
    </Card>
  )
}

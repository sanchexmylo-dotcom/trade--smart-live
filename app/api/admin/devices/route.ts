import { NextResponse } from 'next/server'
import { hasValidAdminSession } from '@/lib/admin-session'
import { changeVipAccess, getAdminDeviceRecord, isDeviceId } from '@/lib/device-profile-server'
import { getOneSignalVipTagStatus, syncOneSignalVipTag } from '@/lib/onesignal-server'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

function unauthorized() {
  return NextResponse.json({ error: 'Admin authentication is required.' }, { status: 401, headers: noStore })
}

export async function GET(request: Request) {
  if (!hasValidAdminSession(request)) return unauthorized()

  const deviceId = new URL(request.url).searchParams.get('deviceId')?.trim().toUpperCase() ?? ''
  if (!isDeviceId(deviceId)) {
    return NextResponse.json({ error: 'Enter a valid TSL device ID.' }, { status: 400, headers: noStore })
  }

  try {
    const device = await getAdminDeviceRecord(deviceId)
    if (!device) {
      return NextResponse.json({ error: 'No device was found with that ID.' }, { status: 404, headers: noStore })
    }
    const oneSignal = await getOneSignalVipTagStatus(deviceId)
    return NextResponse.json({ device, oneSignal }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'Device lookup failed. Please try again.' }, { status: 503, headers: noStore })
  }
}

export async function PATCH(request: Request) {
  if (!hasValidAdminSession(request)) return unauthorized()
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore })
  }

  if (!body || typeof body !== 'object' || !('deviceId' in body) || typeof body.deviceId !== 'string') {
    return NextResponse.json({ error: 'A valid device ID is required.' }, { status: 400, headers: noStore })
  }

  const deviceId = body.deviceId.trim().toUpperCase()
  if (!isDeviceId(deviceId)) {
    return NextResponse.json({ error: 'Enter a valid TSL device ID.' }, { status: 400, headers: noStore })
  }

  let action: { type: 'set'; active: boolean } | { type: 'extend'; days: number } | { type: 'sync' }
  if ('action' in body && body.action === 'sync') {
    action = { type: 'sync' }
  } else if ('action' in body && body.action === 'set' && 'active' in body && typeof body.active === 'boolean') {
    action = { type: 'set', active: body.active }
  } else if (
    'action' in body &&
    body.action === 'extend' &&
    'days' in body &&
    typeof body.days === 'number' &&
    Number.isInteger(body.days) &&
    body.days >= 1 &&
    body.days <= 365
  ) {
    action = { type: 'extend', days: body.days }
  } else {
    return NextResponse.json({ error: 'Choose a valid VIP update.' }, { status: 400, headers: noStore })
  }

  try {
    if (action.type !== 'sync') {
      const updated = await changeVipAccess(deviceId, action)
      if (!updated) {
        return NextResponse.json({ error: 'No device was found with that ID.' }, { status: 404, headers: noStore })
      }
    }

    const currentDevice = await getAdminDeviceRecord(deviceId)
    if (!currentDevice) {
      return NextResponse.json({ error: 'No device was found with that ID.' }, { status: 404, headers: noStore })
    }
    const oneSignal = await syncOneSignalVipTag(deviceId, currentDevice.vipActive)
    const device = await getAdminDeviceRecord(deviceId)
    return NextResponse.json({ device, oneSignal }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'VIP access could not be updated. Please try again.' }, { status: 503, headers: noStore })
  }
}

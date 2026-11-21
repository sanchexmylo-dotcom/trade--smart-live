import { NextResponse } from 'next/server'
import { getDeviceIdForToken } from '@/lib/device-profile-server'
import { adminDb, FieldValue } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }
const tradeIdPattern = /^[A-Za-z0-9_-]{1,128}$/

type JournalTrade = {
  id: string
  pair: string
  direction: 'BUY' | 'SELL'
  entry: number
  stopLoss?: number
  takeProfit?: number
  exit: number
  entryDisplay?: string
  stopLossDisplay?: string
  takeProfitDisplay?: string
  exitDisplay?: string
  riskAmount?: number
  resultUsd?: number
  outcome: 'WIN' | 'LOSS' | 'BE'
  pips: number
  notes: string
  createdAt: string
}

function bearerToken(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)
  return match?.[1] ?? null
}

function hasSameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isJournalTrade(value: unknown): value is JournalTrade {
  if (!value || typeof value !== 'object') return false
  const trade = value as Partial<JournalTrade>

  return typeof trade.id === 'string'
    && tradeIdPattern.test(trade.id)
    && typeof trade.pair === 'string'
    && trade.pair.trim().length > 0
    && trade.pair.length <= 18
    && (trade.direction === 'BUY' || trade.direction === 'SELL')
    && isFinitePositive(trade.entry)
    && isFinitePositive(trade.exit)
    && (trade.stopLoss === undefined || isFinitePositive(trade.stopLoss))
    && (trade.takeProfit === undefined || isFinitePositive(trade.takeProfit))
    && (trade.riskAmount === undefined || isFinitePositive(trade.riskAmount))
    && (trade.resultUsd === undefined || (typeof trade.resultUsd === 'number' && Number.isFinite(trade.resultUsd)))
    && (trade.entryDisplay === undefined || (typeof trade.entryDisplay === 'string' && trade.entryDisplay.length <= 20))
    && (trade.stopLossDisplay === undefined || (typeof trade.stopLossDisplay === 'string' && trade.stopLossDisplay.length <= 20))
    && (trade.takeProfitDisplay === undefined || (typeof trade.takeProfitDisplay === 'string' && trade.takeProfitDisplay.length <= 20))
    && (trade.exitDisplay === undefined || (typeof trade.exitDisplay === 'string' && trade.exitDisplay.length <= 20))
    && (trade.outcome === 'WIN' || trade.outcome === 'LOSS' || trade.outcome === 'BE')
    && typeof trade.pips === 'number'
    && Number.isFinite(trade.pips)
    && typeof trade.notes === 'string'
    && trade.notes.length <= 500
    && typeof trade.createdAt === 'string'
    && Number.isFinite(Date.parse(trade.createdAt))
}

function tradeFromDocument(id: string, data: Record<string, unknown>): JournalTrade | null {
  const trade: JournalTrade = {
    id,
    pair: data.pair as string,
    direction: data.direction as JournalTrade['direction'],
    entry: data.entry as number,
    ...(data.stopLoss === undefined ? {} : { stopLoss: data.stopLoss as number }),
    ...(data.takeProfit === undefined ? {} : { takeProfit: data.takeProfit as number }),
    exit: data.exit as number,
    ...(data.entryDisplay === undefined ? {} : { entryDisplay: data.entryDisplay as string }),
    ...(data.stopLossDisplay === undefined ? {} : { stopLossDisplay: data.stopLossDisplay as string }),
    ...(data.takeProfitDisplay === undefined ? {} : { takeProfitDisplay: data.takeProfitDisplay as string }),
    ...(data.exitDisplay === undefined ? {} : { exitDisplay: data.exitDisplay as string }),
    ...(data.riskAmount === undefined ? {} : { riskAmount: data.riskAmount as number }),
    ...(data.resultUsd === undefined ? {} : { resultUsd: data.resultUsd as number }),
    outcome: data.outcome as JournalTrade['outcome'],
    pips: data.pips as number,
    notes: data.notes as string,
    createdAt: data.createdAt as string,
  }
  return isJournalTrade(trade) ? trade : null
}

function tradeData(trade: JournalTrade) {
  return {
    pair: trade.pair,
    direction: trade.direction,
    entry: trade.entry,
    ...(trade.stopLoss === undefined ? {} : { stopLoss: trade.stopLoss }),
    ...(trade.takeProfit === undefined ? {} : { takeProfit: trade.takeProfit }),
    exit: trade.exit,
    ...(trade.entryDisplay === undefined ? {} : { entryDisplay: trade.entryDisplay }),
    ...(trade.stopLossDisplay === undefined ? {} : { stopLossDisplay: trade.stopLossDisplay }),
    ...(trade.takeProfitDisplay === undefined ? {} : { takeProfitDisplay: trade.takeProfitDisplay }),
    ...(trade.exitDisplay === undefined ? {} : { exitDisplay: trade.exitDisplay }),
    ...(trade.riskAmount === undefined ? {} : { riskAmount: trade.riskAmount }),
    ...(trade.resultUsd === undefined ? {} : { resultUsd: trade.resultUsd }),
    outcome: trade.outcome,
    pips: trade.pips,
    notes: trade.notes,
    createdAt: trade.createdAt,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

async function authorizedDeviceId(request: Request) {
  const token = bearerToken(request)
  return token ? getDeviceIdForToken(token) : null
}

function collectionForDevice(deviceId: string) {
  return adminDb.collection('journals').doc(deviceId).collection('trades')
}

async function parseJson(request: Request) {
  try {
    return await request.json() as unknown
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  try {
    const deviceId = await authorizedDeviceId(request)
    if (!deviceId) return NextResponse.json({ error: 'Device authorization is required.' }, { status: 401, headers: noStore })

    const snapshot = await collectionForDevice(deviceId).orderBy('createdAt', 'desc').get()
    const trades = snapshot.docs
      .map((document) => tradeFromDocument(document.id, document.data()))
      .filter((trade): trade is JournalTrade => trade !== null)

    return NextResponse.json({ trades }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'Your journal could not be loaded. Please try again.' }, { status: 503, headers: noStore })
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore })

  try {
    const deviceId = await authorizedDeviceId(request)
    if (!deviceId) return NextResponse.json({ error: 'Device authorization is required.' }, { status: 401, headers: noStore })

    const body = await parseJson(request)
    const trade = body && typeof body === 'object' && 'trade' in body ? body.trade : null
    if (!isJournalTrade(trade)) return NextResponse.json({ error: 'The trade details are invalid.' }, { status: 400, headers: noStore })

    await collectionForDevice(deviceId).doc(trade.id).set(tradeData(trade))
    return NextResponse.json({ id: trade.id }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'Your trade could not be saved. Please try again.' }, { status: 503, headers: noStore })
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore })

  try {
    const deviceId = await authorizedDeviceId(request)
    if (!deviceId) return NextResponse.json({ error: 'Device authorization is required.' }, { status: 401, headers: noStore })

    const body = await parseJson(request)
    const trade = body && typeof body === 'object' && 'trade' in body ? body.trade : null
    if (!isJournalTrade(trade)) return NextResponse.json({ error: 'The trade details are invalid.' }, { status: 400, headers: noStore })

    const tradeRef = collectionForDevice(deviceId).doc(trade.id)
    const updated = await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(tradeRef)
      if (!snapshot.exists) return false
      transaction.set(tradeRef, tradeData(trade))
      return true
    })
    if (!updated) return NextResponse.json({ error: 'This trade no longer exists.' }, { status: 404, headers: noStore })

    return NextResponse.json({ id: trade.id }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'Your trade could not be updated. Please try again.' }, { status: 503, headers: noStore })
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore })

  try {
    const deviceId = await authorizedDeviceId(request)
    if (!deviceId) return NextResponse.json({ error: 'Device authorization is required.' }, { status: 401, headers: noStore })

    const body = await parseJson(request)
    const id = body && typeof body === 'object' && 'id' in body ? body.id : null
    if (typeof id !== 'string' || !tradeIdPattern.test(id)) {
      return NextResponse.json({ error: 'The trade identifier is invalid.' }, { status: 400, headers: noStore })
    }

    await collectionForDevice(deviceId).doc(id).delete()
    return NextResponse.json({ id }, { headers: noStore })
  } catch {
    return NextResponse.json({ error: 'Your trade could not be deleted. Please try again.' }, { status: 503, headers: noStore })
  }
}

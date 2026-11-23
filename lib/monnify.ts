import 'server-only'

const monnifyApiKey = () => process.env.MONNIFY_API_KEY?.trim()
const monnifySecretKey = () => process.env.MONNIFY_SECRET_KEY?.trim()
const monnifyContractCode = () => process.env.MONNIFY_CONTRACT_CODE?.trim()

function monnifyBaseUrl() {
  return process.env.VERCEL_ENV?.trim().toLowerCase() === 'production'
    ? 'https://api.monnify.com'
    : 'https://sandbox.monnify.com'
}

function monnifyErrorMessage(body: unknown, fallback: string, status: number) {
  const responseBody = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const providerMessage = [responseBody.responseMessage, responseBody.message, responseBody.error_description, responseBody.error]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim()
    .slice(0, 500)

  return `${providerMessage || fallback} (Monnify HTTP ${status})`
}

async function getMonnifyAccessToken() {
  const apiKey = monnifyApiKey()
  const secretKey = monnifySecretKey()
  const missingCredentials = [
    !apiKey && 'MONNIFY_API_KEY',
    !secretKey && 'MONNIFY_SECRET_KEY',
  ].filter((name): name is string => Boolean(name))
  if (missingCredentials.length > 0) {
    throw new Error(`Missing server environment variable${missingCredentials.length === 1 ? '' : 's'}: ${missingCredentials.join(', ')}.`)
  }

  const response = await fetch(`${monnifyBaseUrl()}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json().catch(() => null)
  const accessToken = body?.responseBody?.accessToken

  if (!response.ok || body?.requestSuccessful !== true || typeof accessToken !== 'string') {
    throw new Error(monnifyErrorMessage(body, 'Monnify authentication failed.', response.status))
  }

  return accessToken
}

export async function initializeMonnifyCheckout(input: {
  amount: number
  customerEmail: string
  customerName: string
  paymentReference: string
  redirectUrl: string
  metadata: Record<string, string | null>
}) {
  const contractCode = monnifyContractCode()
  if (!contractCode) throw new Error('MONNIFY_CONTRACT_CODE is not configured on the server.')

  const accessToken = await getMonnifyAccessToken()
  const response = await fetch(`${monnifyBaseUrl()}/api/v1/merchant/transactions/init-transaction`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amount,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      paymentReference: input.paymentReference,
      paymentDescription: 'Trade Smart Live VIP — 30-day subscription',
      currencyCode: 'NGN',
      contractCode,
      redirectUrl: input.redirectUrl,
      paymentMethods: ['CARD', 'ACCOUNT_TRANSFER'],
      metadata: input.metadata,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json().catch(() => null)
  const checkoutUrl = body?.responseBody?.checkoutUrl
  const transactionReference = body?.responseBody?.transactionReference

  if (!response.ok || body?.requestSuccessful !== true || typeof checkoutUrl !== 'string') {
    throw new Error(monnifyErrorMessage(body, 'Monnify could not initialize checkout.', response.status))
  }

  return {
    checkoutUrl,
    transactionReference: typeof transactionReference === 'string' ? transactionReference : null,
  }
}

export async function verifyMonnifyPayment(paymentReference: string) {
  const accessToken = await getMonnifyAccessToken()
  const response = await fetch(
    `${monnifyBaseUrl()}/api/v2/transactions/${encodeURIComponent(paymentReference)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    },
  )
  const body = await response.json().catch(() => null)
  const payment = body?.responseBody

  if (!response.ok || body?.requestSuccessful !== true || !payment) {
    throw new Error('Monnify payment verification failed.')
  }

  return {
    paymentReference: typeof payment.paymentReference === 'string' ? payment.paymentReference : '',
    transactionReference: typeof payment.transactionReference === 'string' ? payment.transactionReference : '',
    paymentStatus: typeof payment.paymentStatus === 'string' ? payment.paymentStatus : '',
    amountPaid: Number(payment.amountPaid),
    currency: typeof payment.currency === 'string'
      ? payment.currency
      : typeof payment.currencyCode === 'string'
        ? payment.currencyCode
        : '',
  }
}

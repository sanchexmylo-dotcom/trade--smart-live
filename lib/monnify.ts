const monnifyApiKey = () => process.env.NEXT_PUBLIC_MONNIFY_API_KEY?.trim()
const monnifySecretKey = () => process.env.MONNIFY_SECRET_KEY?.trim()
const monnifyContractCode = () => process.env.MONNIFY_CONTRACT_CODE?.trim()

function monnifyBaseUrl() {
  return process.env.VERCEL_ENV === 'production'
    ? 'https://api.monnify.com'
    : 'https://sandbox.monnify.com'
}

async function getMonnifyAccessToken() {
  const apiKey = monnifyApiKey()
  const secretKey = monnifySecretKey()
  if (!apiKey || !secretKey) throw new Error('Monnify server credentials are not configured.')

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
    throw new Error('Monnify authentication failed.')
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
  if (!contractCode) throw new Error('Monnify contract code is not configured.')

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
    throw new Error('Monnify could not initialize checkout.')
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

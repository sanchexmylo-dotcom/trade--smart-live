export async function POST(request: Request) {
  const configuredPin = process.env.VIP_ADMIN_PIN

  if (!configuredPin) {
    return Response.json({ error: 'Admin access is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  if (!body || typeof body !== 'object' || !('passcode' in body) || typeof body.passcode !== 'string' || body.passcode.length > 128) {
    return Response.json({ error: 'Invalid request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const authenticated = body.passcode.trim() === configuredPin.trim()

  return Response.json({ authenticated }, {
    status: authenticated ? 200 : 401,
    headers: { 'Cache-Control': 'no-store' },
  })
}

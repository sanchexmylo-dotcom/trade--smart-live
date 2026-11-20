import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import PwaClient from '@/components/pwa-client'

const oneSignalAppId = '7a6d4de7-44d2-4a15-9e28-b1130c08c153'

export const metadata: Metadata = {
  title: 'Trade Smart Live',
  description: 'Trade Smart Live — high-conviction forex signals, market calendar, and VIP trade intelligence.',
  manifest: '/manifest.json',
  icons: {
    icon: '/logo.png',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#060A13',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <Script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" strategy="beforeInteractive" defer />
      </head>
      <body className="min-h-screen overflow-x-hidden bg-[#050814] text-slate-100 antialiased">
        <PwaClient appId={oneSignalAppId} />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

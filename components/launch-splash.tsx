'use client'

import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

const splashDuration = 1200
const sessionKey = 'trade-smart-live-splash-seen'

export default function LaunchSplash() {
  const [visible, setVisible] = useState(true)
  const splashState = useRef<'pending' | 'show' | 'skip'>('pending')

  useEffect(() => {
    if (splashState.current === 'pending') {
      try {
        if (window.sessionStorage.getItem(sessionKey)) {
          splashState.current = 'skip'
          setVisible(false)
          return
        }
        window.sessionStorage.setItem(sessionKey, 'true')
      } catch {
        // Keep the first-load splash even when session storage is unavailable.
      }
      splashState.current = 'show'
    }

    if (splashState.current === 'skip') return
    const timer = window.setTimeout(() => setVisible(false), splashDuration)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-label="Loading Trade Smart Live"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3, ease: 'easeOut' } }}
          className="fixed inset-0 z-[100] flex min-h-dvh flex-col items-center justify-center gap-5 bg-[#060A13]"
        >
          <Image
            src="/logo.png"
            alt="Trade Smart Live TS logo"
            width={136}
            height={136}
            priority
            className="size-34 rounded-2xl object-contain shadow-2xl shadow-blue-950/40"
          />
          <p className="text-sm font-semibold tracking-[0.22em] text-white">Trade Smart Live</p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

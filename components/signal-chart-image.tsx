'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { X } from 'lucide-react'

type ChartImageResponse = { url: string }
type ChartImageKey = readonly [string, string]

async function fetchChartImage([url, deviceToken]: ChartImageKey) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${deviceToken}` },
    cache: 'no-store',
  })
  const result = await response.json() as ChartImageResponse | { error?: string }
  if (!response.ok || !('url' in result)) throw new Error('The chart image could not be loaded.')
  return result
}

export default function SignalChartImage({
  signalId,
  pair,
  deviceToken,
}: {
  signalId: string | number
  pair: string
  deviceToken: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const imageUrl = `/api/signals/${encodeURIComponent(String(signalId))}/chart-image`
  const { data, error, isLoading } = useSWR<ChartImageResponse, Error, ChartImageKey>(
    [imageUrl, deviceToken],
    fetchChartImage,
    { revalidateOnFocus: true, dedupingInterval: 4 * 60 * 1000 },
  )

  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
      previouslyFocused?.focus()
    }
  }, [isOpen])

  if (error) return <p role="status" className="mt-4 text-xs text-slate-400">Chart image unavailable.</p>
  if (isLoading || !data) return <div aria-label="Loading chart image" className="mt-4 aspect-video animate-pulse rounded-xl bg-slate-800/70" />

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Open chart image for ${pair}`}
        className="mt-4 block w-full overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        <img src={data.url} alt={`Chart setup for ${pair}`} loading="lazy" decoding="async" className="max-h-80 w-full object-contain" />
        <span className="block border-t border-slate-800 px-3 py-2 text-left text-xs font-medium text-slate-300">Tap to inspect chart</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${pair} chart image`}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={(event) => { if (event.target === event.currentTarget) setIsOpen(false) }}
          onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); closeButtonRef.current?.focus() } }}
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close chart preview"
            className="absolute right-4 top-4 grid size-11 place-items-center rounded-full border border-white/20 bg-slate-900 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <X size={20} aria-hidden="true" />
          </button>
          <img src={data.url} alt={`Full-size chart setup for ${pair}`} className="max-h-[85dvh] max-w-full rounded-lg object-contain" />
        </div>
      )}
    </>
  )
}

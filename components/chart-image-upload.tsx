'use client'

import { useEffect, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'

const maxFileSize = 4 * 1024 * 1024
const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

export default function ChartImageUpload({
  file,
  onFileChange,
}: {
  file: File | null
  onFileChange: (file: File | null) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  function selectFile(candidate?: File) {
    if (!candidate) return
    if (!supportedTypes.has(candidate.type)) {
      setError('Choose a PNG, JPG, or WEBP image.')
      return
    }
    if (candidate.size > maxFileSize) {
      setError('Chart images must be 4 MB or smaller.')
      return
    }

    setError('')
    onFileChange(candidate)
  }

  return (
    <div>
      <p className="text-sm text-zinc-400">Attach Chart Screenshot <span className="text-zinc-500">(Optional)</span></p>
      {file && preview ? (
        <div className="relative mt-2 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950">
          <img src={preview} alt={`Preview of ${file.name}`} className="max-h-64 w-full object-contain" />
          <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-3 py-2">
            <p className="min-w-0 truncate text-xs text-zinc-300">{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</p>
            <button
              type="button"
              onClick={() => { onFileChange(null); setError('') }}
              aria-label="Remove chart screenshot"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor="signal-chart-image"
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]) }}
          className={`mt-2 flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition-colors focus-within:ring-2 focus-within:ring-cyan-300 ${dragging ? 'border-cyan-300 bg-cyan-400/10' : 'border-zinc-700 bg-zinc-950/70 hover:border-zinc-500'}`}
        >
          <ImagePlus size={20} className="text-cyan-300" aria-hidden="true" />
          <span className="text-sm font-medium text-zinc-200">Drop a chart here or browse files</span>
          <span className="text-xs text-zinc-500">PNG, JPG, or WEBP · up to 4 MB</span>
          <input
            id="signal-chart-image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => { selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }}
          />
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}
    </div>
  )
}

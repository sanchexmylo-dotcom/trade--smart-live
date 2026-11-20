'use client'

import { FormEvent, useState } from 'react'
import { motion } from 'framer-motion'
import { CreditCard, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type PaymentModalProps = {
  onClose: () => void
  deviceToken: string | null
}

type CheckoutResponse = { checkoutUrl?: string; error?: string }

const spring = { type: 'spring' as const, stiffness: 420, damping: 28 }

export default function PaymentModal({ onClose, deviceToken }: PaymentModalProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function startCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deviceToken) {
      setError('Your device profile is still syncing. Please try again in a moment.')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/monnify/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ customerEmail: email.trim() }),
      })
      const result = await response.json() as CheckoutResponse
      if (!response.ok || !result.checkoutUrl) {
        throw new Error(result.error || 'Secure checkout could not be started.')
      }
      window.location.assign(result.checkoutUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Secure checkout could not be started.')
      setIsSubmitting(false)
    }
  }

  return <motion.div
    className="fixed inset-0 z-[60] grid place-items-center bg-black/80 px-5"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    onClick={onClose}
  >
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vip-payment-title"
      onClick={(event) => event.stopPropagation()}
      className="w-full max-w-[380px] rounded-2xl border border-cyan-500/30 bg-slate-950 p-5 text-slate-100 shadow-2xl shadow-cyan-950/40"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-cyan-200">
          <CreditCard aria-hidden="true" />
          <h2 id="vip-payment-title" className="font-bold text-white">Secure Monnify checkout</h2>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close payment" className="text-slate-300">
          <X data-icon="inline-start" />
        </Button>
      </div>
      <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <p className="text-sm text-slate-300">Trade Smart Live VIP</p>
        <p className="mt-2 font-mono text-2xl font-bold text-white">₦15,000</p>
        <p className="mt-1 text-sm text-slate-300">30-day membership</p>
      </div>
      <form onSubmit={startCheckout} className="mt-4 flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="vip-payment-email" className="text-slate-200">Receipt email</FieldLabel>
            <Input
              id="vip-payment-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="border-slate-700 bg-slate-900 text-white"
            />
          </Field>
        </FieldGroup>
        {error && <p role="alert" className="text-sm leading-relaxed text-rose-300">{error}</p>}
        <Button type="submit" disabled={isSubmitting || !deviceToken} className="min-h-11 bg-cyan-300 font-bold text-slate-950 hover:bg-cyan-200">
          {isSubmitting ? 'Opening secure checkout…' : 'Continue to Monnify'}
        </Button>
        <p className="text-center text-xs leading-relaxed text-slate-400">Payment is completed on Monnify&apos;s hosted page. VIP access and referral rewards are applied only after the payment is verified.</p>
      </form>
    </motion.div>
  </motion.div>
}

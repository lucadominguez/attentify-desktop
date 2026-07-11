import React from 'react'
import { ChevronRight } from 'lucide-react'

interface BannerProps {
  step: number
  totalSteps: number
  message: string
  ctaLabel: string
  onCta: () => void
}

export default function Banner({ step, totalSteps, message, ctaLabel, onCta }: BannerProps): React.ReactElement {
  const pct = (step / totalSteps) * 100

  return (
    <div
      className="flex items-center gap-5 px-6 py-4 rounded-xl"
      style={{
        background: 'linear-gradient(135deg, rgba(33,150,243,0.12) 0%, rgba(33,150,243,0.05) 100%)',
        border: '1px solid rgba(33,150,243,0.25)',
      }}
    >
      {/* Circular progress */}
      <div className="relative flex-shrink-0">
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="21" fill="none" stroke="#1e3a5f" strokeWidth="4" />
          <circle
            cx="26" cy="26" r="21"
            fill="none"
            stroke="#3b9eff"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 132} 132`}
            strokeDashoffset="33"
            style={{ transition: 'stroke-dasharray 0.8s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold text-xs">{step}/{totalSteps}</span>
        </div>
      </div>

      {/* Message */}
      <p className="flex-1 text-white text-sm font-medium leading-snug">{message}</p>

      {/* CTA */}
      <button
        onClick={onCta}
        className="flex items-center gap-1.5 bg-accent-blue hover:bg-accent-blue-light text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-colors flex-shrink-0"
      >
        {ctaLabel}
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

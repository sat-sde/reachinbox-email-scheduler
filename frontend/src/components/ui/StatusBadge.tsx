import React from 'react'
import { Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

export interface StatusBadgeProps {
  status: 'scheduled' | 'processing' | 'sent' | 'failed' | string
  className?: string
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const normalized = status.toLowerCase()

  switch (normalized) {
    case 'scheduled':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 shadow-xs ${className}`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
          Scheduled
        </span>
      )

    case 'processing':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-xs ${className}`}
        >
          <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin flex-shrink-0" />
          Processing
        </span>
      )

    case 'sent':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-xs ${className}`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
          Sent
        </span>
      )

    case 'failed':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/80 shadow-xs ${className}`}
        >
          <AlertCircle className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />
          Failed
        </span>
      )

    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200 ${className}`}
        >
          {status}
        </span>
      )
  }
}

export default StatusBadge


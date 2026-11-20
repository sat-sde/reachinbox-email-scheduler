import React, { useState } from 'react'
import {
  ExternalLink,
  Trash2,
  AlertCircle,
  FileText,
  Mail,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'
import Modal from './ui/Modal'
import Button from './ui/Button'
import StatusBadge from './ui/StatusBadge'
import { Email } from '../types'

export interface EmailDetailsModalProps {
  email: Email | null
  isOpen: boolean
  onClose: () => void
  onCancelled: () => void
}

export const EmailDetailsModal: React.FC<EmailDetailsModalProps> = ({
  email,
  isOpen,
  onClose,
  onCancelled,
}) => {
  const [cancelling, setCancelling] = useState(false)

  if (!email) return null

  const handleCancelEmail = async () => {
    if (!window.confirm('Are you sure you want to cancel this scheduled email?')) {
      return
    }

    setCancelling(true)
    try {
      const res = await api.delete(`/emails/${email.id}`)
      if (res.data?.success) {
        toast.success('Scheduled email was cancelled successfully.')
        onCancelled()
        onClose()
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to cancel email')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={
        <div className="flex items-center gap-2.5">
          <Mail className="w-5 h-5 text-primary-600" />
          <span className="truncate max-w-md">{email.subject}</span>
        </div>
      }
      subtitle={`Recipient: ${email.recipient}`}
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {email.previewUrl && (
              <a
                href={email.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors border border-primary-200/60"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on Ethereal Email
              </a>
            )}
          </div>

          <div className="flex items-center gap-3">
            {email.status === 'scheduled' && (
              <Button
                variant="danger"
                size="sm"
                loading={cancelling}
                onClick={handleCancelEmail}
                icon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Cancel Scheduled Email
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Key Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-gray-50 border border-gray-100 text-xs">
          <div>
            <span className="text-gray-400 font-medium block">Status</span>
            <div className="mt-1">
              <StatusBadge status={email.status} />
            </div>
          </div>

          <div>
            <span className="text-gray-400 font-medium block">Scheduled For</span>
            <p className="font-semibold text-gray-800 mt-1">
              {new Date(email.scheduledAt).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </p>
          </div>

          <div>
            <span className="text-gray-400 font-medium block">Dispatched At</span>
            <p className="font-semibold text-gray-800 mt-1">
              {email.sentAt
                ? new Date(email.sentAt).toLocaleString(undefined, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                : '—'}
            </p>
          </div>

          <div>
            <span className="text-gray-400 font-medium block">Job ID</span>
            <p className="font-mono text-[10px] text-gray-600 truncate mt-1">
              {email.bullJobId || 'Pending'}
            </p>
          </div>
        </div>

        {/* Failure Error Notice */}
        {email.status === 'failed' && email.errorMessage && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Dispatch Error</p>
              <p className="mt-0.5 text-rose-700">{email.errorMessage}</p>
            </div>
          </div>
        )}

        {/* Full Email Body Preview */}
        <div>
          <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-gray-400" />
            Email Content
          </span>
          <div className="rounded-xl border border-gray-200 p-4 bg-white text-xs text-gray-800 leading-relaxed shadow-xs max-h-72 overflow-y-auto">
            {email.body.includes('<') && email.body.includes('>') ? (
              <div
                dangerouslySetInnerHTML={{ __html: email.body }}
                className="prose prose-sm max-w-none"
              />
            ) : (
              <p className="whitespace-pre-wrap">{email.body}</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default EmailDetailsModal


import React, { useState, useEffect } from 'react'
import {
  Send,
  Calendar,
  Clock,
  UserCheck,
  AlertCircle,
  Sparkles,
  Info,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'
import Modal from './ui/Modal'
import Input from './ui/Input'
import Button from './ui/Button'
import { Sender } from '../types'

export interface ComposeModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export const ComposeModal: React.FC<ComposeModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [senders, setSenders] = useState<Sender[]>([])
  const [loadingSenders, setLoadingSenders] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form State
  const [senderId, setSenderId] = useState('')
  const [recipientsInput, setRecipientsInput] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sendMode, setSendMode] = useState<'immediate' | 'scheduled'>('immediate')
  const [startTime, setStartTime] = useState('')
  const [delaySeconds, setDelaySeconds] = useState(2)
  const [hourlyLimit, setHourlyLimit] = useState<number | ''>('')

  // Load senders when modal opens
  useEffect(() => {
    if (isOpen) {
      loadSenders()
      // Default scheduled time to 1 hour in the future
      const defaultDate = new Date(Date.now() + 60 * 60 * 1000)
      const pad = (n: number) => String(n).padStart(2, '0')
      const formatted = `${defaultDate.getFullYear()}-${pad(defaultDate.getMonth() + 1)}-${pad(
        defaultDate.getDate()
      )}T${pad(defaultDate.getHours())}:${pad(defaultDate.getMinutes())}`
      setStartTime(formatted)
    }
  }, [isOpen])

  const loadSenders = async () => {
    setLoadingSenders(true)
    try {
      const res = await api.get('/senders')
      const list = res.data?.data || res.data?.senders || []
      setSenders(list)
      if (list.length > 0 && !senderId) {
        setSenderId(list[0].id)
      }
    } catch (err) {
      console.error('Failed to load senders:', err)
    } finally {
      setLoadingSenders(false)
    }
  }

  // Pre-fill a sample cold outreach template
  const handleUseTemplate = () => {
    if (!recipientsInput.trim()) {
      setRecipientsInput('browser.test.recipient@reachinbox.test')
    }
    setSubject('Quick question regarding your outbound pipeline')
    setBody(
      `<p>Hi there,</p>
<p>I noticed your team is actively scaling outbound outreach. We built ReachInbox to automate reliable email scheduling with distributed rate limiting and zero job loss.</p>
<p>Would you be open to a brief 5-minute chat next week to see how it works?</p>
<p>Best regards,<br/><strong>ReachInbox Team</strong></p>`
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate inputs
    const parsedRecipients = recipientsInput
      .split(/[\n,;]+/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0)

    if (parsedRecipients.length === 0) {
      toast.error('Please enter at least one recipient email address')
      return
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalid = parsedRecipients.filter((r) => !emailRegex.test(r))
    if (invalid.length > 0) {
      toast.error(`Invalid email format: ${invalid[0]}`)
      return
    }

    if (!subject.trim()) {
      toast.error('Subject line is required')
      return
    }

    if (!body.trim()) {
      toast.error('Email body is required')
      return
    }

    setSubmitting(true)

    try {
      const payload: any = {
        subject: subject.trim(),
        body: body.trim(),
        recipients: parsedRecipients,
        senderId: senderId || undefined,
        delayBetweenEmails: delaySeconds,
      }

      if (sendMode === 'scheduled' && startTime) {
        payload.startTime = new Date(startTime).toISOString()
      }

      if (hourlyLimit && Number(hourlyLimit) > 0) {
        payload.hourlyLimit = Number(hourlyLimit)
      }

      const res = await api.post('/emails/schedule', payload)

      if (res.data?.success) {
        toast.success(`Successfully scheduled ${parsedRecipients.length} email(s) via BullMQ!`)
        // Reset form
        setRecipientsInput('')
        setSubject('')
        setBody('')
        onSuccess()
        onClose()
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to schedule emails'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const recipientCount = recipientsInput
    .split(/[\n,;]+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0).length

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex items-center gap-2">
          <Send className="w-5 h-5 text-primary-600" />
          <span>Compose & Schedule Email Campaign</span>
        </div>
      }
      subtitle="Dispatch delayed or immediate emails powered by BullMQ and distributed rate limiting."
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={handleUseTemplate}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Use Demo Template
          </button>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={submitting}
              onClick={handleSubmit}
              icon={<Send className="w-4 h-4" />}
            >
              {sendMode === 'immediate'
                ? `Send Now (${recipientCount || 0})`
                : `Schedule Campaign (${recipientCount || 0})`}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Sender Identity & Mode Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center justify-between">
              <span>Sending From (Sender Identity)</span>
              {loadingSenders && <span className="text-[10px] text-gray-400">Loading senders...</span>}
            </label>
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              className="w-full text-xs rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
            >
              {senders.length === 0 ? (
                <option value="">Default Ethereal Dispatcher</option>
              ) : (
                senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.email}) — Limit: {s.hourlyLimit}/hr
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Dispatch Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSendMode('immediate')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all border ${
                  sendMode === 'immediate'
                    ? 'bg-primary-50 text-primary-700 border-primary-300 shadow-xs'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Send Immediately
              </button>
              <button
                type="button"
                onClick={() => setSendMode('scheduled')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all border ${
                  sendMode === 'scheduled'
                    ? 'bg-primary-50 text-primary-700 border-primary-300 shadow-xs'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Schedule for Later
              </button>
            </div>
          </div>
        </div>

        {/* Recipients Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-700">
              Recipients <span className="text-rose-500">*</span>
            </label>
            {recipientCount > 0 && (
              <span className="text-[11px] font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full border border-primary-200/60">
                {recipientCount} recipient{recipientCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <textarea
            rows={2}
            value={recipientsInput}
            onChange={(e) => setRecipientsInput(e.target.value)}
            placeholder="user1@example.com, user2@example.com (comma, newline, or space separated)"
            className="w-full text-xs font-mono rounded-xl border border-gray-300 p-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
          />
        </div>

        {/* Subject Line */}
        <Input
          label="Subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="E.g. Quick follow-up regarding our discussion"
        />

        {/* Email Body */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            Email Body (HTML Supported) <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Compose your message here... Supports formatted HTML tags like <p>, <strong>, <a href='...'>."
            className="w-full text-xs rounded-xl border border-gray-300 p-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all font-sans leading-relaxed"
          />
        </div>

        {/* Scheduling & Rate Limiting Controls */}
        {sendMode === 'scheduled' && (
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200/80 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
              <Calendar className="w-4 h-4 text-primary-600" />
              <span>Advanced Scheduling & Throttling Options</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                  Start Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full text-xs rounded-xl border border-gray-300 bg-white px-2.5 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                  Delay Between Emails (sec)
                </label>
                <input
                  type="number"
                  min="0"
                  max="3600"
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(Number(e.target.value))}
                  className="w-full text-xs rounded-xl border border-gray-300 bg-white px-2.5 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                  Hourly Limit Override (opt)
                </label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  placeholder="e.g. 50"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(e.target.value ? Number(e.target.value) : '')}
                  className="w-full text-xs rounded-xl border border-gray-300 bg-white px-2.5 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <p className="text-[11px] text-gray-500 flex items-center gap-1">
              <Info className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
              Emails will be queued into Redis BullMQ delayed sets with deterministic job IDs.
            </p>
          </div>
        )}
      </form>
    </Modal>
  )
}

export default ComposeModal


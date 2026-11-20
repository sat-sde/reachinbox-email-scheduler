import React, { useState, useEffect, useRef, useCallback } from 'react'
import Papa from 'papaparse'
import {
  Send,
  Calendar,
  Clock,
  Sparkles,
  Info,
  Upload,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  Users,
  Eye,
  EyeOff,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Sender } from '../types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComposeModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface CsvParseState {
  fileName: string
  totalRows: number
  validEmails: string[]
  invalidEmails: string[]
  duplicatesRemoved: number
}

// ── Email validation regex ────────────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim())
}

// ── Default datetime helper ───────────────────────────────────────────────────
function getDefaultStartTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ComposeModal: React.FC<ComposeModalProps> = ({ isOpen, onClose, onSuccess }) => {
  // Senders
  const [senders, setSenders] = useState<Sender[]>([])
  const [loadingSenders, setLoadingSenders] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form fields
  const [senderId, setSenderId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sendMode, setSendMode] = useState<'immediate' | 'scheduled'>('scheduled')
  const [startTime, setStartTime] = useState(getDefaultStartTime())
  const [delaySeconds, setDelaySeconds] = useState(5)
  const [hourlyLimit, setHourlyLimit] = useState<number | ''>(50)

  // Recipient text input (manual)
  const [manualInput, setManualInput] = useState('')

  // CSV state
  const [csvState, setCsvState] = useState<CsvParseState | null>(null)
  const [csvParsing, setCsvParsing] = useState(false)
  const [showRecipientPreview, setShowRecipientPreview] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Active tab: 'manual' | 'csv'
  const [recipientTab, setRecipientTab] = useState<'manual' | 'csv'>('manual')

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Load senders on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      loadSenders()
      setStartTime(getDefaultStartTime())
      resetForm()
    }
  }, [isOpen])

  const resetForm = () => {
    setSubject('')
    setBody('')
    setManualInput('')
    setCsvState(null)
    setShowRecipientPreview(false)
    setErrors({})
    setSendMode('scheduled')
    setDelaySeconds(5)
    setHourlyLimit(50)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const loadSenders = async () => {
    setLoadingSenders(true)
    try {
      const res = await api.get('/senders')
      const list: Sender[] = res.data?.data || res.data?.senders || []
      setSenders(list)
      if (list.length > 0) setSenderId(list[0].id)
    } catch {
      // silent — senders are optional
    } finally {
      setLoadingSenders(false)
    }
  }

  // ── Derived recipient list ──────────────────────────────────────────────────
  const finalRecipients: string[] = (() => {
    if (recipientTab === 'csv' && csvState) {
      return csvState.validEmails
    }
    return manualInput
      .split(/[\n,;]+/)
      .map(r => r.trim())
      .filter(r => r.length > 0 && validateEmail(r))
  })()

  const manualInvalidCount = manualInput
    .split(/[\n,;]+/)
    .map(r => r.trim())
    .filter(r => r.length > 0 && !validateEmail(r)).length

  // ── CSV Parsing ─────────────────────────────────────────────────────────────
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['csv', 'txt'].includes(ext || '')) {
      toast.error('Please upload a .csv or .txt file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be under 5 MB')
      return
    }

    setCsvParsing(true)
    setCsvState(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        processParseResults(results.data, results.meta.fields || [], file.name)
      },
      error: (err) => {
        toast.error(`CSV parse error: ${err.message}`)
        setCsvParsing(false)
      },
    })
  }, [])

  const processParseResults = (
    rows: Record<string, string>[],
    fields: string[],
    fileName: string
  ) => {
    // Detect which column(s) hold email addresses
    // Priority: columns named 'email', 'Email', 'EMAIL', 'e-mail', 'mail'
    // Fallback: scan all columns for values that look like emails
    const emailKeywords = ['email', 'e-mail', 'mail', 'emailaddress', 'email_address']
    let emailCol = fields.find(f => emailKeywords.includes(f.trim().toLowerCase()))

    // Collect all candidate emails
    const seen = new Set<string>()
    const valid: string[] = []
    const invalid: string[] = []
    let duplicatesRemoved = 0

    rows.forEach((row, _rowIdx) => {
      let candidates: string[] = []

      if (emailCol) {
        // Use the detected email column
        candidates = [row[emailCol] || '']
      } else {
        // No named email column — scan all cell values for email-shaped strings
        candidates = Object.values(row).flatMap(v =>
          (v || '').split(/[\s,;]+/).filter(s => s.includes('@'))
        )
      }

      candidates.forEach(raw => {
        const email = raw.trim().toLowerCase()
        if (!email) return

        if (validateEmail(email)) {
          if (seen.has(email)) {
            duplicatesRemoved++
          } else {
            seen.add(email)
            valid.push(email)
          }
        } else if (email.length > 0) {
          invalid.push(email)
        }
      })
    })

    setCsvState({
      fileName,
      totalRows: rows.length,
      validEmails: valid,
      invalidEmails: invalid,
      duplicatesRemoved,
    })
    setCsvParsing(false)

    if (valid.length === 0) {
      toast.error('No valid email addresses found in the file. Check the email column.')
    } else {
      toast.success(`Parsed ${valid.length} valid email${valid.length !== 1 ? 's' : ''} from ${fileName}`)
    }
  }

  const clearCsv = () => {
    setCsvState(null)
    setShowRecipientPreview(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Template fill ───────────────────────────────────────────────────────────
  const handleUseTemplate = () => {
    setSubject('Quick question regarding your outbound pipeline')
    setManualInput('browser.test.recipient@reachinbox.test, team@startup.io')
    setRecipientTab('manual')
    setBody(
      `<p>Hi there,</p>
<p>I noticed your team is actively scaling outbound outreach. We built ReachInbox to automate reliable email scheduling with distributed rate limiting and zero job loss.</p>
<p>Would you be open to a brief 5-minute chat next week to see how it works?</p>
<p>Best regards,<br/><strong>ReachInbox Team</strong></p>`
    )
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  const validate = (): boolean => {
    const errs: Record<string, string> = {}

    if (finalRecipients.length === 0) {
      errs.recipients =
        recipientTab === 'csv'
          ? 'No valid emails from CSV. Upload a valid file.'
          : 'Enter at least one valid recipient email address.'
    }

    if (!subject.trim()) errs.subject = 'Subject line is required.'
    if (!body.trim()) errs.body = 'Email body cannot be empty.'

    if (sendMode === 'scheduled' && !startTime) {
      errs.startTime = 'Please select a start date and time.'
    }
    if (sendMode === 'scheduled' && startTime && new Date(startTime) <= new Date()) {
      errs.startTime = 'Start time must be in the future.'
    }

    if (delaySeconds < 0) errs.delay = 'Delay must be 0 or more seconds.'

    if (hourlyLimit !== '' && (Number(hourlyLimit) < 1 || Number(hourlyLimit) > 10000)) {
      errs.hourlyLimit = 'Hourly limit must be between 1 and 10,000.'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!validate()) return

    setSubmitting(true)

    try {
      const payload: Record<string, unknown> = {
        subject: subject.trim(),
        body: body.trim(),
        recipients: finalRecipients,
        delayBetweenEmails: delaySeconds,
      }

      if (senderId) payload.senderId = senderId

      if (sendMode === 'scheduled' && startTime) {
        payload.startTime = new Date(startTime).toISOString()
      }

      if (hourlyLimit !== '' && Number(hourlyLimit) > 0) {
        payload.hourlyLimit = Number(hourlyLimit)
      }

      const res = await api.post('/emails/schedule', payload)

      if (res.data?.success !== false) {
        const count = finalRecipients.length
        toast.success(
          `🚀 ${count} email${count !== 1 ? 's' : ''} queued in BullMQ successfully!`,
          { duration: 5000 }
        )
        onSuccess()
        onClose()
      }
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Failed to schedule emails. Please try again.'
      toast.error(msg, { duration: 6000 })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
            <Send className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-base font-bold text-gray-900 leading-tight">Compose & Schedule Campaign</div>
            <div className="text-[11px] text-gray-500 font-normal">Powered by BullMQ + distributed rate limiting</div>
          </div>
        </div>
      }
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
            <Button variant="outline" size="sm" onClick={onClose} type="button" disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={submitting}
              onClick={handleSubmit}
              icon={<Send className="w-3.5 h-3.5" />}
              disabled={finalRecipients.length === 0}
            >
              {sendMode === 'immediate'
                ? `Send Now (${finalRecipients.length})`
                : `Schedule Campaign (${finalRecipients.length})`}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Row 1: Sender + Dispatch Mode ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Sender selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              <span className="flex items-center gap-1.5">
                Sending From
                {loadingSenders && (
                  <span className="text-[10px] text-gray-400 font-normal">Loading…</span>
                )}
              </span>
            </label>
            <select
              value={senderId}
              onChange={e => setSenderId(e.target.value)}
              className="w-full text-xs rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
            >
              {senders.length === 0 ? (
                <option value="">Default Ethereal Dispatcher</option>
              ) : (
                senders.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} &lt;{s.email}&gt; — {s.hourlyLimit}/hr limit
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Dispatch mode */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Dispatch Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {(['immediate', 'scheduled'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSendMode(mode)}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all border ${
                    sendMode === mode
                      ? 'bg-primary-50 text-primary-700 border-primary-300 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {mode === 'immediate' ? (
                    <><Clock className="w-3.5 h-3.5" /> Send Immediately</>
                  ) : (
                    <><Calendar className="w-3.5 h-3.5" /> Schedule for Later</>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Row 2: Subject ── */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            Email Subject <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={e => { setSubject(e.target.value); setErrors(p => ({ ...p, subject: '' })) }}
            placeholder="e.g. Quick follow-up regarding our discussion"
            className={`w-full text-sm rounded-xl border px-3 py-2.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all ${
              errors.subject ? 'border-rose-400 bg-rose-50' : 'border-gray-300'
            }`}
          />
          {errors.subject && (
            <p className="mt-1 text-[11px] text-rose-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errors.subject}
            </p>
          )}
        </div>

        {/* ── Row 3: Email Body ── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-700">
              Email Body <span className="text-rose-500">*</span>
              <span className="ml-1.5 text-[10px] text-gray-400 font-normal">(HTML supported)</span>
            </label>
            <span className="text-[10px] text-gray-400">{body.length} chars</span>
          </div>
          <textarea
            rows={6}
            value={body}
            onChange={e => { setBody(e.target.value); setErrors(p => ({ ...p, body: '' })) }}
            placeholder={`Write your message here…\n\nSupports HTML: <p>, <strong>, <a href="…">, <br/>`}
            className={`w-full text-xs rounded-xl border p-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all font-sans leading-relaxed resize-y ${
              errors.body ? 'border-rose-400 bg-rose-50' : 'border-gray-300'
            }`}
          />
          {errors.body && (
            <p className="mt-1 text-[11px] text-rose-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errors.body}
            </p>
          )}
        </div>

        {/* ── Row 4: Recipients ── */}
        <div className="rounded-2xl border border-gray-200 overflow-hidden">
          {/* Tab header */}
          <div className="flex border-b border-gray-200 bg-gray-50/60">
            <button
              type="button"
              onClick={() => setRecipientTab('manual')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                recipientTab === 'manual'
                  ? 'bg-white text-primary-700 border-b-2 border-primary-500'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Manual Entry
            </button>
            <button
              type="button"
              onClick={() => setRecipientTab('csv')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                recipientTab === 'csv'
                  ? 'bg-white text-primary-700 border-b-2 border-primary-500'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Upload CSV / TXT
            </button>
          </div>

          <div className="p-4">
            {/* Manual input tab */}
            {recipientTab === 'manual' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-600">
                    One email per line, or comma / semicolon separated
                  </span>
                  <div className="flex items-center gap-2">
                    {manualInvalidCount > 0 && (
                      <span className="text-[11px] text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                        {manualInvalidCount} invalid
                      </span>
                    )}
                    {finalRecipients.length > 0 && (
                      <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        {finalRecipients.length} valid
                      </span>
                    )}
                  </div>
                </div>
                <textarea
                  rows={4}
                  value={manualInput}
                  onChange={e => {
                    setManualInput(e.target.value)
                    setErrors(p => ({ ...p, recipients: '' }))
                  }}
                  placeholder={`alice@example.com\nbob@company.io\ncarol@startup.dev`}
                  className={`w-full text-xs font-mono rounded-xl border p-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-y ${
                    errors.recipients ? 'border-rose-400 bg-rose-50' : 'border-gray-300'
                  }`}
                />
              </div>
            )}

            {/* CSV upload tab */}
            {recipientTab === 'csv' && (
              <div className="space-y-3">
                {/* Drop zone */}
                <div
                  className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
                    csvState
                      ? 'border-emerald-300 bg-emerald-50/40'
                      : 'border-gray-300 hover:border-primary-400 hover:bg-primary-50/30'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    const file = e.dataTransfer.files[0]
                    if (file && fileInputRef.current) {
                      const dt = new DataTransfer()
                      dt.items.add(file)
                      fileInputRef.current.files = dt.files
                      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
                    }
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  {csvParsing ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-gray-500">Parsing CSV…</span>
                    </div>
                  ) : csvState ? (
                    <div className="flex items-center gap-3 text-left">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{csvState.fileName}</div>
                        <div className="text-[11px] text-gray-500">{csvState.totalRows} rows parsed</div>
                      </div>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); clearCsv() }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Remove file"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-700">Drop CSV / TXT here</p>
                        <p className="text-xs text-gray-400 mt-0.5">or click to browse — max 5 MB</p>
                      </div>
                      <p className="text-[11px] text-gray-400 bg-gray-100 px-2.5 py-1 rounded-lg">
                        Columns: <code className="font-mono">email</code>, <code className="font-mono">Email</code>, or any email-shaped cell
                      </p>
                    </div>
                  )}
                </div>

                {/* Parse results summary */}
                {csvState && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="grid grid-cols-3 divide-x divide-gray-200">
                      <div className="p-3 text-center">
                        <div className="text-lg font-bold text-emerald-600">{csvState.validEmails.length}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">Valid emails</div>
                      </div>
                      <div className="p-3 text-center">
                        <div className={`text-lg font-bold ${csvState.invalidEmails.length > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                          {csvState.invalidEmails.length}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">Invalid / skipped</div>
                      </div>
                      <div className="p-3 text-center">
                        <div className={`text-lg font-bold ${csvState.duplicatesRemoved > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {csvState.duplicatesRemoved}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">Duplicates removed</div>
                      </div>
                    </div>

                    {/* Invalid email list (collapsed) */}
                    {csvState.invalidEmails.length > 0 && (
                      <div className="border-t border-gray-200 px-3 py-2 bg-rose-50/40">
                        <p className="text-[11px] text-rose-700 font-semibold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Invalid / skipped: {csvState.invalidEmails.slice(0, 5).join(', ')}
                          {csvState.invalidEmails.length > 5 && ` +${csvState.invalidEmails.length - 5} more`}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Recipient preview toggle */}
                {csvState && csvState.validEmails.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowRecipientPreview(v => !v)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors"
                    >
                      {showRecipientPreview ? (
                        <><EyeOff className="w-3.5 h-3.5" /> Hide recipient list</>
                      ) : (
                        <><Eye className="w-3.5 h-3.5" /> Review {csvState.validEmails.length} recipients</>
                      )}
                      {showRecipientPreview ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {showRecipientPreview && (
                      <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden">
                        <div className="bg-gray-50 px-3 py-2 flex items-center justify-between border-b border-gray-200">
                          <span className="text-[11px] font-semibold text-gray-700">
                            {csvState.validEmails.length} confirmed recipients
                          </span>
                          <button
                            type="button"
                            onClick={clearCsv}
                            className="flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-700 font-semibold"
                          >
                            <Trash2 className="w-3 h-3" /> Clear all
                          </button>
                        </div>
                        <div className="max-h-36 overflow-y-auto p-2 space-y-0.5">
                          {csvState.validEmails.map((email, i) => (
                            <div
                              key={email}
                              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 group"
                            >
                              <span className="text-[10px] text-gray-400 font-mono w-5 text-right flex-shrink-0">
                                {i + 1}
                              </span>
                              <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                              <span className="text-xs text-gray-800 font-mono flex-1 truncate">{email}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Recipient error */}
            {errors.recipients && (
              <p className="mt-2 text-[11px] text-rose-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 flex-shrink-0" /> {errors.recipients}
              </p>
            )}
          </div>
        </div>

        {/* ── Row 5: Scheduling + Rate Limiting ── */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold text-gray-900">
            <Calendar className="w-4 h-4 text-primary-600" />
            Scheduling & Rate Limiting
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Start date & time */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Start Date & Time <span className="text-rose-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={e => { setStartTime(e.target.value); setErrors(p => ({ ...p, startTime: '' })) }}
                disabled={sendMode === 'immediate'}
                className={`w-full text-xs rounded-xl border bg-white px-2.5 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:bg-gray-100 ${
                  errors.startTime ? 'border-rose-400' : 'border-gray-300'
                }`}
              />
              {errors.startTime && (
                <p className="mt-1 text-[11px] text-rose-600">{errors.startTime}</p>
              )}
              {sendMode === 'immediate' && (
                <p className="mt-1 text-[11px] text-gray-400">Emails send immediately</p>
              )}
            </div>

            {/* Delay between emails */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Delay Between Emails (sec)
              </label>
              <input
                type="number"
                min="0"
                max="3600"
                value={delaySeconds}
                onChange={e => { setDelaySeconds(Number(e.target.value)); setErrors(p => ({ ...p, delay: '' })) }}
                className={`w-full text-xs rounded-xl border bg-white px-2.5 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                  errors.delay ? 'border-rose-400' : 'border-gray-300'
                }`}
              />
              {errors.delay && (
                <p className="mt-1 text-[11px] text-rose-600">{errors.delay}</p>
              )}
              <p className="mt-1 text-[11px] text-gray-400">Space between consecutive sends</p>
            </div>

            {/* Max emails per hour */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Max Emails per Hour
              </label>
              <input
                type="number"
                min="1"
                max="10000"
                value={hourlyLimit}
                onChange={e => {
                  setHourlyLimit(e.target.value ? Number(e.target.value) : '')
                  setErrors(p => ({ ...p, hourlyLimit: '' }))
                }}
                placeholder="e.g. 50"
                className={`w-full text-xs rounded-xl border bg-white px-2.5 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                  errors.hourlyLimit ? 'border-rose-400' : 'border-gray-300'
                }`}
              />
              {errors.hourlyLimit && (
                <p className="mt-1 text-[11px] text-rose-600">{errors.hourlyLimit}</p>
              )}
              <p className="mt-1 text-[11px] text-gray-400">Rate-limited via Redis Lua scripts</p>
            </div>
          </div>

          {/* Info footer */}
          <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
            <span>
              Each email gets its own <strong>BullMQ delayed job</strong> with a deterministic job ID.
              Jobs survive server restarts — no duplicate scheduling even after crashes.
              Rate limiting is enforced atomically across all workers via Redis Lua.
            </span>
          </div>
        </div>

        {/* ── Summary banner ── */}
        {finalRecipients.length > 0 && subject && body && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <div className="text-xs text-emerald-800">
              <span className="font-semibold">Ready to schedule</span>
              {' — '}
              <span className="font-bold">{finalRecipients.length} email{finalRecipients.length !== 1 ? 's' : ''}</span>
              {' via '}
              <span className="font-semibold">
                {senders.find(s => s.id === senderId)?.email || 'Default Dispatcher'}
              </span>
              {sendMode === 'scheduled' && startTime
                ? ` starting ${new Date(startTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : ' immediately'}
              {delaySeconds > 0 ? `, ${delaySeconds}s apart` : ''}
              {hourlyLimit ? `, max ${hourlyLimit}/hr` : ''}
              .
            </div>
          </div>
        )}

      </form>
    </Modal>
  )
}

export default ComposeModal

import React, { useState, useEffect, useCallback } from 'react'
import {
  Mail,
  Clock,
  CheckCircle2,
  Calendar,
  Search,
  RefreshCw,
  Plus,
  ExternalLink,
  Eye,
  Trash2,
  AlertCircle,
  Inbox,
  Filter,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'
import { Email, Sender } from '../types'
import { useModal } from '../context/ModalContext'
import Button from '../components/ui/Button'
import StatusBadge from '../components/ui/StatusBadge'
import Table from '../components/ui/Table'
import EmailDetailsModal from '../components/EmailDetailsModal'
import SlackIntegrationCard from '../components/SlackIntegrationCard'

export default function DashboardPage() {
  const { openComposeModal, refreshTrigger } = useModal()

  const [emails, setEmails] = useState<Email[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'scheduled' | 'sent' | 'failed'>('all')

  // Selected email for inspection modal
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  // Fetch real data from backend APIs
  const fetchDashboardData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    else setRefreshing(true)

    try {
      const [emailsRes, sendersRes] = await Promise.all([
        api.get('/emails?limit=100'),
        api.get('/senders').catch(() => ({ data: { data: [] } })),
      ])

      const emailList = emailsRes.data?.data || []
      setEmails(emailList)

      const senderList = sendersRes.data?.data || sendersRes.data?.senders || []
      setSenders(senderList)
    } catch (err: any) {
      console.error('Error fetching dashboard data:', err)
      toast.error('Failed to load latest email records')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboardData()
  }, [fetchDashboardData, refreshTrigger])

  // Periodic polling for queue progress every 15s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDashboardData(true)
    }, 15000)
    return () => clearInterval(interval)
  }, [fetchDashboardData])

  // Cancel scheduled email
  const handleCancelEmail = async (emailId: string) => {
    if (!window.confirm('Cancel this scheduled email from the BullMQ queue?')) {
      return
    }

    try {
      const res = await api.delete(`/emails/${emailId}`)
      if (res.data?.success) {
        toast.success('Scheduled email cancelled successfully')
        fetchDashboardData(true)
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to cancel email')
    }
  }

  // Filter emails based on search query and active tab
  const filteredEmails = emails.filter((email) => {
    // Search query matching
    const q = searchQuery.toLowerCase().trim()
    const matchesSearch =
      !q ||
      email.recipient.toLowerCase().includes(q) ||
      email.subject.toLowerCase().includes(q) ||
      email.body.toLowerCase().includes(q)

    if (!matchesSearch) return false

    // Tab filter matching
    if (activeTab === 'scheduled') return email.status === 'scheduled' || email.status === 'processing'
    if (activeTab === 'sent') return email.status === 'sent'
    if (activeTab === 'failed') return email.status === 'failed'
    return true
  })

  // Segregate into scheduled and sent sets for dashboard sections
  const scheduledEmails = filteredEmails.filter(
    (e) => e.status === 'scheduled' || e.status === 'processing'
  )
  const sentEmails = filteredEmails.filter((e) => e.status === 'sent')
  const failedEmails = filteredEmails.filter((e) => e.status === 'failed')

  // Top metric stats
  const totalCount = emails.length
  const totalScheduled = emails.filter((e) => e.status === 'scheduled' || e.status === 'processing').length
  const totalSent = emails.filter((e) => e.status === 'sent').length
  const activeSendersCount = senders.filter((s) => s.enabled).length

  // Helper for human-readable relative time
  const formatTime = (dateStr?: string | null) => {
    if (!dateStr) return '—'
    const date = new Date(dateStr)
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Table columns definition
  const tableColumns = [
    { key: 'recipient', label: 'Recipient', className: 'w-1/4' },
    { key: 'subject', label: 'Subject', className: 'w-1/3' },
    { key: 'time', label: 'Scheduled / Sent Time', className: 'w-1/5' },
    { key: 'status', label: 'Status', className: 'w-1/8' },
    { key: 'actions', label: 'Actions', className: 'w-24 text-right' },
  ]

  const renderEmailRow = (email: Email) => (
    <tr
      key={email.id}
      className="hover:bg-gray-50/80 transition-colors group cursor-pointer"
      onClick={() => {
        setSelectedEmail(email)
        setIsDetailsOpen(true)
      }}
    >
      {/* Recipient */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center font-bold text-xs group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors">
            {email.recipient.charAt(0).toUpperCase()}
          </div>
          <span className="font-medium text-gray-900 truncate max-w-[200px]" title={email.recipient}>
            {email.recipient}
          </span>
        </div>
      </td>

      {/* Subject */}
      <td className="px-5 py-3.5">
        <div className="truncate max-w-[320px]">
          <span className="font-semibold text-gray-900">{email.subject}</span>
          <span className="text-gray-400 text-xs ml-1.5 truncate">
            — {email.body.replace(/<[^>]*>/g, '').slice(0, 60)}
          </span>
        </div>
      </td>

      {/* Time */}
      <td className="px-5 py-3.5 text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <span>{email.status === 'sent' ? formatTime(email.sentAt) : formatTime(email.scheduledAt)}</span>
        </div>
      </td>

      {/* Status Badge */}
      <td className="px-5 py-3.5">
        <StatusBadge status={email.status} />
      </td>

      {/* Actions */}
      <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1.5">
          {email.previewUrl && (
            <a
              href={email.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open email preview in Ethereal"
              className="p-1.5 rounded-lg text-primary-600 hover:bg-primary-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          <button
            onClick={() => {
              setSelectedEmail(email)
              setIsDetailsOpen(true)
            }}
            title="Inspect Email Details"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Eye className="w-4 h-4" />
          </button>

          {email.status === 'scheduled' && (
            <button
              onClick={() => handleCancelEmail(email.id)}
              title="Cancel Scheduled Email"
              className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      {/* ── Top Metric Cards (Figma Style Overview) ────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Card 1: Scheduled Emails */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Scheduled Queue
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{totalScheduled}</span>
            <span className="text-xs text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded-md">
              Waiting in BullMQ
            </span>
          </div>
        </div>

        {/* Card 2: Sent Emails */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Sent Emails
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{totalSent}</span>
            <span className="text-xs text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-md">
              Delivered via SMTP
            </span>
          </div>
        </div>

        {/* Card 3: Active Senders */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Active Senders
            </span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{activeSendersCount}</span>
            <span className="text-xs text-indigo-700 font-medium bg-indigo-50 px-2 py-0.5 rounded-md">
              Identities Ready
            </span>
          </div>
        </div>

        {/* Card 4: Total Records */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Total Managed
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-primary-600 flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{totalCount}</span>
            <span className="text-xs text-gray-500 font-medium">Lifetime records</span>
          </div>
        </div>
      </div>

      {/* ── Action Toolbar & Search / Filters ───────────────────── */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-gray-100/80 self-start">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'all'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            All Emails ({totalCount})
          </button>
          <button
            onClick={() => setActiveTab('scheduled')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'scheduled'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            Scheduled ({totalScheduled})
          </button>
          <button
            onClick={() => setActiveTab('sent')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'sent'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            Sent ({totalSent})
          </button>
          {failedEmails.length > 0 && (
            <button
              onClick={() => setActiveTab('failed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'failed'
                  ? 'bg-white text-rose-600 shadow-xs'
                  : 'text-gray-500 hover:text-rose-600'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
              Failed ({failedEmails.length})
            </button>
          )}
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 md:w-64">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter emails..."
              className="w-full text-xs bg-gray-50 focus:bg-white text-gray-900 pl-8 pr-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>

          <button
            onClick={() => fetchDashboardData(false)}
            disabled={loading || refreshing}
            title="Refresh Table"
            className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing || loading ? 'animate-spin' : ''}`} />
          </button>

          <Button
            variant="primary"
            size="sm"
            onClick={openComposeModal}
            icon={<Plus className="w-4 h-4" />}
            className="font-semibold shadow-xs"
          >
            Compose New Email
          </Button>
        </div>
      </div>

      {/* ── Tabbed View / Specific Sections ─────────────────────── */}
      {activeTab === 'all' ? (
        // Stacked View showing both Scheduled & Sent Sections
        <div className="space-y-8">
          {/* Section 1: Scheduled Emails */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <h2 className="text-base font-bold text-gray-900">Scheduled Emails</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {scheduledEmails.length}
                </span>
              </div>
              <span className="text-xs text-gray-400">Waiting for dispatch window in Redis</span>
            </div>

            <Table
              columns={tableColumns}
              loading={loading}
              empty={scheduledEmails.length === 0}
              emptyTitle="No scheduled emails in queue"
              emptyMessage="All queued emails have been dispatched or no campaigns are currently pending."
              emptyAction={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={openComposeModal}
                  icon={<Plus className="w-4 h-4" />}
                >
                  Schedule Your First Email
                </Button>
              }
            >
              {scheduledEmails.map(renderEmailRow)}
            </Table>
          </div>

          {/* Section 2: Sent Emails */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h2 className="text-base font-bold text-gray-900">Sent Emails</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {sentEmails.length}
                </span>
              </div>
              <span className="text-xs text-gray-400">Delivered via Ethereal SMTP</span>
            </div>

            <Table
              columns={tableColumns}
              loading={loading}
              empty={sentEmails.length === 0}
              emptyTitle="No sent emails yet"
              emptyMessage="Emails that have completed transmission will appear here with delivery details and Ethereal preview links."
              emptyAction={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openComposeModal}
                  icon={<Plus className="w-4 h-4" />}
                >
                  Send an Email Now
                </Button>
              }
            >
              {sentEmails.map(renderEmailRow)}
            </Table>
          </div>
        </div>
      ) : (
        // Dedicated Tab View
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 capitalize">
              {activeTab} Emails ({filteredEmails.length})
            </h2>
            <span className="text-xs text-gray-400">Filtered view</span>
          </div>

          <Table
            columns={tableColumns}
            loading={loading}
            empty={filteredEmails.length === 0}
            emptyTitle={`No ${activeTab} emails found`}
            emptyMessage={`There are currently no email records matching "${activeTab}".`}
            emptyAction={
              <Button
                variant="primary"
                size="sm"
                onClick={openComposeModal}
                icon={<Plus className="w-4 h-4" />}
              >
                Compose New Email
              </Button>
            }
          >
            {filteredEmails.map(renderEmailRow)}
          </Table>
        </div>
      )}

      {/* ── Slack Integration Card at Bottom ───────────────────── */}
      <div className="pt-4">
        <SlackIntegrationCard />
      </div>

      {/* ── Inspection Details Modal ───────────────────────────── */}
      <EmailDetailsModal
        email={selectedEmail}
        isOpen={isDetailsOpen}
        onClose={() => {
          setIsDetailsOpen(false)
          setSelectedEmail(null)
        }}
        onCancelled={() => fetchDashboardData(true)}
      />
    </div>
  )
}

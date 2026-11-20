import React, { useState, useEffect } from 'react'
import { Search, RefreshCw, Plus, ExternalLink, Eye } from 'lucide-react'
import api from '../services/api'
import { Email } from '../types'
import { useModal } from '../context/ModalContext'
import Button from '../components/ui/Button'
import StatusBadge from '../components/ui/StatusBadge'
import Table from '../components/ui/Table'
import EmailDetailsModal from '../components/EmailDetailsModal'

export default function EmailsPage() {
  const { openComposeModal, refreshTrigger } = useModal()
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  const fetchEmails = async () => {
    setLoading(true)
    try {
      const res = await api.get('/emails?limit=100')
      setEmails(res.data?.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEmails()
  }, [refreshTrigger])

  const filtered = emails.filter((e) => {
    const q = search.toLowerCase().trim()
    const matchSearch =
      !q ||
      e.recipient.toLowerCase().includes(q) ||
      e.subject.toLowerCase().includes(q) ||
      e.body.toLowerCase().includes(q)

    if (!matchSearch) return false
    if (statusFilter !== 'all' && e.status !== statusFilter) return false
    return true
  })

  const columns = [
    { key: 'recipient', label: 'Recipient', className: 'w-1/4' },
    { key: 'subject', label: 'Subject', className: 'w-1/3' },
    { key: 'date', label: 'Date', className: 'w-1/5' },
    { key: 'status', label: 'Status', className: 'w-1/8' },
    { key: 'actions', label: 'Actions', className: 'w-24 text-right' },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Email Repository</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Complete history of scheduled, processing, sent, and failed email dispatches.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchEmails}
            disabled={loading}
            className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Button variant="primary" size="sm" onClick={openComposeModal} icon={<Plus className="w-4 h-4" />}>
            Compose Email
          </Button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-white p-3 rounded-2xl border border-gray-200/80 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by recipient, subject, or body..."
            className="w-full text-xs pl-9 pr-3 py-2 bg-gray-50 focus:bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="scheduled">Scheduled Only</option>
          <option value="sent">Sent Only</option>
          <option value="failed">Failed Only</option>
        </select>
      </div>

      {/* Table */}
      <Table
        columns={columns}
        loading={loading}
        empty={filtered.length === 0}
        emptyTitle="No email records found"
        emptyMessage="Try adjusting your search query or schedule your first email."
        emptyAction={
          <Button variant="primary" size="sm" onClick={openComposeModal} icon={<Plus className="w-4 h-4" />}>
            Compose New Email
          </Button>
        }
      >
        {filtered.map((email) => (
          <tr
            key={email.id}
            onClick={() => {
              setSelectedEmail(email)
              setIsDetailsOpen(true)
            }}
            className="hover:bg-gray-50/80 transition-colors cursor-pointer group"
          >
            <td className="px-5 py-3.5 font-medium text-gray-900">{email.recipient}</td>
            <td className="px-5 py-3.5 truncate max-w-xs">{email.subject}</td>
            <td className="px-5 py-3.5 text-xs text-gray-500">
              {new Date(email.sentAt || email.scheduledAt).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </td>
            <td className="px-5 py-3.5">
              <StatusBadge status={email.status} />
            </td>
            <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-end gap-1.5">
                {email.previewUrl && (
                  <a
                    href={email.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg"
                    title="View in Ethereal"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <button
                  onClick={() => {
                    setSelectedEmail(email)
                    setIsDetailsOpen(true)
                  }}
                  className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <EmailDetailsModal
        email={selectedEmail}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        onCancelled={fetchEmails}
      />
    </div>
  )
}

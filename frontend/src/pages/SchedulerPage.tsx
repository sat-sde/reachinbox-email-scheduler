import React, { useState, useEffect } from 'react'
import { Calendar, Plus, Mail, Shield, CheckCircle, RefreshCw, Clock } from 'lucide-react'
import api from '../services/api'
import { Sender } from '../types'
import { useModal } from '../context/ModalContext'
import Button from '../components/ui/Button'
import Table from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import toast from 'react-hot-toast'

export default function SchedulerPage() {
  const { openComposeModal } = useModal()
  const [senders, setSenders] = useState<Sender[]>([])
  const [loading, setLoading] = useState(true)
  const [isAddSenderOpen, setIsAddSenderOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  // New sender form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [hourlyLimit, setHourlyLimit] = useState(50)

  const fetchSenders = async () => {
    setLoading(true)
    try {
      const res = await api.get('/senders')
      setSenders(res.data?.data || res.data?.senders || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSenders()
  }, [])

  const handleCreateSender = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) {
      toast.error('Name and email are required')
      return
    }

    setCreating(true)
    try {
      const res = await api.post('/senders', {
        name: name.trim(),
        email: email.trim(),
        hourlyLimit: Number(hourlyLimit),
      })
      if (res.data?.success) {
        toast.success('Sender registered with Ethereal SMTP credentials!')
        setName('')
        setEmail('')
        setIsAddSenderOpen(false)
        fetchSenders()
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to register sender')
    } finally {
      setCreating(false)
    }
  }

  const columns = [
    { key: 'name', label: 'Sender Identity', className: 'w-1/3' },
    { key: 'email', label: 'SMTP Email', className: 'w-1/3' },
    { key: 'limit', label: 'Hourly Quota', className: 'w-1/6' },
    { key: 'status', label: 'Status', className: 'w-1/6 text-right' },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Campaigns & Sender Identities</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure SMTP dispatch identities and rate limiting quotas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddSenderOpen(true)}
            icon={<Plus className="w-4 h-4" />}
          >
            Add New Sender
          </Button>
          <Button variant="primary" size="sm" onClick={openComposeModal} icon={<Calendar className="w-4 h-4" />}>
            Schedule Campaign
          </Button>
        </div>
      </div>

      {/* Senders Table */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-600" />
          <span>Configured Senders ({senders.length})</span>
        </h3>

        <Table
          columns={columns}
          loading={loading}
          empty={senders.length === 0}
          emptyTitle="No sender identities found"
          emptyMessage="Add an Ethereal SMTP sender identity to schedule and dispatch emails."
          emptyAction={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsAddSenderOpen(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              Add Your First Sender
            </Button>
          }
        >
          {senders.map((s) => (
            <tr key={s.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-5 py-3.5 font-semibold text-gray-900">{s.name}</td>
              <td className="px-5 py-3.5 font-mono text-xs text-gray-600">{s.email}</td>
              <td className="px-5 py-3.5 text-xs text-gray-700 font-medium">
                {s.hourlyLimit} emails / hr
              </td>
              <td className="px-5 py-3.5 text-right">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle className="w-3 h-3 text-emerald-600" /> Enabled
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </div>

      {/* Add Sender Modal */}
      <Modal
        isOpen={isAddSenderOpen}
        onClose={() => setIsAddSenderOpen(false)}
        size="md"
        title="Add New Sender Identity"
        subtitle="Generates automated secure Ethereal SMTP credentials for test dispatching."
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" size="sm" onClick={() => setIsAddSenderOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={creating} onClick={handleCreateSender}>
              Save Sender
            </Button>
          </div>
        }
      >
        <form onSubmit={handleCreateSender} className="space-y-4">
          <Input
            label="Sender Display Name"
            required
            placeholder="E.g. Sales Outreach"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Sender Email Address"
            required
            type="email"
            placeholder="E.g. sales@mycompany.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Hourly Sending Limit (Rate Limit)"
            type="number"
            min="1"
            max="10000"
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(Number(e.target.value))}
            helperText="Maximum emails this identity can dispatch per sliding hour before BullMQ delays subsequent jobs."
          />
        </form>
      </Modal>
    </div>
  )
}

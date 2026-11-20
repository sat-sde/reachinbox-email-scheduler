import React, { useState, useEffect } from 'react'
import {
  Settings,
  Database,
  Server,
  Activity,
  Layers,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Shield,
  User,
  Sliders,
  Bell,
  Cpu,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import SlackIntegrationCard from '../components/SlackIntegrationCard'
import Button from '../components/ui/Button'

interface HealthState {
  status: string
  service: string
  uptime: string
  database: { status: string; type?: string }
  redis: { status: string }
  elasticsearch: { status: string }
  system: {
    nodeVersion: string
    memoryUsage: { rss: string; heapUsed: string }
  }
}

export default function SettingsPage() {
  const { user, logout } = useAuth()
  const [health, setHealth] = useState<HealthState | null>(null)
  const [loadingHealth, setLoadingHealth] = useState(true)

  const fetchHealth = async () => {
    setLoadingHealth(true)
    try {
      const res = await api.get('/health')
      setHealth(res.data)
    } catch (err: any) {
      console.error('Failed to fetch health status:', err)
      toast.error('Unable to retrieve infrastructure health')
    } finally {
      setLoadingHealth(false)
    }
  }

  useEffect(() => {
    fetchHealth()
  }, [])

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary-600" />
          Settings & Infrastructure
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Monitor distributed queues, manage external integrations, and review account security.
        </p>
      </div>

      {/* Grid: Account Profile & Bull Board Monitor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* User Account Details */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <User className="w-4 h-4 text-primary-600" />
              Authenticated Account
            </h3>
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60 flex items-center gap-1">
              <Shield className="w-3 h-3 text-emerald-600" /> Real OAuth 2.0
            </span>
          </div>

          <div className="flex items-center gap-4 pt-2">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="w-14 h-14 rounded-2xl object-cover border-2 border-gray-100 shadow-sm"
              />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-lg">
                {user?.name?.charAt(0) || 'U'}
              </div>
            )}
            <div>
              <div className="text-base font-bold text-gray-900 leading-tight">{user?.name || 'Authorized User'}</div>
              <div className="text-xs text-gray-500 mt-0.5">{user?.email || 'user@example.com'}</div>
              <div className="text-[11px] text-gray-400 font-mono mt-1">
                ID: {user?.id?.slice(0, 18) || 'local-session'}…
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">Session via Secure HTTP-only JWT Cookie</span>
            <Button variant="outline" size="sm" onClick={logout}>
              Sign Out
            </Button>
          </div>
        </div>

        {/* Bull Board & Queue Monitoring Quick Link */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-500" />
                Bull Board Queue Dashboard
              </h3>
              <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/60">
                Port 4000
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              Inspect active, waiting, completed, delayed, and failed BullMQ jobs. Bull Board provides real-time
              telemetry over the <code className="font-mono text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">email-queue</code> Redis backing store.
            </p>
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">Route: /admin/queues</span>
            <a
              href="http://localhost:4000/admin/queues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors"
            >
              <span>Open Queue Inspector</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Real-time Infrastructure Health */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              Live Infrastructure Telemetry
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Heartbeats queried in real-time from the backend health check API.
            </p>
          </div>

          <button
            onClick={fetchHealth}
            disabled={loadingHealth}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* PostgreSQL */}
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-600" /> PostgreSQL 16
              </span>
              {health?.database.status === 'connected' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              )}
            </div>
            <div className="mt-2 text-sm font-bold text-gray-900">
              {health?.database.status === 'connected' ? 'Connected (Port 5432)' : 'Unavailable'}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">Prisma ORM with pooling</p>
          </div>

          {/* Redis */}
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-rose-600" /> Redis 7
              </span>
              {health?.redis.status === 'connected' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              )}
            </div>
            <div className="mt-2 text-sm font-bold text-gray-900">
              {health?.redis.status === 'connected' ? 'Active (Port 6379)' : 'Unavailable'}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">BullMQ & Lua Rate Limiting</p>
          </div>

          {/* Elasticsearch */}
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-600" /> Elasticsearch 8
              </span>
              {health?.elasticsearch.status === 'connected' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              )}
            </div>
            <div className="mt-2 text-sm font-bold text-gray-900">
              {health?.elasticsearch.status === 'connected' ? 'Indexed (Port 9200)' : 'Unavailable'}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">Full-text search engine</p>
          </div>

          {/* Node.js Runtime */}
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-purple-600" /> Process Runtime
              </span>
              <span className="text-[11px] font-mono text-gray-400">{health?.system.nodeVersion || 'Node 22'}</span>
            </div>
            <div className="mt-2 text-sm font-bold text-gray-900">
              Uptime: {health?.uptime || '—'}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Memory: {health?.system.memoryUsage.rss || '—'} RSS
            </p>
          </div>
        </div>
      </div>

      {/* Scheduler & Rate Limiting System Settings */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-600" />
          Scheduler Engine Rules & Concurrency Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/40">
            <div className="text-xs font-semibold text-gray-700">WORKER_CONCURRENCY</div>
            <div className="text-lg font-bold text-gray-900 mt-1">5 parallel jobs</div>
            <p className="text-[11px] text-gray-500 mt-1">
              Separate worker thread concurrency processing delayed queues simultaneously.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/40">
            <div className="text-xs font-semibold text-gray-700">MIN_DELAY_BETWEEN_EMAILS</div>
            <div className="text-lg font-bold text-gray-900 mt-1">2,000 ms</div>
            <p className="text-[11px] text-gray-500 mt-1">
              Global inter-email delay enforced atomically across concurrent worker nodes.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/40">
            <div className="text-xs font-semibold text-gray-700">DEFAULT_HOURLY_LIMIT</div>
            <div className="text-lg font-bold text-gray-900 mt-1">50 emails / hr / sender</div>
            <p className="text-[11px] text-gray-500 mt-1">
              Redis Lua atomic sliding window bucket preventing rate limit violations.
            </p>
          </div>
        </div>
      </div>

      {/* Slack Integration Card */}
      <SlackIntegrationCard />
    </div>
  )
}

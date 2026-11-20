import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Unlink,
  Send,
  Loader2,
  RefreshCw,
  BellRing,
} from 'lucide-react'
import api from '../services/api'

interface SlackConnectionData {
  id: string
  teamId: string
  teamName: string | null
  channelName: string | null
  channelId: string | null
  connectedAt: string
}

export default function SlackIntegrationCard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [connection, setConnection] = useState<SlackConnectionData | null>(null)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // 1. Check URL parameters for OAuth redirect feedback
  useEffect(() => {
    const slackParam = searchParams.get('slack')
    const messageParam = searchParams.get('message')

    if (slackParam === 'connected') {
      setBanner({
        type: 'success',
        message: 'Slack workspace connected successfully! Rate limit alerts are now active.',
      })
      // Clear URL params
      searchParams.delete('slack')
      setSearchParams(searchParams, { replace: true })
    } else if (slackParam === 'error') {
      setBanner({
        type: 'error',
        message: messageParam || 'Failed to connect Slack workspace. Please try again.',
      })
      searchParams.delete('slack')
      searchParams.delete('message')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // 2. Fetch current Slack connection status
  const fetchStatus = async () => {
    setLoading(true)
    try {
      const res = await api.get('/slack/status')
      if (res.data && res.data.success) {
        setConnected(res.data.connected)
        setConnection(res.data.connection || null)
      }
    } catch (err) {
      console.error('Failed to fetch Slack status:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  // 3. Initiate Slack OAuth
  const handleConnect = () => {
    // Navigate directly to the backend Slack OAuth connect endpoint
    window.location.href = '/api/slack/connect'
  }

  // 4. Disconnect Slack
  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect your Slack workspace? You will no longer receive hourly rate limit alerts.')) {
      return
    }

    setDisconnecting(true)
    try {
      const res = await api.post('/slack/disconnect')
      if (res.data && res.data.success) {
        setConnected(false)
        setConnection(null)
        setBanner({
          type: 'success',
          message: 'Slack workspace disconnected.',
        })
      }
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err.response?.data?.message || 'Failed to disconnect Slack',
      })
    } finally {
      setDisconnecting(false)
    }
  }

  // 5. Send Test Notification
  const handleTestAlert = async () => {
    setTesting(true)
    try {
      const res = await api.post('/slack/test')
      if (res.data && res.data.success) {
        setBanner({
          type: 'success',
          message: 'Test alert sent to your Slack channel successfully! Check Slack.',
        })
      }
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err.response?.data?.error || err.message || 'Failed to send test message to Slack',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
      {/* Banner Notifications */}
      {banner && (
        <div
          className={`px-6 py-3.5 flex items-center justify-between text-sm ${
            banner.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-100'
              : 'bg-rose-50 text-rose-800 border-b border-rose-100'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            )}
            <span>{banner.message}</span>
          </div>
          <button
            onClick={() => setBanner(null)}
            className="text-xs font-semibold hover:underline opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-gray-100">
          <div className="flex items-center gap-4">
            {/* Slack SVG Icon */}
            <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center p-2.5 shadow-sm shadow-slate-900/10">
              <svg viewBox="0 0 127 127" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                <path d="M27.2 79.9a13.6 13.6 0 1 1-13.6-13.6h13.6v13.6zm6.8 0a13.6 13.6 0 1 1 27.2 0v34a13.6 13.6 0 1 1-27.2 0v-34z" fill="#E01E5A"/>
                <path d="M47.6 27.2a13.6 13.6 0 1 1 13.6-13.6v13.6H47.6zm0 6.8a13.6 13.6 0 1 1 0 27.2h-34a13.6 13.6 0 1 1 0-27.2h34z" fill="#36C5F0"/>
                <path d="M99.8 47.6a13.6 13.6 0 1 1 13.6 13.6H99.8V47.6zm-6.8 0a13.6 13.6 0 1 1-27.2 0v-34a13.6 13.6 0 1 1 27.2 0v34z" fill="#2EB67D"/>
                <path d="M79.4 99.8a13.6 13.6 0 1 1-13.6 13.6V99.8h13.6zm0-6.8a13.6 13.6 0 1 1 0-27.2h34a13.6 13.6 0 1 1 0 27.2h-34z" fill="#ECB22E"/>
              </svg>
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-bold text-gray-900">Slack Notifications</h3>
                {loading ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    <Loader2 className="w-3 h-3 animate-spin" /> Checking...
                  </span>
                ) : connected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                    Not Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Instant alerts via Slack Web API whenever an email sender reaches their hourly rate limit.
              </p>
            </div>
          </div>

          {/* Quick Refresh Button */}
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="self-start sm:self-center p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            title="Refresh status"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Content Body */}
        <div className="mt-5">
          {loading ? (
            <div className="py-6 flex items-center justify-center text-sm text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Checking Slack integration status...</span>
            </div>
          ) : connected && connection ? (
            <div className="space-y-4">
              {/* Connected Workspace Details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-gray-50/80 border border-gray-200/60 text-xs">
                <div>
                  <span className="text-gray-400 font-medium">Workspace Team:</span>
                  <p className="font-semibold text-gray-800 mt-0.5">
                    {connection.teamName || connection.teamId || 'Default Team'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-400 font-medium">Alert Destination:</span>
                  <p className="font-semibold text-gray-800 mt-0.5 flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-primary-600" />
                    {connection.channelName || 'Direct Message'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-400 font-medium">Connected On:</span>
                  <p className="font-semibold text-gray-800 mt-0.5">
                    {new Date(connection.connectedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestAlert}
                    disabled={testing}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50"
                  >
                    {testing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    Send Test Alert
                  </button>
                  <span className="text-[11px] text-gray-400">
                    Posts a test message to your designated Slack channel.
                  </span>
                </div>

                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors disabled:opacity-50"
                >
                  {disconnecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Unlink className="w-3.5 h-3.5" />
                  )}
                  Disconnect Slack
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-gray-50 border border-dashed border-gray-300">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <BellRing className="w-4 h-4 text-primary-600" />
                  Receive Real-Time Rate Limit Notifications
                </p>
                <p className="text-xs text-gray-500 max-w-xl">
                  Connect your Slack workspace using OAuth 2.0. When an email sender hits its hourly dispatch quota, ReachInbox will immediately notify you with the sender email, limit, and next available sending slot.
                </p>
              </div>

              <button
                onClick={handleConnect}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-md shadow-slate-900/10 transition-all flex-shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Connect Slack
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


import React, { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AlertCircle, Mail, Sparkles } from 'lucide-react'

export default function LoginPage() {
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setAuthError(decodeURIComponent(errorParam))
    }
  }, [searchParams])

  // If already logged in, redirect directly to dashboard
  if (!loading && user) {
    return <Navigate to="/dashboard" replace />
  }

  const handleGoogleLogin = () => {
    setIsRedirecting(true)
    // Direct browser navigation to real Google OAuth 2.0 endpoint on backend
    window.location.href = '/auth/google'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-600 text-white shadow-lg shadow-primary-600/30 mb-4">
            <Mail className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">ReachInbox</h1>
          <p className="text-sm text-gray-600 mt-1">Full-Stack Email Job Scheduler</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 border border-gray-100 p-8">
          <div className="mb-6 text-center">
            <h2 className="text-xl font-semibold text-gray-900">Welcome Back</h2>
            <p className="text-sm text-gray-500 mt-1">Sign in with your Google account to manage scheduled emails</p>
          </div>

          {/* Error Notice */}
          {authError && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-800 text-sm">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Authentication Error</p>
                <p className="mt-0.5 text-xs text-red-700">{authError}</p>
                {authError.includes('not configured') && (
                  <p className="mt-1 text-xs text-gray-600">
                    Set <code className="bg-red-100 px-1 py-0.5 rounded text-red-900 font-mono">GOOGLE_CLIENT_ID</code> and{' '}
                    <code className="bg-red-100 px-1 py-0.5 rounded text-red-900 font-mono">GOOGLE_CLIENT_SECRET</code> in <code className="font-mono">backend/.env</code>.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Google OAuth Button */}
          <div className="space-y-4">
            <button
              onClick={handleGoogleLogin}
              disabled={isRedirecting}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 text-gray-800 font-medium rounded-xl border border-gray-300 shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed group"
            >
              {/* Google G Logo SVG */}
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{isRedirecting ? 'Connecting to Google...' : 'Continue with Google'}</span>
            </button>

            {/* Quick Demo Login (for browser inspection & test verification) */}
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-gray-200"></div>
              <span className="flex-shrink mx-3 text-[11px] text-gray-400 uppercase font-semibold">Or demo mode</span>
              <div className="flex-grow border-t border-gray-200"></div>
            </div>

            <a
              href="/auth/dev-login"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-xs font-semibold rounded-xl shadow-sm transition-all text-center"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary-400" />
              <span>Enter Dashboard as Demo User</span>
            </a>
          </div>

          {/* Security details badge */}
          <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-center gap-2 text-xs text-gray-500">
            <Sparkles className="w-4 h-4 text-primary-500" />
            <span>Secure HTTP-only cookie authentication</span>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-gray-500 mt-6">
          ReachInbox Intern Assignment • Real OAuth 2.0
        </p>
      </div>
    </div>
  )
}

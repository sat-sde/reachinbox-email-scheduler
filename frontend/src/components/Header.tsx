import React from 'react'
import { Plus, Search, LogOut, User as UserIcon } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Button from './ui/Button'

export interface HeaderProps {
  title?: string
  breadcrumb?: string
  searchQuery?: string
  onSearchChange?: (q: string) => void
  onComposeClick?: () => void
  showCompose?: boolean
  showSearch?: boolean
}

export const Header: React.FC<HeaderProps> = ({
  title = 'Dashboard',
  breadcrumb = 'ReachInbox',
  searchQuery = '',
  onSearchChange,
  onComposeClick,
  showCompose = true,
  showSearch = true,
}) => {
  const { user, logout } = useAuth()

  return (
    <header className="h-16 bg-white border-b border-gray-200 px-6 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
      {/* Left: Breadcrumbs / Title */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium text-gray-500 hidden sm:inline">{breadcrumb}</span>
        <span className="text-gray-300 hidden sm:inline">/</span>
        <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">{title}</h1>
      </div>

      {/* Middle: Quick Search Bar */}
      {showSearch && onSearchChange && (
        <div className="flex-1 max-w-md mx-4 hidden md:block">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by recipient, subject, or body..."
              className="w-full bg-gray-50 hover:bg-gray-100/80 focus:bg-white text-xs text-gray-900 pl-9 pr-4 py-2 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all placeholder:text-gray-400"
            />
          </div>
        </div>
      )}

      {/* Right: Primary Compose Button + User Info + Logout Button */}
      <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
        {showCompose && onComposeClick && (
          <Button
            variant="primary"
            size="sm"
            onClick={onComposeClick}
            icon={<Plus className="w-4 h-4" />}
            className="shadow-sm shadow-primary-600/30 font-semibold"
          >
            <span className="hidden sm:inline">Compose New Email</span>
            <span className="sm:hidden">Compose</span>
          </Button>
        )}

        {/* User Profile Card */}
        {user && (
          <div className="flex items-center gap-3 pl-2 sm:border-l sm:border-gray-200">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="w-9 h-9 rounded-full object-cover border border-gray-200 shadow-xs"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-xs border border-primary-200">
                {user.name ? user.name.charAt(0).toUpperCase() : <UserIcon size={16} />}
              </div>
            )}

            <div className="hidden lg:block text-left">
              <p className="text-xs font-semibold text-gray-900 leading-tight">{user.name}</p>
              <p className="text-[11px] text-gray-500 leading-tight truncate max-w-[150px]">{user.email}</p>
            </div>

            {/* Logout Button */}
            <button
              onClick={() => logout()}
              title="Sign Out"
              className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export default Header


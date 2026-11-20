import React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useModal } from '../context/ModalContext'

export default function Layout() {
  const { openComposeModal } = useModal()
  const location = useLocation()

  // Map route path to human-readable title
  const getPageInfo = () => {
    switch (location.pathname) {
      case '/dashboard':
        return { title: 'Overview & Email Scheduler', breadcrumb: 'Dashboard' }
      case '/emails':
        return { title: 'All Dispatched & Queued Emails', breadcrumb: 'Emails' }
      case '/scheduler':
        return { title: 'Automated Campaigns', breadcrumb: 'Scheduler' }
      case '/settings':
        return { title: 'Integrations & Workspace Settings', breadcrumb: 'Settings' }
      default:
        return { title: 'ReachInbox Dashboard', breadcrumb: 'Dashboard' }
    }
  }

  const { title, breadcrumb } = getPageInfo()

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* Reusable Sidebar Component */}
      <Sidebar />

      {/* Main Content Area with Header */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Reusable Header Component */}
        <Header
          title={title}
          breadcrumb={breadcrumb}
          onComposeClick={openComposeModal}
          showSearch={false} // Dashboard has its own dedicated search bar with status filters
        />

        {/* Scrollable Page Outlet */}
        <main className="flex-1 overflow-y-auto bg-gray-50/70 p-6 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

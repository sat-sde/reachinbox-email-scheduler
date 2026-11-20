import React, { createContext, useContext, useState, useCallback } from 'react'
import ComposeModal from '../components/ComposeModal'

interface ModalContextType {
  openComposeModal: () => void
  closeComposeModal: () => void
  triggerRefresh: () => void
  refreshTrigger: number
}

const ModalContext = createContext<ModalContextType | undefined>(undefined)

export const ModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isComposeOpen, setIsComposeOpen] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const openComposeModal = useCallback(() => setIsComposeOpen(true), [])
  const closeComposeModal = useCallback(() => setIsComposeOpen(false), [])
  const triggerRefresh = useCallback(() => setRefreshTrigger((prev) => prev + 1), [])

  return (
    <ModalContext.Provider
      value={{
        openComposeModal,
        closeComposeModal,
        triggerRefresh,
        refreshTrigger,
      }}
    >
      {children}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={closeComposeModal}
        onSuccess={triggerRefresh}
      />
    </ModalContext.Provider>
  )
}

export function useModal(): ModalContextType {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider')
  }
  return context
}


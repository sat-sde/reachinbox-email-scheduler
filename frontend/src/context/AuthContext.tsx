import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api from '../services/api'
import { User, AuthResponse } from '../types'
import toast from 'react-hot-toast'

interface AuthContextType {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
  refetchUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const fetchCurrentUser = useCallback(async (): Promise<void> => {
    try {
      const response = await api.get<AuthResponse>('/auth/me')
      if (response.data?.user) {
        setUser(response.data.user)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCurrentUser()
  }, [fetchCurrentUser])

  const logout = async (): Promise<void> => {
    try {
      await api.post('/auth/logout')
      setUser(null)
      toast.success('Logged out successfully')
      window.location.href = '/login'
    } catch (error) {
      console.error('Logout error:', error)
      setUser(null)
      window.location.href = '/login'
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        logout,
        refetchUser: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}


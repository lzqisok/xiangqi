import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  AccountApiError,
  AccountUser,
  beginAccountDeletion,
  clearAccountCredentials,
  login as loginRequest,
  logout as logoutRequest,
  restoreSession,
  updateProfile as updateProfileRequest,
} from './api'
import { configureCloudDocumentScope } from '../sync/cloudDocuments'

type AuthContextValue = {
  user: AccountUser | null
  loading: boolean
  available: boolean
  generation: number
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
  updateProfile(displayName: string): Promise<void>
  deleteAccount(currentPassword: string): Promise<void>
  refresh(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(true)
  const [generation, setGeneration] = useState(0)

  const replaceUser = useCallback((next: AccountUser | null) => {
    setUser((previous) => {
      if (previous?.id !== next?.id) {
        configureCloudDocumentScope(next?.id ?? null)
        setGeneration((value) => value + 1)
        window.dispatchEvent(
          new CustomEvent('xiangqi-auth-changed', {
            detail: { previousUserId: previous?.id ?? null, userId: next?.id ?? null },
          }),
        )
      }
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      replaceUser(await restoreSession())
      setAvailable(true)
    } catch (error) {
      replaceUser(null)
      clearAccountCredentials()
      setAvailable(!(error instanceof AccountApiError && [0, 404, 503].includes(error.status)))
    } finally {
      setLoading(false)
    }
  }, [replaceUser])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const expire = () => replaceUser(null)
    window.addEventListener('xiangqi-session-expired', expire)
    return () => window.removeEventListener('xiangqi-session-expired', expire)
  }, [replaceUser])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      available,
      generation,
      async login(email, password) {
        replaceUser(null)
        replaceUser(await loginRequest(email, password))
        setAvailable(true)
      },
      async logout() {
        replaceUser(null)
        await logoutRequest()
      },
      async updateProfile(displayName) {
        replaceUser(await updateProfileRequest(displayName))
      },
      async deleteAccount(currentPassword) {
        await beginAccountDeletion(currentPassword)
        replaceUser(null)
      },
      refresh,
    }),
    [available, generation, loading, refresh, replaceUser, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is missing')
  return value
}

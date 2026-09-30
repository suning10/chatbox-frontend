import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as authApi from '../api/auth'
import { readStorage, removeStorage, writeStorage } from '../lib/storage'

const STORAGE_KEY = 'chatbox.auth'

interface StoredAuth {
  token: string
  email: string
  id: number | null
  username: string | null
}

interface AuthContextValue {
  /** The USER token — for /auth/session(s) and /rag/* only. Chat endpoints need a session token instead. */
  userToken: string | null
  email: string | null
  username: string | null
  isAuthenticated: boolean
  busy: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, username?: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => readStorage<StoredAuth>(STORAGE_KEY))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const login = useCallback(async (email: string, password: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.login(email, password)
      // /login only returns a token (no user record) — the id/username aren't knowable client-side
      // without a /me endpoint, which this API doesn't have. The email is exactly what was just
      // typed and authenticated with, so it's a reliable-enough label for display purposes.
      const next: StoredAuth = { token: res.access_token, email, id: null, username: null }
      setAuth(next)
      writeStorage(STORAGE_KEY, next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
      throw err
    } finally {
      setBusy(false)
    }
  }, [])

  const register = useCallback(async (email: string, password: string, username?: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.register(email, password, username)
      const next: StoredAuth = { token: res.token.access_token, email: res.email, id: res.id, username: res.username }
      setAuth(next)
      writeStorage(STORAGE_KEY, next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
      throw err
    } finally {
      setBusy(false)
    }
  }, [])

  const logout = useCallback(() => {
    setAuth(null)
    removeStorage(STORAGE_KEY)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      userToken: auth?.token ?? null,
      email: auth?.email ?? null,
      username: auth?.username ?? null,
      isAuthenticated: auth !== null,
      busy,
      error,
      login,
      register,
      logout,
    }),
    [auth, busy, error, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

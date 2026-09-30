import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as authApi from '../api/auth'
import { readStorage, removeStorage, writeStorage } from '../lib/storage'
import { useAuth } from './AuthContext'

const ACTIVE_SESSION_KEY = 'chatbox.activeSession'

export interface SessionEntry {
  id: string
  name: string
  /** This session's own JWT — the only thing app/api/v1/chatbot.py's endpoints accept. */
  token: string
}

interface SessionContextValue {
  sessions: SessionEntry[]
  activeSessionId: string | null
  activeSession: SessionEntry | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  selectSession: (id: string) => void
  createSession: () => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const { userToken } = useAuth()
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => readStorage<string>(ACTIVE_SESSION_KEY))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!userToken) return
    setLoading(true)
    setError(null)
    try {
      let list = await authApi.listSessions(userToken)
      if (list.length === 0) {
        // Land every new (or previously session-less) user directly in a usable chat, rather than
        // an empty state whose only action is "create a session".
        list = [await authApi.createSession(userToken)]
      }
      const entries: SessionEntry[] = list.map((s) => ({ id: s.session_id, name: s.name, token: s.token.access_token }))
      setSessions(entries)
      setActiveSessionId((current) => {
        const preferred = current ?? readStorage<string>(ACTIVE_SESSION_KEY)
        return preferred && entries.some((e) => e.id === preferred) ? preferred : (entries[0]?.id ?? null)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions.')
    } finally {
      setLoading(false)
    }
  }, [userToken])

  useEffect(() => {
    if (userToken) {
      void refresh()
    } else {
      setSessions([])
      setActiveSessionId(null)
      removeStorage(ACTIVE_SESSION_KEY)
    }
  }, [userToken, refresh])

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id)
    writeStorage(ACTIVE_SESSION_KEY, id)
  }, [])

  const createSession = useCallback(async () => {
    if (!userToken) return
    setLoading(true)
    setError(null)
    try {
      const created = await authApi.createSession(userToken)
      const entry: SessionEntry = { id: created.session_id, name: created.name, token: created.token.access_token }
      setSessions((prev) => [entry, ...prev])
      selectSession(entry.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create a new chat.')
      throw err
    } finally {
      setLoading(false)
    }
  }, [userToken, selectSession])

  const renameSession = useCallback(
    async (id: string, name: string) => {
      const entry = sessions.find((s) => s.id === id)
      if (!entry) return
      setError(null)
      try {
        // The endpoint mints a fresh token on every rename; adopt it so future calls use the latest.
        const res = await authApi.renameSession(entry.token, id, name)
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, name: res.name, token: res.token.access_token } : s)),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to rename chat.')
        throw err
      }
    },
    [sessions],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      const entry = sessions.find((s) => s.id === id)
      if (!entry) return
      setLoading(true)
      setError(null)
      try {
        await authApi.deleteSession(entry.token, id)
        const remaining = sessions.filter((s) => s.id !== id)
        setSessions(remaining)
        if (activeSessionId === id) {
          const fallback = remaining[0]?.id ?? null
          setActiveSessionId(fallback)
          if (fallback) writeStorage(ACTIVE_SESSION_KEY, fallback)
          else removeStorage(ACTIVE_SESSION_KEY)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete chat.')
        throw err
      } finally {
        setLoading(false)
      }
    },
    [sessions, activeSessionId],
  )

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      sessions,
      activeSessionId,
      activeSession,
      loading,
      error,
      refresh,
      selectSession,
      createSession,
      renameSession,
      deleteSession,
    }),
    [sessions, activeSessionId, activeSession, loading, error, refresh, selectSession, createSession, renameSession, deleteSession],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSessions(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSessions must be used within a SessionProvider')
  return ctx
}

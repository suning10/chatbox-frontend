import { request } from './client'
import type { SessionResponse, TokenResponse, UserResponse } from './types'

export function register(email: string, password: string, username?: string): Promise<UserResponse> {
  return request<UserResponse>('/auth/register', {
    method: 'POST',
    json: { email, password, username: username || undefined },
  })
}

/** The backend's /login is form-encoded and modeled on an OAuth2 password grant. */
export function login(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    form: { email, password, grant_type: 'password' },
  })
}

/** List every chat session for the user — each entry carries a fresh, ready-to-use session token. */
export function listSessions(userToken: string): Promise<SessionResponse[]> {
  return request<SessionResponse[]>('/auth/sessions', { token: userToken })
}

export function createSession(userToken: string): Promise<SessionResponse> {
  return request<SessionResponse>('/auth/session', { method: 'POST', token: userToken })
}

export function renameSession(sessionToken: string, sessionId: string, name: string): Promise<SessionResponse> {
  return request<SessionResponse>(`/auth/session/${encodeURIComponent(sessionId)}/name`, {
    method: 'PATCH',
    token: sessionToken,
    form: { name },
  })
}

export function deleteSession(sessionToken: string, sessionId: string): Promise<void> {
  return request<void>(`/auth/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    token: sessionToken,
  })
}

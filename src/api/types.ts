/**
 * Request/response shapes, mirroring the backend's pydantic schemas exactly
 * (ToolBoxV2: app/schemas/auth.py, app/schemas/chat.py, app/schemas/rag.py).
 *
 * Two unrelated things are both called "token" in this API and must not be mixed up:
 *  - a USER token (from register/login) authenticates account-level calls: session
 *    list/create, groups, documents.
 *  - a SESSION token (minted per chat session, returned by every endpoint that touches
 *    one) authenticates chat calls for that one session only. Session tokens aren't
 *    derived from the user token — they're a separate JWT whose subject is the session
 *    id, and they're the ONLY thing chat endpoints will accept.
 * See AuthContext / SessionContext for how the two are kept apart.
 */

export type Role = 'user' | 'assistant' | 'system'

export interface Message {
  role: Role
  content: string
}

export interface Token {
  access_token: string
  token_type: string
  expires_at: string
}

export interface UserResponse {
  request_id: string
  id: number
  email: string
  username: string | null
  token: Token
}

export interface TokenResponse {
  request_id: string
  access_token: string
  token_type: string
  expires_at: string
}

export interface SessionResponse {
  request_id: string
  session_id: string
  name: string
  token: Token
}

export interface ChatResponse {
  request_id: string
  messages: Message[]
}

export interface StreamResponse {
  request_id: string
  content: string
  done: boolean
}

export interface ActiveRunResponse {
  request_id: string
  run_id: string
}

// --- RAG: groups + documents --------------------------------------------------------

export type GroupRole = 'admin' | 'member'

export interface GroupResponse {
  request_id: string
  id: number
  name: string
  role: GroupRole
}

export interface GroupMemberResponse {
  request_id: string
  user_id: number
  email: string
  role: GroupRole
}

export interface DocumentResponse {
  request_id: string
  id: string
  group_id: number
  owner_id: number
  title: string
  source: string | null
  chunk_count: number
  created_at: string
}

export interface SearchResult {
  document_id: string
  title: string
  chunk_index: number
  content: string
  distance: number
}

export interface SearchResponse {
  request_id: string
  results: SearchResult[]
}

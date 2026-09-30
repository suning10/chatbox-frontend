import { request } from './client'
import type {
  DocumentResponse,
  GroupMemberResponse,
  GroupResponse,
  GroupRole,
  SearchResponse,
} from './types'

// All RAG endpoints authenticate with the USER token (get_current_user), not a session token —
// groups/documents are account-level, not scoped to one chat session.

export function createGroup(userToken: string, name: string): Promise<GroupResponse> {
  return request<GroupResponse>('/rag/groups', { method: 'POST', token: userToken, json: { name } })
}

export function listGroups(userToken: string): Promise<GroupResponse[]> {
  return request<GroupResponse[]>('/rag/groups', { token: userToken })
}

export function listGroupMembers(userToken: string, groupId: number): Promise<GroupMemberResponse[]> {
  return request<GroupMemberResponse[]>(`/rag/groups/${groupId}/members`, { token: userToken })
}

export function addGroupMember(
  userToken: string,
  groupId: number,
  email: string,
  role: GroupRole,
): Promise<GroupMemberResponse> {
  return request<GroupMemberResponse>(`/rag/groups/${groupId}/members`, {
    method: 'POST',
    token: userToken,
    json: { email, role },
  })
}

export function removeGroupMember(userToken: string, groupId: number, targetUserId: number): Promise<void> {
  return request<void>(`/rag/groups/${groupId}/members/${targetUserId}`, { method: 'DELETE', token: userToken })
}

export function ingestDocument(
  userToken: string,
  groupId: number,
  title: string,
  content: string,
  source?: string,
): Promise<DocumentResponse> {
  return request<DocumentResponse>('/rag/documents', {
    method: 'POST',
    token: userToken,
    json: { group_id: groupId, title, content, source: source || undefined },
  })
}

export function listDocuments(userToken: string): Promise<DocumentResponse[]> {
  return request<DocumentResponse[]>('/rag/documents', { token: userToken })
}

export function deleteDocument(userToken: string, documentId: string): Promise<void> {
  return request<void>(`/rag/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE', token: userToken })
}

export function searchDocuments(
  userToken: string,
  query: string,
  groupId?: number,
  topK?: number,
): Promise<SearchResponse> {
  return request<SearchResponse>('/rag/documents/search', {
    method: 'POST',
    token: userToken,
    json: { query, group_id: groupId, top_k: topK },
  })
}

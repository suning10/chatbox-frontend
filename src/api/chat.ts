import { request } from './client'
import type { ChatResponse, Message } from './types'

export function getMessages(sessionToken: string): Promise<ChatResponse> {
  return request<ChatResponse>('/chatbot/messages', { token: sessionToken })
}

export function clearMessages(sessionToken: string): Promise<void> {
  return request<void>('/chatbot/messages', { method: 'DELETE', token: sessionToken })
}

/**
 * Non-streaming chat — waits for the full response in one round trip. The app's chat UI uses
 * streamChat (see stream.ts) instead so the user sees tokens as they arrive and the response
 * survives a dropped connection; this is here for completeness/scripting use.
 */
export function sendChat(sessionToken: string, messages: Message[]): Promise<ChatResponse> {
  return request<ChatResponse>('/chatbot/chat', { method: 'POST', token: sessionToken, json: { messages } })
}

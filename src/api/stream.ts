import { ApiError, API_V1, request } from './client'
import { SseParser, type RawSseEvent } from './sse'
import type { ActiveRunResponse, Message } from './types'

export interface ChatStreamCallbacks {
  /** A run id is now known — as soon as the initial response headers arrive, before any tokens. */
  onRunId?: (runId: string) => void
  /** Non-empty text to append. Also fires once more on the terminal event if it carries a message
   *  (an interrupted/error run substitutes its message for the answer — see backend INTERRUPTED_MESSAGE). */
  onToken: (content: string) => void
  /** The run reached its terminal event. Always the last callback fired on success. */
  onDone: () => void
  /** Unrecoverable: the initial request failed, or the connection dropped and resuming gave up. */
  onError: (error: Error) => void
}

export interface ChatStreamOptions {
  /** How many times to retry opening a resume connection after a drop, before giving up. */
  maxResumeAttempts?: number
  /** Delay before resume attempt N (1-based). Default: 500ms, 1s, 2s, 4s, 8s (capped). */
  backoffMs?: (attempt: number) => number
}

interface StreamPayload {
  content: string
  done: boolean
}

const DEFAULT_MAX_RESUME_ATTEMPTS = 5
const defaultBackoffMs = (attempt: number) => Math.min(500 * 2 ** (attempt - 1), 8000)

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Drives one chat run's SSE stream to completion, transparently resuming from the last event id
 * if the connection drops before the run's terminal event arrives. The run itself lives
 * server-side (see app/services/run_stream.py) and keeps generating regardless of whether
 * anything is attached to it — aborting a ChatStream stops *following*, not the run.
 *
 * Use `ChatStream.start` for a brand-new message, `ChatStream.attach` to reattach to a run
 * that's already in flight (e.g. detected via getActiveRun() after a page reload).
 */
export class ChatStream {
  private readonly maxResumeAttempts: number
  private readonly backoffMs: (attempt: number) => number
  private currentController = new AbortController()
  private stopped = false
  private runId: string | undefined
  private lastEventId: string | undefined

  private constructor(
    private readonly sessionToken: string,
    private readonly callbacks: ChatStreamCallbacks,
    options: ChatStreamOptions,
  ) {
    this.maxResumeAttempts = options.maxResumeAttempts ?? DEFAULT_MAX_RESUME_ATTEMPTS
    this.backoffMs = options.backoffMs ?? defaultBackoffMs
  }

  static start(
    sessionToken: string,
    messages: Message[],
    callbacks: ChatStreamCallbacks,
    options: ChatStreamOptions = {},
  ): ChatStream {
    const stream = new ChatStream(sessionToken, callbacks, options)
    stream.execute(() => stream.openInitial(messages))
    return stream
  }

  static attachToRun(
    sessionToken: string,
    runId: string,
    callbacks: ChatStreamCallbacks,
    options: ChatStreamOptions = {},
  ): ChatStream {
    const stream = new ChatStream(sessionToken, callbacks, options)
    stream.runId = runId
    stream.execute(() => stream.openGetStream())
    return stream
  }

  /** Stop following. The server-side run is unaffected — reattach later with `attachToRun`. */
  abort(): void {
    this.stopped = true
    this.currentController.abort()
  }

  private async execute(openFirst: () => Promise<Response>): Promise<void> {
    let response: Response
    try {
      response = await openFirst()
    } catch (err) {
      if (!this.stopped) this.callbacks.onError(toError(err))
      return
    }

    // Each loop iteration consumes one connection to completion or to a drop, then (unless the
    // run finished or we were told to stop) opens a fresh one from wherever the last one left off.
    while (true) {
      if (this.stopped) return
      const reachedDone = await this.consumeBody(response).catch(() => false)
      if (reachedDone || this.stopped) return

      try {
        response = await this.openResumeWithRetry()
      } catch (err) {
        if (!this.stopped) this.callbacks.onError(toError(err))
        return
      }
    }
  }

  private async openInitial(messages: Message[]): Promise<Response> {
    const res = await fetch(`${API_V1}/chatbot/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.sessionToken}` },
      body: JSON.stringify({ messages }),
      signal: this.newSignal(),
    })
    await this.captureRunIdAndValidate(res)
    return res
  }

  private async openGetStream(): Promise<Response> {
    if (!this.runId) throw new Error('openGetStream called before a run id was known.')
    const headers: Record<string, string> = { Authorization: `Bearer ${this.sessionToken}` }
    if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId
    const res = await fetch(`${API_V1}/chatbot/chat/stream/${encodeURIComponent(this.runId)}`, {
      headers,
      signal: this.newSignal(),
    })
    await this.captureRunIdAndValidate(res)
    return res
  }

  /** Retries opening a resume connection with backoff. Any failure (network or non-2xx, e.g. the
   *  run having since expired) counts as one used attempt — there's no way to tell "still starting
   *  up" apart from "gone for good" from the outside, so both get the same bounded number of tries. */
  private async openResumeWithRetry(): Promise<Response> {
    if (!this.runId) throw new Error('Connection lost before a run id was assigned; cannot resume.')
    let lastError: unknown
    for (let attempt = 1; attempt <= this.maxResumeAttempts; attempt++) {
      await delay(this.backoffMs(attempt))
      if (this.stopped) throw new Error('stopped')
      try {
        return await this.openGetStream()
      } catch (err) {
        lastError = err
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Lost connection and could not reconnect after several attempts.')
  }

  private newSignal(): AbortSignal {
    this.currentController = new AbortController()
    return this.currentController.signal
  }

  private async captureRunIdAndValidate(res: Response): Promise<void> {
    const headerRunId = res.headers.get('X-Run-Id')
    if (headerRunId && headerRunId !== this.runId) {
      this.runId = headerRunId
      this.callbacks.onRunId?.(headerRunId)
    }
    if (!res.ok) throw await errorFromResponse(res)
  }

  /** Reads one Response's SSE body to completion. Returns true only if the terminal event arrived. */
  private async consumeBody(response: Response): Promise<boolean> {
    if (!response.body) throw new Error('Response has no readable body.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseParser()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          for (const raw of parser.flush()) {
            if (this.handleRawEvent(raw)) return true
          }
          return false // connection closed before a done:true event -> caller resumes
        }
        for (const raw of parser.push(decoder.decode(value, { stream: true }))) {
          if (this.handleRawEvent(raw)) return true
        }
      }
    } finally {
      await reader.cancel().catch(() => {}) // no-op if already closed/errored
    }
  }

  /** Returns true iff this was the run's terminal event. */
  private handleRawEvent(raw: RawSseEvent): boolean {
    if (raw.id) this.lastEventId = raw.id
    if (!raw.data) return false // keep-alive comment line

    let payload: StreamPayload
    try {
      payload = JSON.parse(raw.data)
    } catch {
      return false // malformed frame — drop it rather than tear down an otherwise-fine stream
    }

    if (payload.content) this.callbacks.onToken(payload.content)
    if (payload.done) {
      this.callbacks.onDone()
      return true
    }
    return false
  }
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  return new ApiError(res.status, body as ConstructorParameters<typeof ApiError>[1], `Request failed with status ${res.status}`)
}

/** The run still generating a response for this session, if any (e.g. to reattach after a reload). */
export async function getActiveRun(sessionToken: string): Promise<string | null> {
  try {
    const res = await request<ActiveRunResponse>('/chatbot/chat/stream/active', { token: sessionToken })
    return res.run_id
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

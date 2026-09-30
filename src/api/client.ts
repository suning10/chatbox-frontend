/**
 * Low-level HTTP plumbing shared by every endpoint module. See stream.ts for the chat SSE
 * connection specifically — it needs the raw Response/ReadableStream, not this JSON helper.
 */

// Empty base -> relative "/api/v1/..." requests, which vite.config.ts's dev proxy forwards to
// the backend, and which resolve correctly in production when this app is served from the same
// origin as the API. Set VITE_API_BASE_URL only when that's not the deployment topology.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export const API_V1 = `${API_BASE}/api/v1`

/**
 * The shapes app/main.py's error handlers actually send:
 *  - most HTTPExceptions:            {"detail": "<message>"}
 *  - POST /chat/stream conflict:     {"detail": {"message": "<message>", "run_id": "<id>"}}
 *  - request validation failures:    {"detail": "Validation error", "errors": [{"field","message"}]}
 */
type FieldError = { field: string; message: string }
type ErrorBody =
  | { detail: string }
  | { detail: { message: string; run_id: string } }
  | { detail: string; errors: FieldError[] }

export class ApiError extends Error {
  readonly status: number
  readonly body: ErrorBody | undefined

  constructor(status: number, body: ErrorBody | undefined, fallbackMessage: string) {
    super(ApiError.extractMessage(body) ?? fallbackMessage)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  /** Set only for the 409 a conflicting POST /chat/stream returns — the run already in flight. */
  get conflictRunId(): string | undefined {
    const detail = this.body?.detail
    return typeof detail === 'object' ? detail.run_id : undefined
  }

  /** Set only for a 422 request-validation failure — one entry per invalid field. */
  get fieldErrors(): FieldError[] | undefined {
    return this.body && 'errors' in this.body ? this.body.errors : undefined
  }

  private static extractMessage(body: ErrorBody | undefined): string | undefined {
    if (!body) return undefined
    if ('errors' in body) return body.errors.map((e) => `${e.field}: ${e.message}`).join('; ')
    return typeof body.detail === 'string' ? body.detail : body.detail.message
  }
}

interface RequestOptions {
  method?: string
  /** Bearer token — a user token or a session token depending on the endpoint (see types.ts). */
  token?: string | null
  /** JSON-encoded body. Mutually exclusive with `form`. */
  json?: unknown
  /** application/x-www-form-urlencoded body (only /auth/login and the session-rename endpoint use this). */
  form?: Record<string, string>
  signal?: AbortSignal
}

/** Parse a response body as JSON, tolerating an empty body (some endpoints return 204-shaped 200s). */
async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  let body: string | undefined
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  } else if (options.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(options.form).toString()
  }

  const res = await fetch(`${API_V1}${path}`, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    signal: options.signal,
  })

  if (!res.ok) {
    const parsed = await parseJson(res)
    throw new ApiError(res.status, parsed as ErrorBody | undefined, `Request failed with status ${res.status}`)
  }

  return (await parseJson(res)) as T
}

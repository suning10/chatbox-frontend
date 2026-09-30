/**
 * Incremental Server-Sent Events line parser.
 *
 * The browser's native EventSource can't be used for chat streaming — it can't send an
 * Authorization header or a POST body, and it can't be told to reconnect from an arbitrary
 * Last-Event-ID on our own schedule — so the SSE wire format has to be parsed by hand from the
 * fetch() response body's raw byte chunks. This class does only that one job: turn a sequence of
 * decoded text chunks (which can split anywhere — mid-line, mid-field, mid blank-line separator)
 * into complete { id?, data? } events, exactly matching what app/api/v1/chatbot.py's `_sse()`
 * writes:
 *
 *   id: 1790000000000-0\ndata: {"content":"Hi","done":false,"request_id":"..."}\n\n   (a token)
 *   : keep-alive\n\n                                                               (idle ping)
 */
export interface RawSseEvent {
  id?: string
  data?: string
}

export class SseParser {
  private buffer = ''

  /** Feed the next decoded chunk; returns every event completed by it (often zero or one). */
  push(chunk: string): RawSseEvent[] {
    this.buffer += chunk
    const blocks = this.buffer.split('\n\n')
    // The last element is whatever comes after the final "\n\n" seen so far: a complete-but-yet
    // to be terminated block, or "" if the chunk ended exactly on a boundary. Either way, it isn't
    // a finished event yet, so it stays in the buffer for the next push (or flush()).
    this.buffer = blocks.pop() ?? ''
    return blocks.filter((block) => block.length > 0).map(parseBlock)
  }

  /** Call once the underlying stream has ended; parses a final block left with no trailing blank line. */
  flush(): RawSseEvent[] {
    const remainder = this.buffer
    this.buffer = ''
    return remainder.trim() ? [parseBlock(remainder)] : []
  }
}

function parseBlock(block: string): RawSseEvent {
  const event: RawSseEvent = {}
  const dataLines: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '' || line.startsWith(':')) continue // blank or a comment line (e.g. "keep-alive")
    if (line.startsWith('id:')) event.id = line.slice('id:'.length).trimStart()
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
  }
  if (dataLines.length > 0) event.data = dataLines.join('\n')
  return event
}

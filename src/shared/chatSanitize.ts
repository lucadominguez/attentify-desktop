// Shared chat sanitizer. Lives in shared/ so the agent (main), the DB history cleanup
// (main), and the chat UI (renderer) all scrub tool-call artifacts identically.
//
// Some models (especially proxied through OpenRouter) occasionally emit their tool
// invocation as raw TEXT instead of a structured tool_use block, it shows up in chat
// as "random code": XML <invoke>/<function_calls>, a ```json fence, or a bare
// {"name": ...} object. We strip all of that so the user only ever sees prose.
//
// sanitizeStreaming() is safe to call on PARTIAL text mid-stream: besides removing
// complete artifacts, it truncates everything from the first still-unclosed artifact
// opener, so half-arrived JSON never flashes on screen.

// Does the JSON blob starting at `from` look like a LEAKED TOOL CALL (vs. legitimate
// JSON the user asked for)? A tool call always names a tool and carries its arguments,
// so we require both a `"name"` key and an args key close to the opener. This keeps us
// from truncating real prose/JSON answers (e.g. DeepSeek emitting a JSON snippet), which
// would otherwise wipe the whole message and fall back to "Done.".
function looksLikeLeakedToolCall(t: string, from: number): boolean {
  const w = t.slice(from, from + 500)
  return /"name"\s*:/.test(w) && /"(?:parameters|arguments|input|tool_use_id|tool_name)"\s*:/.test(w)
}

// Index of the first artifact "opener" in t, or -1. Used to truncate partial junk.
function firstArtifactOpen(t: string): number {
  let min = -1
  const consider = (idx: number): void => { if (idx >= 0 && (min === -1 || idx < min)) min = idx }
  const tagOpeners = [/<function_calls>/i, /<function_results>/i, /<invoke\b/i, /```(?:tool_code|tool_use)/i]
  for (const re of tagOpeners) { const m = re.exec(t); if (m) consider(m.index) }
  // A JSON object/array that begins a line — treat as a leaked tool call ONLY when it
  // actually looks like one (names a tool + args). Plain JSON/lists the user legitimately
  // asked for are left intact rather than truncated to nothing.
  const jsonRe = /(?:^|\n)[ \t]*([[{])[ \t\r\n]*["[{]/g
  let jm: RegExpExecArray | null
  while ((jm = jsonRe.exec(t)) !== null) {
    const idx = jm.index + jm[0].indexOf(jm[1]!)
    if (looksLikeLeakedToolCall(t, idx)) { consider(idx); break }
  }
  return min
}

export function sanitizeStreaming(text: string): string {
  let t = text
  // Remove COMPLETE artifact blocks anywhere in the text.
  t = t.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
  t = t.replace(/<function_results>[\s\S]*?<\/function_results>/gi, '')
  t = t.replace(/<invoke\b[\s\S]*?<\/invoke>/gi, '')
  // Only strip fences explicitly marked as tool calls — leave ```json/```xml the user
  // legitimately asked for untouched (a tool call leaked in a plain fence is still caught
  // below by the tool-call-shape check).
  t = t.replace(/```(?:tool_code|tool_use)\s*[\s\S]*?```/gi, '')
  // Truncate from the first still-open artifact opener (handles mid-stream partials
  // AND a complete-but-unfenced trailing JSON tool call).
  const cut = firstArtifactOpen(t)
  if (cut >= 0) t = t.slice(0, cut)
  // Strip any stray tool markup tags left behind.
  t = t.replace(/<\/?(?:antml:[a-z_]+|tool_call|tool_use|parameter|function_calls|function_results|invoke)\b[^>]*>/gi, '')
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}

// Final cleanup for a persisted / displayed message.
export function sanitizeAssistantText(text: string): string {
  return sanitizeStreaming(text).trim()
}

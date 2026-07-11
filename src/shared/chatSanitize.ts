// Shared chat sanitizer. Lives in shared/ so the agent (main), the DB history cleanup
// (main), and the chat UI (renderer) all scrub tool-call artifacts identically.
//
// Some models (especially proxied through OpenRouter) occasionally emit their tool
// invocation as raw TEXT instead of a structured tool_use block — it shows up in chat
// as "random code": XML <invoke>/<function_calls>, a ```json fence, or a bare
// {"name": ...} object. We strip all of that so the user only ever sees prose.
//
// sanitizeStreaming() is safe to call on PARTIAL text mid-stream: besides removing
// complete artifacts, it truncates everything from the first still-unclosed artifact
// opener, so half-arrived JSON never flashes on screen.

// Index of the first artifact "opener" in t, or -1. Used to truncate partial junk.
function firstArtifactOpen(t: string): number {
  let min = -1
  const consider = (idx: number): void => { if (idx >= 0 && (min === -1 || idx < min)) min = idx }
  const tagOpeners = [/<function_calls>/i, /<function_results>/i, /<invoke\b/i, /```(?:json|tool_code|tool_use|xml)/i]
  for (const re of tagOpeners) { const m = re.exec(t); if (m) consider(m.index) }
  // A JSON object/array that begins a line (optionally after whitespace) → treat as the
  // start of a leaked tool call: a `{` or `[` followed by whitespace and then a quote,
  // `{`, or `[` (covers {"…}, [{"…}], [[…], multi-line). In this assistant, prose never
  // legitimately opens a line this way, so it's safe to cut here.
  const jsonStart = /(?:^|\n)[ \t]*([[{])[ \t\r\n]*["[{]/.exec(t)
  if (jsonStart) consider(jsonStart.index + jsonStart[0].indexOf(jsonStart[1]!))
  return min
}

export function sanitizeStreaming(text: string): string {
  let t = text
  // Remove COMPLETE artifact blocks anywhere in the text.
  t = t.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
  t = t.replace(/<function_results>[\s\S]*?<\/function_results>/gi, '')
  t = t.replace(/<invoke\b[\s\S]*?<\/invoke>/gi, '')
  t = t.replace(/```(?:json|tool_code|tool_use|xml)?\s*[[{][\s\S]*?[\]}]\s*```/gi, '')
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

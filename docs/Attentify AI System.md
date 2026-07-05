---
title: Attentify — AI System
tags: [attentify, ai, architecture, agent, inference]
updated: 2026-07-03
---

# Attentify — How the AI Works

> [!summary] TL;DR
> Attentify has **three** distinct AI subsystems, not one:
> 1. **[[#1 The Inference Engine|Inference Engine]]** — fast, autonomous scorer that watches every URL/search/session and decides *block / suggest / ignore*.
> 2. **[[#2 The Agent|The Agent (chat + proactive)]]** — a conversational Claude agent with 22 tools that the user talks to, and which nudges them proactively.
> 3. **[[#3 The Overlay Notifier|Overlay Notifier]]** — generates short, personalised interrupt messages.
>
> All three call the **same model provider** through one of two paths: the user's own key (Anthropic or OpenRouter) or the **bundled OpenRouter key** (metered by [[#Billing & metering|billing.ts]]).

This document is written for editing. Each subsystem lists **where it lives**, **what triggers it**, **the exact knobs you can turn**, and **how to modify it safely**.

---

## Model configuration (start here)

Two providers, chosen automatically by the *shape* of the API key:

| Key prefix | Provider | Agent model | Inference model |
|---|---|---|---|
| `sk-ant-…` | Anthropic direct | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` |
| `sk-or-…` | OpenRouter | `anthropic/claude-sonnet-4.5` | `anthropic/claude-haiku-4.5` |

- **Agent** uses a **Sonnet**-class model (reasoning + tool use).
- **Inference** uses a **Haiku**-class model (cheap, fast, high-volume).
- The switch happens in `AgentService.init()` and `InferenceEngine.init()` — both check `key.startsWith('sk-or-')`.

> [!tip] To change models
> Edit the constants at the top of each file:
> - `src/main/agent/AgentService.ts` → `ANTHROPIC_MODEL`, `OPENROUTER_MODEL`
> - `src/main/inference/InferenceEngine.ts` → `ANTHROPIC_MODEL`, `OPENROUTER_MODEL`
> Model IDs are documented in the `claude-api` reference. Prefer the latest Claude models.

---

## 1. The Inference Engine

**File:** `src/main/inference/InferenceEngine.ts` (~800 lines)
**Role:** the always-on "immune system". No conversation — it just scores activity and acts.

### Triggers (hot paths)
```
MonitorService  ──emits──►  analyzeUrl(url, title)        ← every browser URL change
                            analyzeSearchQuery(query)      ← every search
                            analyzeSession(session)        ← every focus session
```

### Decision thresholds (the knobs)
```ts
CONFIDENCE_AUTO_BLOCK = 0.85   // ≥ this AND mode=auto → block immediately
CONFIDENCE_SUGGEST    = 0.60   // ≥ this → surface a suggestion (Actions tab)
HARDBLOCK_CATEGORIES  = { adult, gambling, dating, social_media, video_streaming }
                               // always auto-block regardless of goals
```

### The decision ladder (`analyze*` → action)
```
         confidence
            │
  ≥ 0.85 & mode=auto ───────────► AUTO-BLOCK (hosts file / process kill)
            │
  ≥ 0.85 & mode=ask ────────────► SUGGEST (labelled "would auto-block")
            │
  ≥ 0.60 ───────────────────────► SUGGEST (pending inference → Actions tab)
            │
  < 0.60 ───────────────────────► IGNORE (just recorded)
```
`blockingMode` (`'auto' | 'ask'`) is set from Settings → "Threat Response Mode" via `setBlockingMode()`.

### Two-stage scoring: heuristics first, AI second
1. **Cheap local pass** — keyword/category matching, `HARDBLOCK_CATEGORIES`, goal keywords. Most decisions resolve here with **zero AI cost**.
2. **AI pass** (only when local is uncertain *and* the user has goals) — queued through `aiQueue`, processed one at a time (`aiProcessing` guard), calls the **Haiku** model. Returns:
   ```json
   {"distraction":true,"category":"<3 words>","confidence":0.0-1.0,"reasoning":"<10 words>"}
   ```
   ⚠️ This JSON is **internal** — see [[#Keeping debug traffic out of chat]].

> [!warning] De-duplication
> `wasRecentlyProcessed(key)` prevents re-scoring the same URL/search repeatedly. If you change scoring and "nothing happens", you may be hitting this cache — check the key prefixes (`aisearch:`, etc.).

### How to modify
- **Make blocking stricter/looser:** change `CONFIDENCE_AUTO_BLOCK` / `CONFIDENCE_SUGGEST`.
- **Add an always-blocked category:** add to `HARDBLOCK_CATEGORIES`.
- **Change what the AI is asked:** edit the prompt strings near the `analyzeUrl`/`analyzeSearchQuery` builders (search for `Reply with JSON only`).

Related: [[#Billing & metering]] gates every AI pass with `canUseAi()`.

---

## 2. The Agent

**File:** `src/main/agent/AgentService.ts` · **Prompt:** `src/main/agent/systemPrompt.ts` · **Tools:** `src/main/agent/tools.ts`
**Role:** the thing the user *talks to* ("Ask Attentify"), and which occasionally nudges them.

### Config
```ts
MAX_TOKENS      = 2048
MAX_TOOL_ROUNDS = 8      // agentic loop cap — how many tool round-trips per message
model           = Sonnet-class (see table above)
```

### The agentic loop (`runLoop`)
```
user message
   │
   ▼
┌─────────────────────────────────────────────┐
│ system prompt (built fresh per message from  │
│ live context — see buildSystemPrompt)        │
└─────────────────────────────────────────────┘
   │
   ▼
 stream a turn ──► text deltas → onChunk (UI)
   │
   ├─ stop_reason = "end_turn"  ──► done, persist reply
   │
   └─ stop_reason = "tool_use"  ──► execute each tool → feed results back
                                     (repeat, up to MAX_TOOL_ROUNDS)
```

### System prompt = live context (`buildSystemPrompt`)
Assembled every message from real state, so the model always "sees" the current world:
- `## Live Browser Activity`
- `## Today's Activity (live data)`
- `## User's Goals`
- `## Learned Preferences`
- `## Currently Blocked`
- `## Inference Engine — Novel Distractions Detected`
- `## Browser Extension`
- `## What You Can Do` (tool catalogue)
- `## How to Behave` (tone/guardrails)

> [!tip] To change the assistant's personality or rules
> Edit `## How to Behave` in `systemPrompt.ts`. To give it new *facts*, add a section in `buildSystemPrompt()`.

### The 22 tools (`tools.ts`)
| Group | Tools |
|---|---|
| **Blocking** | `block_domain`, `unblock_domain`, `block_process`, `unblock_process`, `block_category`, `get_active_blocks` |
| **Focus sessions** | `start_focus_session`, `stop_focus_session` |
| **Insight** | `get_analytics`, `get_recent_events`, `get_patterns` |
| **Goals** | `get_goals`, `add_goal`, `clear_goal` |
| **Preferences** | `get_preferences`, `set_preference` |
| **Inferences** | `get_inferences`, `resolve_inference` |
| **Content rules** (extension) | `create_content_rule`, `list_content_rules`, `toggle_content_rule`, `get_bypass_attempts` |

> [!tip] To add a tool
> 1. Add a definition to `TOOL_DEFINITIONS` (name, description, JSON schema).
> 2. Add a `case` to `executeTool()`.
> 3. If it needs new capabilities, extend `ToolDeps`.
> The model discovers tools purely from their descriptions — write those carefully.

### Proactive mode (`notifyDistraction`)
Separate from chat. When `MonitorService` emits a `distraction` ≥ 90 s, the agent may generate an unprompted check-in.
Guards, in order: `proactiveEnabled` → `shouldProact()` (rate-limit) → `canUseAi()` (don't burn the free allowance).
Persisted with a `[proactive]` prefix so the UI can tell it apart.

---

## 3. The Overlay Notifier

**File:** `src/main/overlay/NotificationQueue.ts`
**Role:** the small bottom-right window. Generates a **personalised one-liner** per event via a **Haiku** call, then shows actions (block / break / dismiss / chat).
Types: `auto-block`, `suggest`, `heuristic`, `guard`, `proactive`.

---

## Data flow (the whole loop)

```
        ┌───────────────┐   focus/URL/search   ┌────────────────────┐
        │ MonitorService│ ───────────────────► │  InferenceEngine   │
        │ (PowerShell   │                       │ heuristics → AI    │
        │  UIA poll 3s) │                       └─────────┬──────────┘
        └──────┬────────┘                                 │ block / suggest
               │ distraction ≥90s                          ▼
               ▼                                   ┌────────────────┐
        ┌────────────┐   proactive nudge           │ BlockingEngine │
        │ AgentService│ ◄──────────────────────────│ + Overlay      │
        │ (chat+tools)│                             └────────────────┘
        └──────┬──────┘
               │ user chats / approves
               ▼
        ┌────────────┐    events (Cloud tier)   ┌─────────────────────┐
        │  cloudSync │ ───────────────────────► │ Worker /v1/analytics│
        └────────────┘                          │  → website dashboard│
                                                └─────────────────────┘
```

See also: [[Attentify Cloud & Auth]] for the billing/auth half.

---

## Billing & metering

**File:** `src/main/billing.ts` · **Config:** `src/main/config.ts`

- Every AI call is gated by `canUseAi()` and metered by `recordUsage(model, inTok, outTok)`.
- **Not** metered: the user's own key (`hasOwnKey()`), or an active Cloud subscription (`isSubscribed()`).
- Free allowance: `FREE_USAGE_LIMIT_USD` (config.ts). Cost is *estimated* per-model in `MODEL_PRICING`.
- When exhausted → the chat/overlay show the paywall; inference silently stops its AI pass but keeps the cheap local pass running.

> [!danger] Editing pricing
> `MODEL_PRICING` in `config.ts` must include any new model id you switch to, or metering falls back to `DEFAULT_PRICING` (haiku-class) and under/over-charges the allowance.

---

## Keeping debug traffic out of chat

The Inference Engine's JSON (`{"distraction":…,"confidence":…}`) must **never** appear in the "Ask Attentify" chat — it made the assistant look broken.

Guards in place:
- **Home** is now a dashboard, not the chat surface (chat lives only in `ChatPanel`).
- `ChatPanel.tsx` → `looksLikeDebug()` filters any raw-JSON/classification payload out of history.
- Inference/overlay AI calls are **separate** from the agent's `insertAgentMessage` history.

> [!note] If debug JSON ever reappears in chat
> Something is writing an inference/classification result into `agent_messages`. Trace `insertAgentMessage` callers — only the *agent* (chat + `[proactive]`) should write there.

---

## Quick edit index

| I want to… | Go to |
|---|---|
| Change how aggressively sites are blocked | `InferenceEngine.ts` → `CONFIDENCE_*` |
| Always-block a new category | `InferenceEngine.ts` → `HARDBLOCK_CATEGORIES` |
| Change the assistant's tone/rules | `systemPrompt.ts` → `## How to Behave` |
| Give the assistant new abilities | `tools.ts` → `TOOL_DEFINITIONS` + `executeTool` |
| Swap the AI model | `ANTHROPIC_MODEL` / `OPENROUTER_MODEL` in AgentService **and** InferenceEngine |
| Change the free-AI limit | `config.ts` → `FREE_USAGE_LIMIT_USD` |
| Change what syncs to the web dashboard | `cloudSync.ts` + the `recordCloudEvent()` call-sites in `ipc.ts` |

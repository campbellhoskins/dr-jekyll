# PO Pro - System Architecture

## Overview

PO Pro is an AI-powered purchase order agent that communicates with suppliers via email on behalf of merchants. The system operates within merchant-defined guardrails and requires human approval before finalizing orders.

---

## System Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MERCHANT LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  Dashboard  │    │   Orders    │    │  Suppliers  │    │  Settings   │  │
│  │    (Web)    │    │   Manager   │    │   Manager   │    │   Panel     │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
└─────────┼──────────────────┼──────────────────┼──────────────────┼─────────┘
          │                  │                  │                  │
          ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER (Next.js)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │    Auth     │    │   Orders    │    │  Suppliers  │    │   Gmail     │  │
│  │    API      │    │    API      │    │    API      │    │  Webhooks   │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
          │                  │                  │                  │
          ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVICE LAYER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Policy    │    │    LLM      │    │   Email     │    │   Audit     │  │
│  │   Engine    │    │   Service   │    │   Parser    │    │   Logger    │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                     │
│  │  Currency   │    │  Template   │    │Notification │                     │
│  │  Converter  │    │   Engine    │    │   Service   │                     │
│  └─────────────┘    └─────────────┘    └─────────────┘                     │
└─────────────────────────────────────────────────────────────────────────────┘
          │                  │                  │                  │
          ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL SERVICES                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  Gmail API  │    │ Claude API  │    │  SendGrid   │    │  Exchange   │  │
│  │             │    │ (primary)   │    │  /Resend    │    │  Rate API   │  │
│  └─────────────┘    ├─────────────┤    └─────────────┘    └─────────────┘  │
│                     │ OpenAI API  │                                         │
│                     │ (fallback)  │                                         │
│                     └─────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────┘
          │                  │                  │                  │
          ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     PostgreSQL (Neon - Serverless)                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌────────┐  │  │
│  │  │ Merchant │ │ Supplier │ │ Merchant     │ │  Order   │ │Message │  │  │
│  │  │          │ │ (global) │ │ Supplier     │ │          │ │        │  │  │
│  │  └──────────┘ └──────────┘ │ (join/config)│ └──────────┘ └────────┘  │  │
│  │                            └──────────────┘                           │  │
│  │  Suppliers are global entities with accumulated intelligence.         │  │
│  │  MerchantSupplier holds per-relationship config (style, rules, SKUs). │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Background Workers (Railway)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKGROUND WORKERS                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐    Vercel Cron (Every 5-15 min)                    │
│  │   Email Poller      │◄───────────────────────────────                    │
│  │   (Lightweight)     │                                                     │
│  └──────────┬──────────┘                                                     │
│             │                                                                │
│             ▼ Queues heavy work                                              │
│  ┌─────────────────────┐                                                     │
│  │   Agent Processor   │    Railway Worker (Long-running)                   │
│  │   - LLM Reasoning   │◄───────────────────────────────                    │
│  │   - Email Parsing   │                                                     │
│  │   - PDF/Excel Parse │                                                     │
│  └─────────────────────┘                                                     │
│                                                                              │
│  ┌─────────────────────┐    Vercel Cron (Hourly)                            │
│  │  Reminder Scheduler │◄───────────────────────────────                    │
│  │  - 24h reminders    │                                                     │
│  │  - 48h hold msgs    │                                                     │
│  │  - Follow-ups       │                                                     │
│  └─────────────────────┘                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Order Creation Flow

```
Merchant                    Dashboard                   API                     Database
   │                           │                         │                         │
   │  Create Order             │                         │                         │
   │  (supplier, SKU, qty)     │                         │                         │
   ├──────────────────────────►│                         │                         │
   │                           │  POST /api/orders       │                         │
   │                           ├────────────────────────►│                         │
   │                           │                         │  Create Order           │
   │                           │                         │  (status: draft)        │
   │                           │                         ├────────────────────────►│
   │                           │                         │                         │
   │                           │                         │  Check: First email     │
   │                           │                         │  to this supplier?      │
   │                           │                         ├────────────────────────►│
   │                           │                         │◄────────────────────────┤
   │                           │                         │                         │
   │                           │  If first: Show draft   │                         │
   │                           │◄────────────────────────┤                         │
   │  Review & approve draft   │                         │                         │
   │◄──────────────────────────┤                         │                         │
   │                           │                         │                         │
   ├──────────────────────────►│                         │                         │
   │                           │  POST /api/orders/send  │                         │
   │                           ├────────────────────────►│                         │
   │                           │                         │  Send via Gmail API     │
   │                           │                         ├───────────────────────► Gmail
   │                           │                         │                         │
   │                           │                         │  Update status:         │
   │                           │                         │  awaiting_quote         │
   │                           │                         ├────────────────────────►│
   │                           │                         │                         │
```

### 2. Email Monitoring & Agent Processing Flow

```
Vercel Cron              Email Poller           Gmail API            Railway Worker
     │                        │                     │                      │
     │  Trigger (every 10m)   │                     │                      │
     ├───────────────────────►│                     │                      │
     │                        │  Fetch new emails   │                      │
     │                        ├────────────────────►│                      │
     │                        │◄────────────────────┤                      │
     │                        │                     │                      │
     │                        │  For each email:    │                      │
     │                        │  Match to order     │                      │
     │                        │                     │                      │
     │                        │  Queue for processing                      │
     │                        ├────────────────────────────────────────────►│
     │                        │                     │                      │
     │                        │                     │       Agent Processor│
     │                        │                     │       ┌──────────────┤
     │                        │                     │       │ 1. Parse email body
     │                        │                     │       │ 2. Parse attachments
     │                        │                     │       │    (PDF/Excel)
     │                        │                     │       │ 3. Extract quote data
     │                        │                     │       │ 4. Evaluate vs policy
     │                        │                     │       │ 5. Decide action
     │                        │                     │       └──────────────┤
     │                        │                     │                      │
```

### 3. Agent Decision Flow (Multi-Agent Orchestration)

```
                         ┌─────────────────────┐
                    ①    │ Instruction          │  Classify merchant's plain-English
                         │ Classifier           │  instructions into rules, triggers,
                         │                      │  and special instructions (LLM)
                         └──────────┬───────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────────┐
                    │   PARALLEL FAN-OUT (Promise.all)  │
               ②    │                                   │
                    │  ┌──────────────┐  ┌────────────┐ │
                    │  │  Extraction  │  │ Escalation │ │
                    │  │  Expert      │  │ Expert     │ │
                    │  │  (LLM)      │  │ (LLM)     │ │
                    │  └──────────────┘  └────────────┘ │
                    └──────────────┬────────────────────┘
                                   │ all opinions
                                   ▼
                         ┌─────────────────────┐
                    ③    │   ORCHESTRATOR      │◄──┐
                         │   (LLM decides)     │   │ loop: re-consult
                         │                      │   │ an expert if needed
                         │   Can call Needs    │───┘ (e.g. NeedsExpert
                         │   Expert on-demand  │     for info gaps)
                         └──────────┬───────────┘
                                    │ action decided
                        ┌───────────┼───────────┬───────────┐
                        │           │           │           │
                        ▼           ▼           ▼           ▼
                     Accept     Counter     Escalate   Clarify
                        │           │           │           │
                        ▼           ▼           ▼           ▼
                         ┌─────────────────────┐
                    ④    │ Response Crafter     │
                         │                      │
                         │ Accept → Proposed   │
                         │   Approval (no LLM) │
                         │ Counter → Draft     │
                         │   email (LLM)       │
                         │ Clarify → Draft     │
                         │   email (LLM)       │
                         │ Escalate → Reason   │
                         │   passthrough       │
                         └─────────────────────┘
```

Each expert = same model, different focused system prompt. The orchestrator loops (max 10 iterations) until it has enough information, then decides. Code never overrides the LLM.

### 4. Approval Flow

```
Agent                    Notification           Merchant              Dashboard
  │                        Service                 │                     │
  │  Offer ready           │                       │                     │
  │  for approval          │                       │                     │
  ├───────────────────────►│                       │                     │
  │                        │  Email: "You have     │                     │
  │                        │  received an offer"   │                     │
  │                        ├──────────────────────►│                     │
  │                        │                       │                     │
  │                        │      24h passes...    │                     │
  │                        │                       │                     │
  │                        │  Reminder email       │                     │
  │                        ├──────────────────────►│                     │
  │                        │                       │                     │
  │                        │      48h total...     │                     │
  │                        │                       │                     │
  │  Send hold message     │                       │                     │
  ├───────────────────────────────────────────────────────────────────► Supplier
  │                        │                       │                     │
  │                        │                       │  View offer         │
  │                        │                       ├────────────────────►│
  │                        │                       │                     │
  │                        │                       │  Click Approve      │
  │                        │                       ├────────────────────►│
  │                        │                       │                     │
  │◄──────────────────────────────────────────────────────────────────────┤
  │                        │                       │                     │
  │  Send confirmation to supplier                 │                     │
  ├───────────────────────────────────────────────────────────────────► Supplier
  │                        │                       │                     │
```

### 5. Takeover & Resume Flow

```
Merchant                  Dashboard                 Agent               Supplier
   │                         │                        │                    │
   │  Click "Take Over"      │                        │                    │
   ├────────────────────────►│                        │                    │
   │                         │  Set: takenOver=true   │                    │
   │                         ├───────────────────────►│                    │
   │                         │                        │  Stop responding   │
   │                         │                        │  Monitor silently  │
   │                         │                        │                    │
   │  Send manual email      │                        │                    │
   ├─────────────────────────────────────────────────────────────────────►│
   │                         │                        │                    │
   │                         │                        │◄───────────────────┤
   │                         │                        │  Supplier replies  │
   │                         │                        │                    │
   │  Alert: Supplier replied│                        │                    │
   │◄────────────────────────┤◄───────────────────────┤                    │
   │                         │                        │                    │
   │  Click "Resume Agent"   │                        │                    │
   ├────────────────────────►│                        │                    │
   │                         │  Set: takenOver=false  │                    │
   │                         │  Include all messages  │                    │
   │                         │  from takeover period  │                    │
   │                         ├───────────────────────►│                    │
   │                         │                        │  Resume with full  │
   │                         │                        │  context           │
   │                         │                        │                    │
```

---

## Component Details

### Policy Engine

The policy engine evaluates supplier responses against merchant-defined rules written in plain English, enriched with supplier intelligence when available.

**Input:**
- Extracted quote data (price, quantity, lead time, etc.)
- Merchant's instructions (single plain-English field, classified by LLM into negotiation rules, escalation triggers, and special instructions)
- Supplier intelligence (behavioral patterns, negotiation tendencies, response norms)

**Output:**
- Compliance status (acceptable / counter needed / escalate)
- Matched rules with reasoning
- Recommended action

**Process:**
1. LLM parses natural language rules into structured conditions
2. Incorporate supplier intelligence context (known tendencies, typical terms)
3. Compare extracted data against conditions
4. Determine overall compliance
5. Generate reasoning for audit trail

### LLM Service

Provider-agnostic abstraction layer. The rest of the application sends structured requests (prompt + context) to this service and receives structured responses — it never calls a specific LLM provider directly.

**Providers:**
- Primary: Claude API (Anthropic) — Haiku for dev, Sonnet/Opus for prod
- Fallback: OpenAI API (GPT-4o) — activated automatically on primary failure

**Capabilities:**
- Automatic retry (2-3 attempts per provider)
- Automatic fallback: if primary exhausts retries, routes to fallback provider
- Full conversation context (all messages + order context, no truncation — accuracy over cost)
- Structured output parsing (consistent format regardless of provider)
- Full audit logging of every attempt: provider, model, prompt, response, latency, outcome
- Escalation to merchant only after all providers are exhausted

### Email Parser

Extracts structured data from supplier emails:
- Body text parsing for prices, quantities, dates
- PDF attachment parsing for formal quotes
- Excel attachment parsing for pricing tables
- Currency detection and normalization
- Confidence scoring for extractions

### Supplier Intelligence Service

Accumulates and maintains behavioral knowledge about suppliers across all merchant interactions.

**Inputs:**
- Completed order conversations (timing, outcomes, patterns)
- Email metadata (response times, communication style)
- Negotiation outcomes (how often they counter, hold firm, give discounts)

**Outputs:**
- Updated supplier profile fields (avgResponseTimeHours, negotiationPatterns, etc.)
- Intelligence summaries surfaced to merchants when adding known suppliers
- Context provided to the agent during email generation and policy evaluation

**Process:**
1. After each order reaches a terminal state (confirmed, cancelled), trigger intelligence update
2. LLM analyzes the interaction and generates/updates behavioral summaries
3. Quantitative metrics (response time, interaction count) updated incrementally
4. Privacy: only behavioral patterns are captured, never specific pricing or volumes from other merchants

### Agent Pipeline (`src/lib/agent/`)

The full agent is composed of modular, independently testable components orchestrated by `AgentPipeline`:

| Component | File | Purpose |
|-----------|------|---------|
| **AgentPipeline** | `pipeline.ts` | Top-level entry point — classifies instructions, runs orchestrator, crafts response |
| **Orchestrator** | `orchestrator.ts` | Multi-agent orchestration loop — runs experts in parallel, LLM decides action, can re-consult experts |
| **InstructionClassifier** | `instruction-classifier.ts` | Classifies a single merchant instructions field into negotiation rules, escalation triggers, and special instructions (LLM) |
| **ExtractionExpert** | `experts/extraction.ts` | Wraps Extractor — extracts structured quote data from supplier emails (LLM). Sees only raw data, no merchant rules |
| **EscalationExpert** | `experts/escalation.ts` | Evaluates supplier message against escalation triggers (LLM). Sees triggers + data, no negotiation rules |
| **NeedsExpert** | `experts/needs.ts` | Identifies information gaps and prioritizes questions to ask (LLM). Called on-demand by orchestrator |
| **ResponseCrafter** | `experts/response-crafter.ts` | Drafts response: accept → deterministic ProposedApproval, counter/clarify → LLM-drafted email, escalate → reason passthrough |
| **Extractor** | `extractor.ts` | Core extraction logic reused by ExtractionExpert — currency normalization and USD conversion (LLM) |
| **ConversationContext** | `conversation-context.ts` | Tracks full conversation history and merges extraction data across turns — no truncation, full context in every LLM call |
| **OutputParser** | `output-parser.ts` | Parses and validates LLM JSON output with Zod schemas, handles markdown blocks, numeric string coercion, currency normalization |
| **Prompts** | `prompts.ts`, `experts/prompts.ts` | LLM prompt builders with system/user messages and JSON Schema definitions for structured output |

**CLI Tools** (`src/cli/`): 4 harnesses for testing — `extract` (single extraction), `pipeline` (scenario fixtures), `chat` (interactive multi-turn), `session` (automated with expectations).

### Audit Logger

Comprehensive logging for trust and debugging:
- Every email sent/received
- Every LLM decision with full reasoning
- Every policy evaluation
- Every merchant action with session context
- Retained indefinitely

---

## Security Considerations

### Data Protection
- Gmail OAuth tokens encrypted at rest
- All secrets via environment variables
- HTTPS only in production

### API Security
- Rate limiting on all endpoints
- Input validation and sanitization
- Parameterized queries via Prisma

### Gmail API
- Minimal required scopes
- Token refresh handling
- Graceful disconnection handling

---

## Deployment Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     Vercel      │     │     Railway     │     │      Neon       │
│                 │     │                 │     │                 │
│  ┌───────────┐  │     │  ┌───────────┐  │     │  ┌───────────┐  │
│  │  Next.js  │  │     │  │  Worker   │  │     │  │PostgreSQL │  │
│  │   App     │  │────►│  │  Process  │  │────►│  │ Database  │  │
│  └───────────┘  │     │  └───────────┘  │     │  └───────────┘  │
│                 │     │                 │     │                 │
│  ┌───────────┐  │     └─────────────────┘     └─────────────────┘
│  │   Cron    │  │
│  │   Jobs    │  │
│  └───────────┘  │
│                 │
└─────────────────┘
```

---

## Monitoring & Observability

| Tool | Purpose |
|------|---------|
| Sentry | Error tracking — all unhandled exceptions, API errors, LLM failures (per-provider breakdown) |
| Better Uptime or Checkly | Uptime monitoring — main dashboard, API health check |
| Vercel Analytics | Performance metrics — page load times, API response times |
| Railway logs + Vercel logs | Application logs — structured JSON format |

---

## Security Considerations

- **Token encryption:** Gmail access/refresh tokens encrypted at rest
- **Secrets management:** All secrets via environment variables (never in code)
- **Transport:** HTTPS only
- **OAuth security:** Validate state parameter, secure token storage, automatic refresh
- **Input validation:** All user inputs validated; email content sanitized (XSS prevention); parameterized queries via Prisma
- **Rate limiting:** API endpoints rate-limited; Gmail API limits respected

---

*Last updated: February 2026*

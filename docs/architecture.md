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

### 3. Agent Decision Flow (Single-Call Pipeline)

```
                         ┌─────────────────────┐
                    ①    │ OrderInformation     │  Structured merchant input:
                         │ (merchant input)     │  product, pricing, quantity,
                         │                      │  terms, negotiation rules
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                    ②    │ Rules Generation     │  Transform OrderInformation
                         │ (LLM)               │  into ORDER_CONTEXT (facts)
                         │                      │  + MERCHANT_RULES (behavior)
                         │ Cached across turns  │  Cached after first call
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                    ③    │ Agent Decision       │  Single LLM call with:
                         │ (LLM)               │  - Conversation history
                         │                      │  - ORDER_CONTEXT
                         │                      │  - MERCHANT_RULES
                         │                      │  - Supplier message
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                    ④    │ XML Output Parser    │  Extract from response:
                         │                      │  <systematic_evaluation>
                         │                      │  <decision>
                         │                      │  <response>
                         └──────────┬───────────┘
                                    │ action decided
                        ┌───────────┼───────────┐
                        │           │           │
                        ▼           ▼           ▼
                     Accept     Counter     Escalate
                        │           │           │
                        ▼           ▼           ▼
                   Response    Draft email  Escalation
                   text        to supplier  notice
```

Single LLM call performs systematic evaluation, decides action, and drafts response — all in one pass. Code never overrides the LLM. Rules are cached across conversation turns to save tokens on subsequent calls.

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

Policy evaluation is currently handled by the AgentPipeline's single-call approach. The LLM receives ORDER_CONTEXT and MERCHANT_RULES (generated from structured OrderInformation) and evaluates the supplier's response in a single pass.

**Input:**
- Supplier message (raw email text)
- ORDER_CONTEXT (factual order summary generated from OrderInformation)
- MERCHANT_RULES (behavioral rules generated from OrderInformation — pricing limits, negotiation strategy, escalation triggers)
- Conversation history (full thread, no truncation)

**Output:**
- Systematic evaluation (term-by-term analysis in XML)
- Decision with action (accept / counter / escalate) and reasoning
- Draft response text (email or escalation notice)

**Process:**
1. OrderInformation is transformed into ORDER_CONTEXT + MERCHANT_RULES via LLM (cached across turns)
2. Single LLM call evaluates supplier message against all rules systematically
3. LLM determines overall compliance and recommended action
4. LLM drafts appropriate response in the same call
5. Full reasoning captured for audit trail

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

The agent uses a single-call pipeline architecture where one LLM call performs systematic evaluation, decides the action, and drafts the response:

| Component | File | Purpose |
|-----------|------|---------|
| **AgentPipeline** | `pipeline.ts` | Top-level entry point — generates rules, calls LLM for decisions, parses XML output. Methods: `generateRules()`, `process()`, `generateInitialEmail()` |
| **ConversationContext** | `conversation-context.ts` | Tracks full conversation history — no truncation, full context in every LLM call |
| **XML Parser** | `xml-parser.ts` | Extracts content from XML tags (`<systematic_evaluation>`, `<decision>`, `<response>`) and parses action from decision text |
| **Prompts** | `prompts.ts` | LLM prompt builders: `buildRulesGenerationPrompt()`, `buildAgentPrompt()`, `buildInitialEmailPrompt()` |
| **Types** | `types.ts` | OrderInformation schema (Zod-validated), AgentAction, AgentProcessRequest/Response, currency normalization |

**CLI Tools** (`src/cli/`): 4 harnesses for testing — `extract` (rules generation), `pipeline` (scenario fixtures), `chat` (interactive multi-turn), `session` (automated with expectations).

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

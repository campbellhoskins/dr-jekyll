# PO Pro - Product Specification

**Version:** MVP / V1
**Date:** February 2026

---

## 1. Product Overview

### 1.1 Summary

PO Pro is an AI agent that executes routine purchase order conversations with existing suppliers on behalf of merchants. The agent operates within explicit guardrails and escalates exceptions to humans.

The MVP replaces email back-and-forth, not purchasing strategy.

**Success criteria:** Merchants save time and feel confident nothing bad will happen.

### 1.2 Product Name

- **Application name:** PO Pro
- **System email sender:** notifications@popro.com (or similar domain)
- **Email signature:** "Best, [Merchant Name] (sent via PO Pro)"

### 1.3 Target User

- Merchant with 20-500 SKUs
- Reorders same products regularly
- Works with 1-5 primary overseas suppliers
- Communicates via email
- Founder or ops manager handles purchasing

**Not:** Enterprises, marketplaces, or brands with procurement teams.

### 1.4 Value Proposition

"Give us your purchasing rules. We run the supplier conversation. You approve the result."

---

## 2. Technical Architecture

See [docs/architecture.md](./architecture.md) for full tech stack, system design diagrams, component details, deployment architecture, monitoring, and security.

---

## 3. Data Models

### 3.1 Merchant

```
Merchant {
  id: UUID
  email: String (Google account email)
  businessName: String
  businessDescription: String
  communicationStyle: Text (nullable, merchant's voice/tone — e.g. "direct and concise", "warm and relationship-focused", "formal with detailed context")
  createdAt: DateTime
  updatedAt: DateTime
}
```

A merchant's `communicationStyle` captures their consistent voice across all supplier interactions. While the specific negotiation tactic (ask for quote vs. state price) varies per supplier, the merchant's overall tone, vocabulary, and personality remain the same.

### 3.2 Gmail Connection

```
GmailConnection {
  id: UUID
  merchantId: UUID (FK)
  accessToken: String (encrypted)
  refreshToken: String (encrypted)
  tokenExpiry: DateTime
  status: Enum (active, revoked, error)
  createdAt: DateTime
  updatedAt: DateTime
}
```

### 3.3 Supplier

Suppliers are **global entities** — not scoped to any single merchant. When multiple merchants work with the same supplier, the system accumulates intelligence about that supplier's behavior, response patterns, and negotiation tendencies across all interactions. This shared knowledge enables the agent to work more effectively with well-known suppliers over time.

```
Supplier {
  id: UUID
  name: String
  email: String (unique - globally identifies the supplier)

  // Learned intelligence (updated by system over time from all merchant interactions)
  communicationStyle: Text (nullable, the supplier's own voice — e.g. "formal, sends detailed PDF quotes", "casual, responds briefly with inline pricing", "slow to reply but thorough")
  avgResponseTimeHours: Float (nullable)
  negotiationPatterns: Text (nullable, LLM-generated summary of supplier negotiation tendencies)
  commonPaymentTerms: String (nullable, e.g. "NET 30, T/T")
  typicalLeadTimeDays: String (nullable, e.g. "14-21")
  totalInteractions: Integer (default 0)

  createdAt: DateTime
  updatedAt: DateTime
}
```

A supplier's `communicationStyle` is learned over time and captures their consistent voice and behavior across all merchant interactions — how formal they are, how they structure responses, whether they use attachments, etc. This helps the agent tailor its outreach to match what the supplier expects.

### 3.4 Merchant-Supplier Relationship

Each merchant's relationship with a supplier is configured independently. This is where per-relationship settings like negotiation style, email templates, and rules live. A single merchant will typically have different negotiation styles for different suppliers, and two merchants working with the same supplier will each have their own configuration.

```
MerchantSupplier {
  id: UUID
  merchantId: UUID (FK)
  supplierId: UUID (FK)
  negotiationStyle: Enum (ask_for_quote, state_price_upfront)
  emailTemplate: Text (nullable, set after first approved email)
  createdAt: DateTime
  updatedAt: DateTime

  // Unique constraint on (merchantId, supplierId)
}
```

### 3.5 SKU

SKUs are scoped to the merchant-supplier relationship because each merchant may have different identifiers, negotiated prices, and MOQs for the same product from the same supplier.

```
SKU {
  id: UUID
  merchantSupplierId: UUID (FK → MerchantSupplier)
  merchantSku: String (merchant's identifier)
  supplierSku: String (supplier's identifier)
  lastKnownPrice: Decimal
  moq: Integer
  unitOfMeasure: String (units, boxes, kg, etc.)
  createdAt: DateTime
  updatedAt: DateTime
}
```

### 3.6 Merchant Instructions

Merchant instructions are defined per merchant-supplier relationship. The merchant writes a single block of plain-English text containing negotiation rules, escalation triggers, and product preferences — all in one field. The system classifies this input into internal categories (rules, triggers, special instructions) via LLM before processing.

```
MerchantInstructions {
  id: UUID
  merchantSupplierId: UUID (FK → MerchantSupplier)
  instructionsText: Text (plain English — rules, triggers, and preferences combined)
  createdAt: DateTime
  updatedAt: DateTime
}
```

**Example:**
```
I want green flip flop shoes at $40 each. Don't go above $50 — if they
can't do $50 or less, let me know. If the product is discontinued,
stop and tell me. Prefer NET 30 payment terms.
```

The system internally classifies this into:
- **Negotiation rules:** "Target price $40. Acceptable up to $50. Prefer NET 30."
- **Escalation triggers:** "Escalate if price exceeds $50. Escalate if product discontinued."
- **Special instructions:** "Green flip flop shoes."

### 3.7 Order

```
Order {
  id: UUID
  merchantId: UUID (FK)
  merchantSupplierId: UUID (FK → MerchantSupplier)
  skuId: UUID (FK)
  quantityMin: Integer
  quantityMax: Integer (nullable, if range provided)
  specialInstructions: Text (nullable)
  status: Enum (see 3.8)
  takenOverByMerchant: Boolean (default false)
  createdAt: DateTime
  updatedAt: DateTime
}
```

### 3.8 Order Statuses

```
OrderStatus {
  draft           // Order created but not yet sent to supplier
  awaiting_quote  // Initial email sent, waiting for supplier response
  negotiating     // Back-and-forth in progress
  pending_approval // Agent reached agreement, waiting for merchant
  approved        // Merchant approved, confirmation sent to supplier
  confirmed       // Supplier acknowledged, order complete
  cancelled       // Merchant cancelled the order
  escalated       // Handed to merchant due to issue
  paused          // Gmail permissions revoked, waiting for reconnection
}
```

### 3.9 Conversation

```
Conversation {
  id: UUID
  orderId: UUID (FK)
  gmailThreadId: String
  createdAt: DateTime
  updatedAt: DateTime
}
```

### 3.10 Message

```
Message {
  id: UUID
  conversationId: UUID (FK)
  gmailMessageId: String
  direction: Enum (inbound, outbound)
  sender: String (email address)
  recipient: String (email address)
  subject: String
  bodyText: Text
  bodyHtml: Text (nullable)
  attachments: JSON (nullable, list of attachment metadata)
  sentByAgent: Boolean
  sentByMerchant: Boolean
  createdAt: DateTime
}
```

### 3.11 Extracted Quote Data

```
ExtractedQuote {
  id: UUID
  messageId: UUID (FK)
  orderId: UUID (FK)
  quotedPrice: Decimal (nullable)
  quotedPriceCurrency: String (default USD)
  quotedPriceUsd: Decimal (converted to USD)
  availableQuantity: Integer (nullable)
  moq: Integer (nullable)
  leadTimeDays: Integer (nullable)
  paymentTerms: String (nullable)
  validityPeriod: String (nullable)
  rawExtractionJson: JSON (full LLM extraction output)
  createdAt: DateTime
}
```

### 3.12 Price History

```
PriceHistory {
  id: UUID
  skuId: UUID (FK)
  supplierId: UUID (FK → Supplier, for cross-merchant price intelligence)
  merchantSupplierId: UUID (FK → MerchantSupplier)
  quotedPrice: Decimal
  quotedPriceCurrency: String
  quotedPriceUsd: Decimal
  quantity: Integer
  sourceOrderId: UUID (FK)
  createdAt: DateTime
}
```

### 3.13 Approval Request

```
ApprovalRequest {
  id: UUID
  orderId: UUID (FK)
  proposedQuantity: Integer
  proposedPrice: Decimal
  proposedPriceCurrency: String
  proposedPriceUsd: Decimal
  proposedTotal: Decimal
  proposedLeadTimeDays: Integer (nullable)
  summary: Text (agent-generated summary of negotiation)
  reasoning: Text (why this satisfies merchant's rules)
  status: Enum (pending, approved, modified, declined, taken_over)
  merchantDecisionAt: DateTime (nullable)
  createdAt: DateTime
  updatedAt: DateTime
}
```

### 3.14 Modification Request

```
ModificationRequest {
  id: UUID
  approvalRequestId: UUID (FK)
  modifiedQuantity: Integer (nullable)
  modifiedPrice: Decimal (nullable)
  specialInstructions: Text (nullable)
  draftEmail: Text (agent-generated counter-offer draft)
  status: Enum (pending_approval, approved, rejected)
  createdAt: DateTime
  updatedAt: DateTime
}
```

### 3.15 Notification

```
Notification {
  id: UUID
  merchantId: UUID (FK)
  orderId: UUID (FK, nullable)
  type: Enum (offer_received, reminder, escalation, supplier_replied, error, gmail_disconnected, no_supplier_response)
  subject: String
  body: Text
  sentAt: DateTime (nullable)
  createdAt: DateTime
}
```

### 3.16 Audit Log

```
AuditLog {
  id: UUID
  merchantId: UUID (FK)
  orderId: UUID (FK, nullable)
  eventType: String
  eventData: JSON
  sessionContext: JSON (browser, IP, timestamp, etc.)
  createdAt: DateTime
}
```

**Audit event types:**
- `email_sent`
- `email_received`
- `llm_decision` (includes full reasoning, provider used, model, retry/fallback details)
- `policy_evaluation` (includes rule matching details)
- `merchant_action` (approve, modify, cancel, take_over, resume)
- `order_status_change`
- `error_occurred`
- `escalation_triggered`
- `supplier_intelligence_updated` (supplier memory/patterns updated from interaction)

---

## 4. User Flows

### 4.1 Onboarding Flow

1. **Sign in with Google** - Merchant authenticates via Google OAuth
2. **Connect Gmail** - OAuth permissions for send/read Gmail access
3. **Enter business info** - Business name + brief description + communication style (optional, e.g. "direct and concise" or "warm and relationship-focused")
4. **Add first supplier** - Search by email or create new; configure relationship (negotiation style, SKUs, prices, MOQ, instructions)
5. **Ready** - Merchant can create first order

### 4.2 Add Supplier Flow

1. Merchant navigates to "Suppliers" section
2. Clicks "Add Supplier"
3. Enters supplier email address
   - **If supplier already exists in system:** Auto-populates supplier name; system may display learned intelligence summary (e.g., "This supplier typically responds within 24 hours and commonly offers NET 30 terms")
   - **If new supplier:** Merchant enters supplier name; new global Supplier record is created
4. Configures their relationship with this supplier:
   - Negotiation style (ask for quote / state price upfront)
5. Adds SKUs for this supplier relationship:
   - Merchant's SKU identifier
   - Supplier's SKU/name
   - Last known price (USD)
   - MOQ
   - Unit of measure
6. Enters instructions (single plain-English field — rules, triggers, and preferences combined)
7. Saves supplier relationship (creates MerchantSupplier record)

### 4.3 Create Order Flow

1. Merchant navigates to "New Order"
2. Selects supplier from dropdown
3. Selects SKU (one SKU per order for MVP)
4. Enters quantity or quantity range (e.g., "300" or "300-600")
5. Optionally adds special instructions for this order
6. Clicks "Create Order"
7. **If first order to this supplier:**
   - Agent drafts initial email
   - Merchant reviews and approves the email
   - Approved email becomes template for future orders
8. **If subsequent order:**
   - Agent uses saved template
   - Sends automatically (no review needed)
9. Order status → `awaiting_quote`

### 4.4 Agent Negotiation Flow

1. **Receive supplier reply:**
   - Agent polls Gmail every 5-15 minutes
   - Detects reply from registered supplier email to active thread

2. **Parse response:**
   - Extract from email body: price, quantity, MOQ, lead time, payment terms, validity
   - If attachments (PDF/Excel): parse for pricing info
   - If extraction fails: ask supplier for clarification
   - If still unclear after clarification: escalate to merchant

3. **Evaluate against policy:**
   - Compare extracted data vs merchant's negotiation rules
   - Determine if offer is acceptable, needs counter, or requires escalation
   - Log policy evaluation with full reasoning

4. **Take action:**
   - **Acceptable:** Move to pending approval
   - **Counter needed:** Draft and send counter-offer
   - **Escalation trigger hit:** Escalate to merchant
   - **Unexpected response (e.g., product discontinued):** Immediate escalation

5. **LLM judgment on conversation progress:**
   - Agent decides whether negotiation is making progress
   - No fixed limit on exchanges
   - Escalates if stuck or not progressing

### 4.5 Approval Flow

1. Agent reaches tentative agreement
2. Creates ApprovalRequest with:
   - Proposed quantity, price, total, lead time
   - Summary of negotiation back-and-forth
   - Reasoning explaining why this satisfies merchant's rules
3. Order status → `pending_approval`
4. **Notification sent:** Email to merchant "You have received an offer" (includes supplier name, link to dashboard)
5. **Reminder schedule:** Every 24 hours until decided
6. **Hold message:** After 48 hours with no decision, agent sends polite "hold" message to supplier

### 4.6 Merchant Decision Options

**Approve:**
1. Merchant clicks "Approve"
2. Agent sends confirmation email to supplier
3. Order status → `approved`
4. Agent waits for supplier acknowledgment

**Modify:**
1. Merchant clicks "Modify"
2. Merchant adjusts: quantity, price, or both
3. Merchant optionally adds special instructions
4. Agent drafts counter-offer email
5. Merchant reviews draft
6. Merchant approves draft → agent sends counter-offer
7. Order status → `negotiating`

**Take Over:**
1. Merchant clicks "Take Over"
2. Order marked as `takenOverByMerchant = true`
3. Agent continues monitoring thread silently
4. Agent alerts merchant when supplier replies (does not respond)
5. Merchant can click "Resume Agent" anytime
6. On resume: agent ingests all messages from takeover period into context

**Decline:**
1. Merchant clicks "Decline"
2. Confirmation required
3. Agent sends polite cancellation to supplier
4. Order status → `cancelled`

### 4.7 Order Confirmation Flow

1. Merchant approves → agent sends confirmation email
2. Agent waits for supplier acknowledgment
3. **If no acknowledgment after 48 hours:** Agent sends follow-up
4. **If no acknowledgment after 96 hours:** Agent sends second follow-up AND alerts merchant
5. **When supplier acknowledges:** Order status → `confirmed`

### 4.8 Cancellation Flow

1. Merchant can cancel any order before `confirmed` status
2. Merchant clicks "Cancel Order"
3. Confirmation dialog: "Are you sure you want to cancel this order?"
4. Merchant confirms
5. Agent sends polite cancellation email to supplier
6. Order status → `cancelled`

---

## 5. Email Integration

### 5.1 Gmail OAuth Scope

Required permissions:
- `gmail.send` - Send emails on behalf of user
- `gmail.readonly` - Read emails to monitor replies
- `gmail.modify` - Mark emails as read, manage labels

### 5.2 Email Monitoring

- **Method:** Polling every 5-15 minutes via Vercel Cron
- **Scope:** Only monitor replies from registered supplier email addresses to threads started by the agent
- **Processing:** Heavy processing (LLM reasoning) offloaded to Railway worker

### 5.3 Email Parsing

**From email body, extract:**
1. Quoted price (per unit)
2. Available quantity
3. MOQ (if mentioned)
4. Lead time (days/weeks)
5. Payment terms (if mentioned)
6. Validity period (if mentioned)

**From attachments:**
- Parse PDF attachments for pricing info
- Parse Excel attachments for pricing info
- Flag unparseable attachments for merchant review

### 5.4 Email Language

- **MVP:** English only
- Emails from suppliers in other languages require escalation

### 5.5 Email Templates

- **Scope:** Per merchant-supplier relationship, editable (each merchant has their own template for each supplier)
- **Creation:** First email to a supplier requires merchant approval; approved email becomes template
- **Modification:** Merchant can edit templates from supplier settings

### 5.6 Email Signature

All outgoing emails end with:
```
Best,
[Merchant Name]
(sent via PO Pro)
```

### 5.7 Email Tone

- Defaults to professional tone (polite, business-like, no slang)
- Adapts to the merchant's `communicationStyle` when configured — the agent writes in the merchant's voice
- Agent also factors in the supplier's learned `communicationStyle` to calibrate formality and structure

### 5.8 Gmail Disconnection Handling

If Gmail permissions are revoked:
1. All active orders for merchant → status `paused`
2. Alert merchant via system email: "Gmail disconnected - please reconnect"
3. Dashboard shows error state
4. Orders resume automatically when Gmail reconnected

### 5.9 Email Bounce Handling

If email to supplier bounces:
1. Retry once after delay
2. If still failing, alert merchant: "Email to [supplier email] failed to deliver"

---

## 6. System Notifications

### 6.1 Notification Types

| Type | Subject | Trigger |
|------|---------|---------|
| Offer received | "You have received an offer" | Agent reaches tentative agreement |
| Reminder | "You have an offer waiting" | 24 hours since last reminder, offer still pending |
| Escalation | "Action needed: [supplier name] order requires your attention" | Agent escalates due to ambiguity, policy conflict, unexpected response, or extraction failure |
| Supplier replied | "Supplier [name] has replied" | Supplier replies while merchant has taken over |
| Error | "Action required: [error type]" | Gmail disconnected, email bounce, etc. |
| No supplier response | "No response from [supplier name]" | 48h follow-up sent + 48h more with no response |

### 6.2 Delivery

- **Method:** Transactional email via SendGrid or Resend
- **From address:** notifications@popro.com (or similar)
- **To address:** Merchant's Google account email

---

## 7. Agent Behavior

### 7.1 Core Principles

1. **Reliability > Intelligence** - Boring, predictable behavior wins
2. **No hallucinated commitments** - If uncertain, escalate
3. **Full transparency** - Every action explainable
4. **Never surprise the user** - Trust accumulation is the product

### 7.2 Communication & Negotiation Style

Style operates at three levels:

**1. Merchant voice (Merchant record → `communicationStyle`)**
A merchant's tone, vocabulary, and personality are consistent across all their supplier interactions. One merchant might be direct and concise; another warm and relationship-focused. The agent writes all outgoing emails in the merchant's voice regardless of which supplier the email is to.

**2. Supplier voice (Supplier record → `communicationStyle`)**
Each supplier has their own consistent communication patterns — learned by the system over time. Some suppliers are formal and send detailed PDF quotes; others reply casually with inline pricing. The agent uses this to anticipate supplier behavior, interpret responses, and calibrate follow-up timing.

**3. Negotiation tactic (MerchantSupplier record → `negotiationStyle`)**
The specific negotiation approach varies per merchant-supplier relationship:
- **Ask for quote:** "What's your current price for 500 units of X?"
- **State price upfront:** "We'd like to order 500 units at $4.00/unit"

A single merchant will use different tactics for different suppliers, and two merchants working with the same supplier may each choose a different approach. Stored on the MerchantSupplier record and applied automatically to all future orders for that relationship.

**How they combine:** When generating an email, the agent writes in the merchant's voice, applies the relationship-specific negotiation tactic, and factors in what it knows about the supplier's communication style to produce the most effective message.

### 7.3 Policy Evaluation

1. Merchant's order information is transformed via LLM into ORDER_CONTEXT (factual summary) and MERCHANT_RULES (behavioral rules, escalation triggers) — generated once and cached across turns
2. Include supplier intelligence context (known patterns, tendencies) when available
3. Compare supplier response against classified negotiation rules
4. Check classified escalation triggers (checked first — any trigger fires → escalate)
5. Generate structured evaluation:
   - Which rules match
   - Compliance status
   - Recommended action
   - Full reasoning (including any supplier intelligence that informed the decision)
6. Log evaluation in audit trail

### 7.4 Counter-Offer Generation

When counter-offer needed:
1. Determine appropriate counter based on rules
2. Generate professional email text
3. Send automatically (unless modification flow)
4. Log with full reasoning

### 7.5 Escalation Triggers

Immediate escalation to merchant when:
- Ambiguity in supplier response
- Policy conflict (can't satisfy all rules)
- Supplier proposes unexpected terms
- Model confidence low
- Supplier sends deal-breaker (e.g., "product discontinued")
- Extraction fails after clarification attempt
- LLM returns unparseable response after retries

### 7.6 Context Management

- **Window:** Full conversation history — all messages included in every LLM call. No rolling window, no truncation, no summarization. Accuracy is the priority; token costs are not a constraint.
- **Extraction:** Every turn re-processes the full conversation thread plus merged prior extraction data. The LLM sees the complete email chain to make the most accurate extraction possible.
- **Order context includes:** SKU details, merchant instructions (single field, internally classified into rules/triggers/instructions), merchant communication style, supplier intelligence (behavioral patterns and communication style)
- **Design principle:** Always choose the most accurate approach regardless of API costs or token usage. Token optimization is explicitly not a priority.

### 7.7 LLM Error Handling

Handled internally by the LLM Service — callers do not manage retries or provider selection:

1. Primary provider (Claude) returns unexpected/unparseable response or error
2. LLM Service retries with the primary provider 2-3 times
3. If primary provider exhausts retries, LLM Service automatically routes the same prompt + context to the fallback provider (OpenAI)
4. If fallback provider also fails after retries, escalate to merchant
5. All attempts are logged in the audit trail with provider used, model, response, and failure reason

### 7.8 Supplier Intelligence

Because suppliers are global entities shared across merchants, the system accumulates knowledge about each supplier over time. This intelligence improves the agent's effectiveness as more merchants interact with the same supplier.

**What the system learns:**
- **Response time patterns:** Average time to reply, business hours/days
- **Negotiation tendencies:** Does the supplier counter-offer? Hold firm? Give volume discounts?
- **Common terms:** Typical payment terms, MOQs, and lead times this supplier offers
- **Communication style:** Formal vs. casual, preferred formats, attachment habits
- **Reliability signals:** How often they acknowledge orders, follow through on quoted terms

**How intelligence is gathered:**
1. After each completed order conversation, the agent summarizes observed supplier behavior
2. LLM generates/updates a supplier behavior profile from accumulated interaction data
3. Intelligence fields on the Supplier record are updated incrementally
4. `totalInteractions` counter is incremented

**How intelligence is used:**
- Surfaced to merchants when adding a known supplier ("This supplier typically responds in 24h")
- Fed into the agent's context when generating emails or evaluating responses
- Helps the agent anticipate supplier behavior and set appropriate follow-up timing
- Over time, enables better counter-offer strategies based on known supplier flexibility

**Privacy boundaries:**
- Supplier intelligence captures behavioral patterns only, never specific pricing or terms from other merchants' orders
- Individual merchant negotiation details, prices, and volumes are never shared across merchants
- Intelligence is limited to observable communication patterns and general tendencies

---

## 8. Currency Handling

### 8.1 Default Currency

- All merchant-facing values displayed in USD
- Last known prices stored in USD
- Price history stored in USD

### 8.2 Multi-Currency Support

If supplier quotes in non-USD currency:
1. Detect currency from email/attachment
2. Convert to USD using exchange rate API
3. Reason and evaluate in USD
4. Report to merchant in USD
5. Store both original currency and USD values

### 8.3 Exchange Rate API

- Provider: Open Exchange Rates or ExchangeRate-API (free tier)
- Rates cached for reasonable period (e.g., 1 hour)

---

## 9. Dashboard

### 9.1 Main View

**Active Orders List:**
- All orders with status badge
- Supplier name
- SKU name
- Created date
- Last activity

**Pending Actions (highlighted):**
- Orders in `pending_approval` status
- Orders in `escalated` status
- Clear visual distinction (e.g., yellow/orange highlight)

### 9.2 Order Detail View

**Header:**
- Order ID
- Status badge
- Supplier name
- SKU details
- Quantity requested

**Conversation Section:**
- Full email thread (all messages)
- Agent-generated summary of negotiation back-and-forth
- Visual distinction between agent messages and supplier messages
- Visual distinction for merchant messages (if taken over)

**Extracted Data Section:**
- Current quoted price
- Quantity
- Lead time
- Payment terms
- Other extracted fields

**Actions Section (based on status):**
- `pending_approval`: Approve, Modify, Take Over, Decline
- `escalated`: Take Over, Cancel
- `negotiating`: Take Over, Cancel
- Taken over: Resume Agent, Cancel

**Audit Trail Section:**
- Collapsible log of all events
- Policy evaluations with reasoning
- LLM decisions with reasoning

### 9.3 Supplier Management

**Supplier List:**
- All suppliers the merchant has a relationship with
- Quick stats (active orders, total orders)
- Supplier intelligence badge (if system has learned data, e.g., "Fast responder")

**Supplier Detail:**
- Name, email
- Supplier intelligence summary (read-only, system-generated — response times, negotiation tendencies, etc.)
- Negotiation style for this relationship (view/edit)
- Email template for this relationship (view/edit)
- Instructions for this relationship (single plain-English field, view/edit)
- SKUs list for this relationship

**SKU Management:**
- Add/edit/remove SKUs
- View price history per SKU

### 9.4 Settings

- Business name (edit)
- Business description (edit)
- Communication style (edit — describes the merchant's voice and tone for all outgoing emails)
- Gmail connection status (reconnect if needed)
- Sign out

---

## 10. Authentication

### 10.1 Method

- Google OAuth only (via NextAuth.js)
- No email/password option

### 10.2 Session

- Secure, HTTP-only cookies
- Reasonable session duration

### 10.3 Account Limits

- Single user per merchant account (MVP)
- No team/multi-user support in MVP

---

## 11. Timing & Schedules

### 11.1 Email Polling

- **Frequency:** Every 5-15 minutes
- **Method:** Vercel Cron triggers check, Railway worker processes

### 11.2 Approval Reminders

- **First notification:** Immediately when offer ready
- **Reminders:** Every 24 hours until decision made
- **Hold message to supplier:** After 48 hours with no decision

### 11.3 Supplier Response Timeout (Initial Quote)

- **Follow-up:** After 48 hours of no response
- **Alert merchant:** After another 48 hours (96 hours total)

### 11.4 Order Confirmation Timeout

- **Follow-up:** After 48 hours of no acknowledgment
- **Second follow-up + alert:** After another 48 hours (96 hours total)

---

## 12. Error Handling

### 12.1 Gmail API Failures

1. Retry for sufficient period to confirm error is persistent
2. Show error in dashboard
3. Alert merchant via system email
4. Pause affected orders

### 12.2 Email Bounce

1. Retry once after delay
2. If still failing, alert merchant

### 12.3 LLM Failures

See Section 7.7 (LLM Error Handling).

### 12.4 Extraction Failures

1. Ask supplier for clarification
2. If still unclear, escalate to merchant

### 12.5 Unexpected Supplier Responses

- Immediate escalation to merchant
- Examples: product discontinued, company policy changes, completely off-topic response

---

## 13. Audit & Logging

### 13.1 What Gets Logged

1. **Every email sent/received** - Full content, metadata
2. **Every LLM decision** - Prompt, response, reasoning, provider used, model, retry/fallback attempts
3. **Every merchant action** - Action type, session context (browser, IP, timestamp)
4. **Every policy evaluation** - Rules matched, compliance status, reasoning

### 13.2 Retention

- **Period:** Indefinite (keep forever)
- **Storage:** PostgreSQL with potential archive strategy later

### 13.3 Audit Trail Display

- Available in order detail view
- Collapsible/expandable sections
- Full transparency into agent decisions

---

## 14. Testing Strategy

### 14.1 Methodology

- **Test-Driven Development (TDD)**
- Write tests first that define expected behavior
- Implement features to pass tests
- Run full suite after each feature

### 14.2 Test Types

**Unit Tests:**
- Policy evaluation logic
- Price parsing
- Currency conversion
- Email content extraction
- Data validation

**Integration Tests:**
- Email flows (with mocked Gmail API)
- LLM Service interactions (with mocked providers, including fallback scenarios)
- Database operations
- Background job processing

**End-to-End Tests (Playwright):**
- Onboarding flow
- Add supplier flow
- Create order flow
- Approval flow (approve, modify, decline, take over)
- Dashboard navigation
- Settings management

### 14.3 Mocking Strategy

- Mock all external dependencies
- Fake Gmail API responses
- Fake LLM Service responses (both primary and fallback providers)
- Fake supplier email patterns
- Deterministic, reproducible tests

### 14.4 CI/CD

- Run full test suite on every commit
- Block deployment on test failures

---

## 15. Monitoring, Security & Infrastructure

See [docs/architecture.md](./architecture.md) for monitoring tools (Sentry, uptime, Vercel Analytics), security considerations (token encryption, OAuth, input validation, rate limiting), and deployment architecture.

---

## 16. MVP Scope Boundaries

### 17.1 In Scope

- Email-based supplier communication (Gmail only)
- Single merchant (self-testing)
- Suppliers as global entities with accumulated intelligence/memory
- Known suppliers (manually configured per merchant relationship)
- Known SKUs (manually configured per merchant-supplier relationship)
- One SKU per order
- Guardrail-based negotiation (plain English rules, per relationship)
- Human approval before commitment
- Full audit trail
- English language only
- USD as display currency (with conversion from others)
- Professional email tone (default), adaptable to merchant's configured communication style

### 17.2 Out of Scope (Future)

- Demand forecasting
- Supplier discovery
- Freight booking
- Payments / billing
- Cross-merchant benchmarking (foundation exists via global supplier model, but explicit benchmarking features are post-MVP)
- Autonomous approval (no human in loop)
- WhatsApp/WeChat integrations
- Multi-location allocation
- Outlook/other email providers
- Multi-SKU orders
- Multi-user accounts
- Non-English languages
- Shopify integration
- Invite system / waitlist
- Stripe billing

---

## 17. Success Metrics

### 18.1 Usage

- Orders created per week
- Orders completed successfully
- Repeat usage (orders per month)

### 18.2 Trust

- Approval rate (approved vs modified vs declined)
- Escalation rate (should be balanced - not too high, not too low)
- Take-over rate

### 18.3 Value

- Time from order creation to confirmation
- Number of manual interventions required

### 18.4 Reliability

- Error rate
- Successful email delivery rate
- LLM Service success rate (primary provider success, fallback activation rate, total escalations due to LLM failure)

---

## 18. Failure Modes to Monitor

1. **Agent agrees incorrectly** - Commits to terms outside policy
2. **Supplier confusion** - Supplier doesn't understand agent emails
3. **Merchant bypass** - Merchant stops using system
4. **Too many escalations** - Agent not useful
5. **Too few escalations** - Agent taking risks
6. **Email deliverability issues** - Emails going to spam
7. **Parsing failures** - Can't extract data from supplier emails

---

## Appendix A: Example Merchant Instructions

The merchant writes a single block of text. The system classifies it internally.

```
I'm ordering bamboo cutting boards. Target price is $3.80 per unit,
but I'll accept up to $4.20. Ask for a discount if ordering more than
500 units. Prefer 30-day payment terms, but NET 15 is acceptable.
Always confirm lead time before agreeing.

If the price goes above $4.20, let me know. Same if lead time exceeds
30 days, MOQ is higher than 1000, they want prepayment, or they
mention any quality or specification changes.
```

The system classifies this into:
- **Rules:** Target $3.80, acceptable $3.50-$4.20, volume discount >500, prefer 30-day terms, confirm lead time
- **Triggers:** Price >$4.20, lead time >30 days, MOQ >1000, prepayment, quality/spec changes
- **Instructions:** Bamboo cutting boards

---

## Appendix B: Example Email Templates

**Initial Quote Request:**
```
Subject: Quote Request - [SKU Name]

Hi [Supplier Name],

I hope this email finds you well.

We would like to request a quote for the following:

Product: [SKU Name] ([Supplier SKU])
Quantity: [Quantity or Range]

Please provide:
- Unit price
- Lead time
- Any applicable MOQ

Thank you for your assistance.

Best,
[Merchant Name]
(sent via PO Pro)
```

**Counter-Offer:**
```
Subject: Re: Quote Request - [SKU Name]

Hi [Supplier Name],

Thank you for the quote.

We were hoping for a price closer to $[target price] per unit given our order volume. Would you be able to accommodate this?

Best,
[Merchant Name]
(sent via PO Pro)
```

**Order Confirmation:**
```
Subject: Re: Quote Request - [SKU Name] - Order Confirmation

Hi [Supplier Name],

Thank you for working with us on pricing.

Please proceed with the following order:

Product: [SKU Name] ([Supplier SKU])
Quantity: [Quantity]
Price: $[Price] per unit
Total: $[Total]
Lead Time: [Lead Time]

Please confirm receipt of this order.

Best,
[Merchant Name]
(sent via PO Pro)
```

---

## Appendix C: Order State Machine

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌───────────────┐
│  draft  │───▶│awaiting_quote│───▶│ negotiating │───▶│pending_approval│
└─────────┘    └─────────────┘    └─────────────┘    └───────────────┘
                    │                    │                    │
                    │                    │                    ├──▶ approved ──▶ confirmed
                    │                    │                    │
                    │                    ▼                    ├──▶ cancelled
                    │              ┌───────────┐              │
                    └─────────────▶│ escalated │◀─────────────┤
                                   └───────────┘              │
                                         │                    │
                                         ▼                    │
                                   ┌───────────┐              │
                                   │ cancelled │◀─────────────┘
                                   └───────────┘

                    ┌─────────┐
                    │ paused  │ (Gmail disconnected - can transition to any active state when reconnected)
                    └─────────┘
```

---

*End of Product Specification*

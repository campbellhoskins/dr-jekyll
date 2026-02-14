# PO Pro - Implementation Plan

**Version:** 1.0
**Date:** February 2026

---

## Overview

This document breaks down the PO Pro MVP into discrete, parallelizable implementation phases. The frontend and backend are developed as separate tracks with a well-defined API contract, allowing both to progress independently.

### Key Principles

1. **Parallel Development** - Frontend and backend can be implemented simultaneously
2. **Contract-Driven** - API contracts define the interface; frontend uses mocks until backend is ready
3. **Agent-First Backend** - Start with agent workflow correctness before adding integrations
4. **Incremental Complexity** - Each phase builds on the previous without requiring rewrites

---

## Track Overview

```
FRONTEND TRACK                              BACKEND TRACK
═══════════════                             ═════════════

┌─────────────────────┐                     ┌─────────────────────┐
│ F1: Foundation      │                     │ B1: Agent Core      │
│ (Auth, Layout, Nav) │                     │ (Structured Output) │
└─────────┬───────────┘                     └─────────┬───────────┘
          │                                           │
          ▼                                           ▼
┌─────────────────────┐                     ┌─────────────────────┐
│ F2: Dashboard &     │                     │ B2: Data Layer      │
│ Orders UI           │ ◄─── CONTRACT ────► │ (DB, CRUD APIs)     │
└─────────┬───────────┘                     └─────────┬───────────┘
          │                                           │
          ▼                                           ▼
┌─────────────────────┐                     ┌─────────────────────┐
│ F3: Supplier        │                     │ B3: Agent + Memory  │
│ Management UI       │                     │ (Context, History)  │
└─────────┬───────────┘                     └─────────┬───────────┘
          │                                           │
          ▼                                           ▼
┌─────────────────────┐                     ┌─────────────────────┐
│ F4: Approval &      │                     │ B4: Email           │
│ Action Flows        │                     │ Integration         │
└─────────┬───────────┘                     └─────────┬───────────┘
          │                                           │
          ▼                                           ▼
┌─────────────────────┐                     ┌─────────────────────┐
│ F5: Settings &      │                     │ B5: Background      │
│ Onboarding          │                     │ Workers & Notifs    │
└─────────────────────┘                     └─────────────────────┘
```

---

## API Contract

The contract defines all API endpoints. Frontend implements against mocks; backend implements the actual logic.

### Authentication Endpoints

```typescript
// POST /api/auth/[...nextauth]
// NextAuth.js handles Google OAuth
// Returns session with user info

interface Session {
  user: {
    id: string;
    email: string;
    name: string;
  };
  merchantId: string;
}
```

### Merchant Endpoints

```typescript
// GET /api/merchant
interface MerchantResponse {
  id: string;
  email: string;
  businessName: string;
  businessDescription: string;
  gmailConnected: boolean;
  createdAt: string;
}

// PATCH /api/merchant
interface UpdateMerchantRequest {
  businessName?: string;
  businessDescription?: string;
}
```

### Supplier Endpoints

```typescript
// GET /api/suppliers
interface SuppliersResponse {
  suppliers: Supplier[];
}

interface Supplier {
  id: string;
  name: string;
  email: string;
  negotiationStyle: 'ask_for_quote' | 'state_price_upfront';
  emailTemplate: string | null;
  skuCount: number;
  activeOrderCount: number;
  createdAt: string;
}

// GET /api/suppliers/:id
interface SupplierDetailResponse extends Supplier {
  skus: SKU[];
  negotiationRules: NegotiationRules;
}

interface SKU {
  id: string;
  merchantSku: string;
  supplierSku: string;
  lastKnownPrice: number;
  moq: number;
  unitOfMeasure: string;
}

interface NegotiationRules {
  id: string;
  rulesText: string;
  escalationTriggersText: string;
}

// POST /api/suppliers
interface CreateSupplierRequest {
  name: string;
  email: string;
  negotiationStyle: 'ask_for_quote' | 'state_price_upfront';
  skus: CreateSKURequest[];
  negotiationRules: {
    rulesText: string;
    escalationTriggersText: string;
  };
}

// PUT /api/suppliers/:id
// DELETE /api/suppliers/:id

// SKU sub-endpoints
// POST /api/suppliers/:id/skus
// PUT /api/suppliers/:id/skus/:skuId
// DELETE /api/suppliers/:id/skus/:skuId
```

### Order Endpoints

```typescript
// GET /api/orders
interface OrdersResponse {
  orders: OrderSummary[];
}

interface OrderSummary {
  id: string;
  supplierName: string;
  skuName: string;
  quantity: string; // "300" or "300-600"
  status: OrderStatus;
  createdAt: string;
  lastActivity: string;
  requiresAction: boolean;
}

type OrderStatus =
  | 'draft'
  | 'awaiting_quote'
  | 'negotiating'
  | 'pending_approval'
  | 'approved'
  | 'confirmed'
  | 'cancelled'
  | 'escalated'
  | 'paused';

// GET /api/orders/:id
interface OrderDetailResponse {
  id: string;
  supplier: Supplier;
  sku: SKU;
  quantityMin: number;
  quantityMax: number | null;
  specialInstructions: string | null;
  status: OrderStatus;
  takenOverByMerchant: boolean;
  createdAt: string;
  updatedAt: string;
  conversation: Conversation;
  currentQuote: ExtractedQuote | null;
  approvalRequest: ApprovalRequest | null;
  auditLog: AuditLogEntry[];
}

interface Conversation {
  id: string;
  messages: Message[];
  summary: string | null; // Agent-generated summary
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  sender: string;
  recipient: string;
  subject: string;
  bodyText: string;
  sentByAgent: boolean;
  sentByMerchant: boolean;
  createdAt: string;
}

interface ExtractedQuote {
  quotedPrice: number | null;
  quotedPriceCurrency: string;
  quotedPriceUsd: number;
  availableQuantity: number | null;
  moq: number | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
}

interface ApprovalRequest {
  id: string;
  proposedQuantity: number;
  proposedPrice: number;
  proposedPriceCurrency: string;
  proposedPriceUsd: number;
  proposedTotal: number;
  proposedLeadTimeDays: number | null;
  summary: string;
  reasoning: string;
  status: 'pending' | 'approved' | 'modified' | 'declined' | 'taken_over';
}

interface AuditLogEntry {
  id: string;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: string;
}

// POST /api/orders
interface CreateOrderRequest {
  supplierId: string;
  skuId: string;
  quantityMin: number;
  quantityMax?: number;
  specialInstructions?: string;
}

interface CreateOrderResponse {
  order: OrderDetailResponse;
  requiresEmailApproval: boolean; // true if first order to this supplier
  draftEmail?: string; // If requires approval, the draft to review
}

// POST /api/orders/:id/send
// Sends the initial email (used after draft approval)
interface SendOrderRequest {
  approvedEmailContent?: string; // Optional modifications to draft
}

// POST /api/orders/:id/approve
interface ApproveOrderRequest {
  approvalRequestId: string;
}

// POST /api/orders/:id/modify
interface ModifyOrderRequest {
  approvalRequestId: string;
  modifiedQuantity?: number;
  modifiedPrice?: number;
  specialInstructions?: string;
}

interface ModifyOrderResponse {
  modificationRequest: {
    id: string;
    draftEmail: string; // Counter-offer draft for review
  };
}

// POST /api/orders/:id/modify/:modificationId/send
// Approves and sends the counter-offer draft

// POST /api/orders/:id/decline
// POST /api/orders/:id/take-over
// POST /api/orders/:id/resume
// POST /api/orders/:id/cancel
```

### Agent Interaction Endpoints (for testing B1)

```typescript
// POST /api/agent/process
// Direct agent interaction for testing (no email layer)
interface AgentProcessRequest {
  orderId?: string; // Optional - for context
  supplierMessage: string; // Simulated supplier response
  negotiationRules: string;
  escalationTriggers: string;
  orderContext: {
    skuName: string;
    supplierSku: string;
    quantityRequested: string;
    lastKnownPrice: number;
    specialInstructions?: string;
  };
}

interface AgentProcessResponse {
  action: 'accept' | 'counter' | 'escalate' | 'clarify';
  reasoning: string;
  extractedData: {
    price?: number;
    currency?: string;
    quantity?: number;
    moq?: number;
    leadTimeDays?: number;
    paymentTerms?: string;
  };
  // If action is 'counter':
  counterOffer?: {
    draftEmail: string;
    proposedTerms: string;
  };
  // If action is 'accept':
  proposedApproval?: {
    quantity: number;
    price: number;
    total: number;
    summary: string;
  };
  // If action is 'escalate':
  escalationReason?: string;
  // If action is 'clarify':
  clarificationEmail?: string;
  // Full policy evaluation for debugging
  policyEvaluation: {
    rulesMatched: string[];
    complianceStatus: 'compliant' | 'non_compliant' | 'partial';
    details: string;
  };
}
```

### Gmail Connection Endpoints

```typescript
// GET /api/gmail/status
interface GmailStatusResponse {
  connected: boolean;
  email: string | null;
  status: 'active' | 'revoked' | 'error' | 'not_connected';
  lastSyncAt: string | null;
}

// POST /api/gmail/connect
// Initiates OAuth flow - returns redirect URL

// POST /api/gmail/disconnect
// Revokes connection
```

---

## Frontend Track

### F1: Foundation

**Goal:** Project setup, authentication UI, and base layout components.

**Deliverables:**
- Next.js 14 project with App Router
- Tailwind CSS + shadcn/ui components
- NextAuth.js configuration (Google OAuth)
- Protected route middleware
- Base layout with navigation
- Login page
- Loading states and error boundaries

**Mock Data:** None needed yet

**Dependencies:** None

**Files to Create:**
```
src/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Landing/login redirect
│   ├── (auth)/
│   │   └── login/page.tsx      # Login page
│   └── (dashboard)/
│       └── layout.tsx          # Dashboard layout with nav
├── components/
│   └── ui/                     # shadcn components
├── lib/
│   └── auth.ts                 # NextAuth config
└── middleware.ts               # Auth middleware
```

---

### F2: Dashboard & Orders UI

**Goal:** Order list view and order detail view with mock data.

**Deliverables:**
- Dashboard main page with order list
- Order status badges and filtering
- "Pending Actions" highlighted section
- Order detail page with:
  - Header (status, supplier, SKU info)
  - Conversation thread display
  - Extracted data display
  - Audit trail (collapsible)
- Create order modal/page

**Mock Data:**
```typescript
// src/lib/mocks/orders.ts
export const mockOrders: OrderSummary[] = [...];
export const mockOrderDetail: OrderDetailResponse = {...};
```

**API Hooks (with mock fallback):**
```typescript
// src/hooks/use-orders.ts
export function useOrders() {
  // Returns mock data until backend ready
}
```

**Files to Create:**
```
src/
├── app/(dashboard)/
│   ├── page.tsx                # Dashboard/orders list
│   └── orders/
│       ├── page.tsx            # Orders list (redirect to dashboard)
│       ├── new/page.tsx        # Create order
│       └── [id]/page.tsx       # Order detail
├── components/
│   ├── orders/
│   │   ├── order-list.tsx
│   │   ├── order-card.tsx
│   │   ├── order-status-badge.tsx
│   │   ├── order-detail-header.tsx
│   │   ├── conversation-thread.tsx
│   │   ├── extracted-quote-card.tsx
│   │   └── audit-trail.tsx
│   └── dashboard/
│       └── pending-actions.tsx
├── hooks/
│   └── use-orders.ts
└── lib/
    └── mocks/
        └── orders.ts
```

---

### F3: Supplier Management UI

**Goal:** Full supplier CRUD with SKUs and negotiation rules.

**Deliverables:**
- Suppliers list page
- Supplier detail page with:
  - Basic info display/edit
  - SKUs list with add/edit/delete
  - Negotiation rules editor
  - Escalation triggers editor
  - Email template viewer/editor
- Add supplier flow (multi-step form)
- Price history view per SKU

**Mock Data:**
```typescript
// src/lib/mocks/suppliers.ts
export const mockSuppliers: Supplier[] = [...];
export const mockSupplierDetail: SupplierDetailResponse = {...};
```

**Files to Create:**
```
src/
├── app/(dashboard)/
│   └── suppliers/
│       ├── page.tsx            # Suppliers list
│       ├── new/page.tsx        # Add supplier (wizard)
│       └── [id]/
│           ├── page.tsx        # Supplier detail
│           └── edit/page.tsx   # Edit supplier
├── components/
│   └── suppliers/
│       ├── supplier-list.tsx
│       ├── supplier-card.tsx
│       ├── supplier-form.tsx
│       ├── sku-table.tsx
│       ├── sku-form.tsx
│       ├── negotiation-rules-editor.tsx
│       ├── escalation-triggers-editor.tsx
│       └── email-template-editor.tsx
├── hooks/
│   └── use-suppliers.ts
└── lib/
    └── mocks/
        └── suppliers.ts
```

---

### F4: Approval & Action Flows

**Goal:** Implement all merchant decision flows.

**Deliverables:**
- Approval request card component
- Approve confirmation dialog
- Modify flow:
  - Quantity/price adjustment form
  - Special instructions input
  - Counter-offer preview
  - Draft approval step
- Decline with confirmation
- Take over / Resume buttons
- Cancel order flow
- Real-time status updates (optimistic UI)

**Files to Create:**
```
src/
├── components/
│   └── orders/
│       ├── approval-request-card.tsx
│       ├── approve-dialog.tsx
│       ├── modify-flow.tsx
│       ├── decline-dialog.tsx
│       ├── take-over-button.tsx
│       ├── resume-agent-button.tsx
│       ├── cancel-order-dialog.tsx
│       └── action-buttons.tsx  # Context-aware action display
└── hooks/
    └── use-order-actions.ts
```

---

### F5: Settings & Onboarding

**Goal:** Settings page and onboarding flow for new users.

**Deliverables:**
- Settings page:
  - Business name/description editor
  - Gmail connection status and reconnect
  - Sign out
- Onboarding wizard:
  - Welcome step
  - Connect Gmail step
  - Business info step
  - Add first supplier step
  - Completion/ready step
- Gmail OAuth callback handling

**Files to Create:**
```
src/
├── app/(dashboard)/
│   └── settings/
│       └── page.tsx            # Settings page
├── app/(auth)/
│   └── callback/
│       └── gmail/page.tsx      # Gmail OAuth callback
├── app/onboarding/
│   ├── layout.tsx              # Onboarding layout (no nav)
│   └── page.tsx                # Multi-step wizard
├── components/
│   ├── settings/
│   │   ├── business-info-form.tsx
│   │   ├── gmail-connection-card.tsx
│   │   └── sign-out-button.tsx
│   └── onboarding/
│       ├── onboarding-wizard.tsx
│       ├── welcome-step.tsx
│       ├── gmail-step.tsx
│       ├── business-step.tsx
│       ├── supplier-step.tsx
│       └── complete-step.tsx
└── hooks/
    └── use-onboarding.ts
```

---

## Backend Track

### B1: Agent Core (Structured Output)

**Goal:** Get the agent responding correctly to simulated supplier messages with properly structured output. No persistence, no email integration - just agent workflow validation.

**This is the critical foundation.** You should be able to:
1. Input a simulated supplier message
2. Input negotiation rules and context
3. Get back a structured response with:
   - Extracted data
   - Policy evaluation
   - Recommended action
   - Generated response (if applicable)

**Deliverables:**
- Claude API integration with structured output parsing
- Policy evaluation engine
- Email content extraction logic
- Counter-offer generation
- Decision logic (accept/counter/escalate/clarify)
- CLI tool or simple API for testing agent responses
- Comprehensive prompt templates

**Testing Approach:**
Create a simple test harness that lets you:
```bash
# Run agent against test scenarios
npm run agent:test

# Interactive mode - paste supplier emails, see agent response
npm run agent:interactive
```

**Files to Create:**
```
src/
├── lib/
│   ├── agent/
│   │   ├── index.ts            # Main agent orchestrator
│   │   ├── prompts.ts          # All prompt templates
│   │   ├── types.ts            # Agent input/output types
│   │   ├── extractor.ts        # Extract data from emails
│   │   ├── policy-evaluator.ts # Evaluate against rules
│   │   ├── decision-maker.ts   # Decide action
│   │   ├── response-generator.ts # Generate counter/clarify emails
│   │   └── output-parser.ts    # Parse LLM structured output
│   └── llm/
│       ├── client.ts           # Claude API client
│       └── config.ts           # Model configuration
├── scripts/
│   ├── agent-test.ts           # Run test scenarios
│   └── agent-interactive.ts    # Interactive testing
└── tests/
    └── unit/
        └── agent/
            ├── extractor.test.ts
            ├── policy-evaluator.test.ts
            ├── decision-maker.test.ts
            └── scenarios/       # Test scenario fixtures
                ├── simple-quote.json
                ├── counter-needed.json
                ├── escalation-trigger.json
                └── ambiguous-response.json
```

**Key Prompt Templates to Design:**

1. **Data Extraction Prompt**
   - Input: Raw email text
   - Output: Structured JSON with price, quantity, MOQ, lead time, etc.

2. **Policy Evaluation Prompt**
   - Input: Extracted data + negotiation rules + escalation triggers
   - Output: Compliance assessment + reasoning

3. **Decision Prompt**
   - Input: Policy evaluation + conversation context
   - Output: Action (accept/counter/escalate/clarify) + reasoning

4. **Counter-Offer Generation Prompt**
   - Input: Decision context + target terms
   - Output: Professional email text

**Test Scenarios to Validate:**
- Simple acceptable quote
- Quote needing counter-offer (price too high)
- Escalation trigger hit (MOQ too high)
- Ambiguous response requiring clarification
- Unexpected response (product discontinued)
- Multi-currency quote
- Quote with missing information

---

### B2: Data Layer

**Goal:** Database schema, Prisma setup, and CRUD API endpoints.

**Deliverables:**
- Prisma schema with all models
- Database migrations
- CRUD endpoints for all resources
- Input validation (Zod)
- Error handling middleware

**Files to Create:**
```
prisma/
└── schema.prisma               # Full schema

src/
├── lib/
│   ├── db.ts                   # Prisma client singleton
│   └── validations/            # Zod schemas
│       ├── merchant.ts
│       ├── supplier.ts
│       ├── order.ts
│       └── common.ts
├── app/api/
│   ├── merchant/
│   │   └── route.ts            # GET, PATCH
│   ├── suppliers/
│   │   ├── route.ts            # GET, POST
│   │   └── [id]/
│   │       ├── route.ts        # GET, PUT, DELETE
│   │       └── skus/
│   │           ├── route.ts    # GET, POST
│   │           └── [skuId]/route.ts
│   ├── orders/
│   │   ├── route.ts            # GET, POST
│   │   └── [id]/
│   │       ├── route.ts        # GET
│   │       ├── send/route.ts
│   │       ├── approve/route.ts
│   │       ├── modify/route.ts
│   │       ├── decline/route.ts
│   │       ├── take-over/route.ts
│   │       ├── resume/route.ts
│   │       └── cancel/route.ts
│   └── agent/
│       └── process/route.ts    # Direct agent testing endpoint
└── tests/
    └── integration/
        └── api/
            ├── suppliers.test.ts
            └── orders.test.ts
```

---

### B3: Agent + Memory

**Goal:** Integrate B1 agent with persistence. Agent can now:
- Load order context from database
- Store extracted quotes
- Track conversation history
- Build context for policy evaluation

**Deliverables:**
- Order processing service (connects agent to data layer)
- Conversation context builder (rolling window of messages)
- Quote extraction storage
- Audit logging for all agent decisions
- Policy evaluation storage

**Files to Create:**
```
src/
├── lib/
│   ├── agent/
│   │   └── context-builder.ts  # Build LLM context from DB
│   ├── services/
│   │   ├── order-processor.ts  # Orchestrates agent + persistence
│   │   ├── quote-extractor.ts  # Stores extracted quotes
│   │   └── audit-logger.ts     # Logs all decisions
│   └── audit/
│       └── index.ts            # Audit log utilities
└── tests/
    └── integration/
        └── services/
            └── order-processor.test.ts
```

---

### B4: Email Integration

**Goal:** Full Gmail API integration for real supplier communication.

**Deliverables:**
- Gmail OAuth flow
- Gmail API client (send, read, refresh tokens)
- Email polling logic
- Thread matching (match replies to orders)
- Attachment parsing (PDF, Excel)
- Bounce detection
- Token encryption at rest

**Files to Create:**
```
src/
├── lib/
│   ├── gmail/
│   │   ├── client.ts           # Gmail API wrapper
│   │   ├── oauth.ts            # OAuth utilities
│   │   ├── poller.ts           # Fetch new emails
│   │   ├── thread-matcher.ts   # Match emails to orders
│   │   ├── sender.ts           # Send emails
│   │   └── token-store.ts      # Encrypted token storage
│   ├── email/
│   │   ├── parser.ts           # Parse email bodies
│   │   ├── attachment-parser.ts # PDF/Excel parsing
│   │   └── templates.ts        # Email templates
│   └── currency/
│       └── converter.ts        # Exchange rate API
├── app/api/
│   └── gmail/
│       ├── status/route.ts
│       ├── connect/route.ts
│       ├── callback/route.ts
│       └── disconnect/route.ts
└── tests/
    └── integration/
        └── gmail/
            └── client.test.ts  # With mocked Gmail API
```

---

### B5: Background Workers & Notifications

**Goal:** Automated email polling, reminders, and system notifications.

**Deliverables:**
- Vercel Cron job for email polling
- Railway worker for heavy processing
- Notification service (SendGrid/Resend)
- Reminder scheduler (24h, 48h hold messages)
- Follow-up scheduler (supplier response timeout)
- Gmail disconnection detection and pause logic

**Files to Create:**
```
src/
├── workers/
│   ├── email-poller.ts         # Lightweight cron trigger
│   ├── agent-processor.ts      # Heavy processing (Railway)
│   └── reminder-scheduler.ts   # Reminder cron
├── lib/
│   └── notifications/
│       ├── service.ts          # Send system notifications
│       ├── templates.ts        # Notification templates
│       └── types.ts
├── app/api/
│   └── cron/
│       ├── poll-emails/route.ts
│       └── send-reminders/route.ts
└── tests/
    └── integration/
        └── workers/
            ├── email-poller.test.ts
            └── reminder-scheduler.test.ts
```

---

## Integration Points

### When Frontend Meets Backend

| Frontend Phase | Backend Dependency | Integration Point |
|---------------|-------------------|-------------------|
| F1 | B2 | Auth - Switch from mock session to real NextAuth |
| F2 | B2 | Orders - Switch from mock to real API calls |
| F3 | B2 | Suppliers - Switch from mock to real API calls |
| F4 | B2 + B3 | Actions - Real order state changes + agent responses |
| F5 | B4 | Gmail - Real OAuth flow |

### Removing Mocks

Each frontend hook should follow this pattern:

```typescript
// src/hooks/use-orders.ts
import { mockOrders } from '@/lib/mocks/orders';

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

export function useOrders() {
  if (USE_MOCKS) {
    return { data: mockOrders, isLoading: false, error: null };
  }

  // Real API call
  return useSWR('/api/orders', fetcher);
}
```

---

## Recommended Implementation Order

### Parallel Work Streams

**Week 1-2:**
- Frontend: F1 (Foundation)
- Backend: B1 (Agent Core)

**Week 3-4:**
- Frontend: F2 (Dashboard & Orders UI)
- Backend: B1 continued (refine agent until outputs are correct)

**Week 5-6:**
- Frontend: F3 (Supplier Management)
- Backend: B2 (Data Layer)

**Week 7-8:**
- Frontend: F4 (Approval Flows)
- Backend: B3 (Agent + Memory)

**Week 9-10:**
- Frontend: F5 (Settings & Onboarding)
- Backend: B4 (Email Integration)

**Week 11-12:**
- Integration testing
- Backend: B5 (Background Workers)
- Bug fixes and polish

---

## Success Criteria by Phase

### B1: Agent Core
- [ ] Agent extracts price, quantity, MOQ, lead time from 90%+ of test emails
- [ ] Policy evaluation correctly identifies compliant vs non-compliant offers
- [ ] Escalation triggers fire correctly
- [ ] Counter-offers are professional and on-target
- [ ] Output is always parseable JSON

### B2: Data Layer
- [ ] All CRUD operations work correctly
- [ ] Proper error handling and validation
- [ ] Auth middleware protects all routes

### B3: Agent + Memory
- [ ] Agent loads full order context from DB
- [ ] Conversation history correctly informs decisions
- [ ] All decisions logged to audit trail

### B4: Email Integration
- [ ] OAuth flow works end-to-end
- [ ] Emails send successfully
- [ ] Replies are detected and matched to orders
- [ ] Token refresh works automatically

### B5: Background Workers
- [ ] Polling runs reliably on schedule
- [ ] Reminders sent at correct intervals
- [ ] Notifications delivered

### Frontend (All Phases)
- [ ] All pages render correctly
- [ ] Forms validate and submit properly
- [ ] Error states handled gracefully
- [ ] Loading states shown appropriately
- [ ] Responsive design works on mobile

---

## Testing Strategy by Phase

### B1: Agent Core
- Unit tests for each agent component
- Test fixtures for various supplier response types
- Snapshot tests for generated emails

### B2: Data Layer
- Integration tests for all API endpoints
- Validation edge cases

### B3-B5: Integration
- Full flow tests with mocked external services
- E2E tests with Playwright

---

## Environment Configuration

```bash
# .env.local - Development

# Feature flags
NEXT_PUBLIC_USE_MOCKS=true      # Toggle mock data
AGENT_TEST_MODE=true            # Agent returns test responses

# Development settings
CLAUDE_MODEL=claude-3-haiku-20240307
EMAIL_POLL_INTERVAL_MINUTES=60  # Slow polling in dev
```

---

*End of Implementation Plan*

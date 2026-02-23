# PO Pro - Project Status

**Last Updated:** February 22, 2026

---

## Current Phase: B1.5 (Agent Core — Full Pipeline) Complete

### Overall Progress

```
[████████████████░░░░] 20% Complete
```

| Phase | Status | Notes |
|-------|--------|-------|
| Requirements Gathering | ✅ Complete | All questions answered |
| Product Specification | ✅ Complete | PRODUCT_SPEC.md finalized |
| System Architecture | ✅ Complete | docs/architecture.md created |
| Implementation Planning | ✅ Complete | PLAN_IMPLEMENTATION.md + B1.md |
| Project Setup | ✅ Complete | Next.js 16, TypeScript, Jest, Zod |
| B1: LLM Service | ✅ Complete | Claude structured output (tool_use), no fallback wired |
| B1: Data Extraction | ✅ Complete | Superseded by OrderInformation pipeline |
| B1.5: Structured OrderInformation Pipeline | ✅ Complete | Single-call pipeline with OrderInformation → rules generation → agent decision |
| B1.5: Agent Pipeline | ✅ Complete | Full pipeline with XML-parsed output (accept/counter/escalate) |
| B1.5: CLI + Live Tests | ✅ Complete | 53 unit + 13 live tests passing |
| B2: Data Layer | ⬜ Not Started | Prisma models, CRUD APIs |
| Authentication | ⬜ Not Started | Google OAuth via NextAuth |
| Gmail Integration | ⬜ Not Started | OAuth + API |
| Dashboard UI | ⬜ Not Started | React components |
| Background Workers | ⬜ Not Started | Email polling, reminders |
| Deployment | ⬜ Not Started | Vercel + Railway |

---

## Milestones

### Milestone 1: Project Foundation
**Status:** 🟡 Partial (B1 scope complete, Prisma/Playwright deferred)

- [x] Initialize Next.js project with App Router
- [x] Configure TypeScript
- [ ] Set up Prisma with Neon database (B2)
- [x] Configure ESLint
- [x] Set up Jest for unit testing (mocked + live integration configs)
- [ ] Set up Playwright for E2E testing (F2+)
- [ ] Create initial database schema (B2)
- [x] Configure environment variables (.env.local)

### Milestone 2: Authentication & Onboarding
**Status:** ⬜ Not Started

- [ ] Implement Google OAuth via NextAuth
- [ ] Create login/signup flow
- [ ] Gmail OAuth permissions flow
- [ ] Business info collection form
- [ ] Session management
- [ ] Protected route middleware

### Milestone 3: Supplier & SKU Management
**Status:** ⬜ Not Started

- [ ] Global Supplier CRUD (lookup by email, create if new)
- [ ] MerchantSupplier relationship CRUD (negotiation style, templates)
- [ ] SKU CRUD operations (per merchant-supplier relationship)
- [ ] Negotiation rules input (plain English, per relationship)
- [ ] Escalation triggers input (per relationship)
- [ ] Email template management (per relationship)
- [ ] Supplier list view (merchant's relationships)
- [ ] Supplier detail view (relationship config + supplier intelligence summary)

### Milestone 4: Order Creation & Management
**Status:** ⬜ Not Started

- [ ] Create order form
- [ ] Order list view
- [ ] Order detail view
- [ ] Order status tracking
- [ ] First email draft review flow
- [ ] Cancel order flow

### Milestone 5: Gmail Integration
**Status:** ⬜ Not Started

- [ ] Gmail API client setup
- [ ] Send email functionality
- [ ] Receive/poll emails
- [ ] Thread management
- [ ] Attachment handling (PDF, Excel)
- [ ] Token refresh handling
- [ ] Disconnection handling

### Milestone 6: Agent Core Logic
**Status:** ✅ Complete (B1 + B1.5), context window management deferred to B3

- [x] LLM Service (provider-agnostic with Claude primary + OpenAI fallback)
- [x] Structured OrderInformation schema (Zod-validated) — product, pricing, quantity, terms, negotiation rules, escalation triggers
- [x] Rules generation — LLM transforms OrderInformation into ORDER_CONTEXT + MERCHANT_RULES (cached across turns)
- [x] Single-call agent decision — systematic evaluation, action selection, and response drafting in one LLM call
- [x] XML-based output parsing — `<systematic_evaluation>`, `<decision>`, `<response>` tags extracted reliably
- [x] Three-action framework — accept (response text), counter (draft email), escalate (escalation notice)
- [x] Initial email generation — LLM drafts first outbound email from OrderInformation (structured JSON output via tool_use)
- [x] Currency normalization — alias mapping (RMB→CNY, $→USD, etc.)
- [x] Full AgentPipeline orchestrator (generateRules → buildAgentPrompt → single LLM call → XML parse → action routing)
- [x] CLI harnesses: `npm run extract` + `npm run pipeline` + `npm run chat` (interactive) + `npm run session` (automated)
- [x] 7 scenario fixtures for pipeline testing
- [x] ConversationContext — full conversation history passed to every LLM call (no truncation, accuracy over cost)

### Milestone 7: Approval Flow
**Status:** ⬜ Not Started

- [ ] Approval request creation
- [ ] Approve action
- [ ] Modify action with draft review
- [ ] Take over action
- [ ] Resume agent action
- [ ] Decline/cancel action
- [ ] Confirmation flow

### Milestone 8: Notifications & Reminders
**Status:** ⬜ Not Started

- [ ] SendGrid/Resend integration
- [ ] Offer received notification
- [ ] Reminder emails (24h cycle)
- [ ] Hold message to supplier (48h)
- [ ] Error notifications
- [ ] Supplier reply alerts

### Milestone 9: Background Workers
**Status:** ⬜ Not Started

- [ ] Vercel Cron setup
- [ ] Email polling job
- [ ] Reminder scheduler
- [ ] Follow-up scheduler
- [ ] Railway worker for heavy processing

### Milestone 10: Observability, Intelligence & Polish
**Status:** ⬜ Not Started

- [ ] Sentry error tracking
- [ ] Uptime monitoring
- [ ] Audit log viewer in dashboard
- [ ] Price history tracking
- [ ] Currency conversion
- [ ] Supplier intelligence service (behavioral learning from completed orders)
- [ ] Supplier intelligence display in UI (add supplier flow, supplier detail view)
- [ ] Performance optimization

---

## Known Issues & Blockers

- **Haiku unreliable on MOQ escalation triggers** — Haiku sometimes ignores escalation triggers when the overall deal looks good (e.g., low price but high MOQ). Better prompts and a stronger model (Sonnet/Opus) are more reliable for production.

---

## Next Steps

1. **B2: Data Layer** — Prisma schema, database migrations, CRUD API endpoints
2. **F1: Frontend Foundation** — Next.js auth, layout, navigation (can parallel with B2)
3. **B3: Agent + Memory** — Integrate agent with persistence, conversation context, audit logging

---

## Technical Debt

- Haiku escalation trigger reliability — upgrade to Sonnet/Opus for production (accuracy over cost)
- OpenAI fallback provider kept in codebase but not wired up — re-enable when needed

---

## Test Suite Summary

| Suite | Tests | Status | Command |
|-------|-------|--------|---------|
| Unit (mocked) | 53 | ✅ All passing | `npm test` |
| Live integration | 13 | ✅ All passing | `npm run test:live` |
| E2E (Playwright) | 0 | Not started | `npm run test:e2e` |

---

## Notes

- MVP is for single user (self-testing)
- No billing integration for MVP
- Gmail only (no Outlook)
- English only
- One SKU per order

---

*Update this document after completing major milestones or when project status changes significantly.*

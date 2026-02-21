# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PO Pro is an AI agent that executes purchase order conversations with suppliers on behalf of merchants. The agent sends emails via the merchant's Gmail, negotiates within defined guardrails, and requires human approval before finalizing orders.

## Tech Stack

- **Framework:** Next.js 14+ (App Router)
- **Database:** PostgreSQL via Prisma ORM (hosted on Neon)
- **Auth:** NextAuth.js with Google OAuth
- **LLM:** LLM Service — Claude API (primary), OpenAI API (fallback)
- **Email:** Gmail API for supplier comms, SendGrid/Resend for system notifications
- **Hosting:** Vercel (web) + Railway (background workers)
- **Testing:** Jest + Playwright

## Commands

```bash
# Development
npm run dev              # Start Next.js dev server
npm run db:push          # Push Prisma schema to database
npm run db:studio        # Open Prisma Studio
npm run db:generate      # Generate Prisma client

# Testing (TDD is required - write tests first)
npm test                 # Run all tests
npm test -- --watch      # Watch mode
npm test -- path/to/test # Run single test file
npm run test:e2e         # Run Playwright E2E tests
npm run test:e2e:ui      # Run Playwright with UI

# Build & Deploy
npm run build            # Production build
npm run lint             # ESLint
npm run typecheck        # TypeScript check
```

## Documentation

Detailed documentation is maintained in the `docs/` folder. Reference these files for in-depth information:

| Document | Purpose |
|----------|---------|
| [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) | Complete product requirements, data models, user flows, and all implementation decisions |
| [docs/architecture.md](./docs/architecture.md) | System design diagrams, data flow diagrams, component details, and deployment architecture |
| [docs/changelog.md](./docs/changelog.md) | Version history and release notes following Keep a Changelog format |
| [docs/project_status.md](./docs/project_status.md) | Current progress, milestone tracking, known issues, and next steps |

**Important:** Update the files in this docs folder after major milestones using `/update-docs` slash command before making git commits.

## Testing Requirements

This project uses strict TDD:
1. Write tests that define expected behavior
2. Implement features to pass tests
3. Run full suite after each feature

All external dependencies (Gmail API, LLM Service providers, email service) must be mocked for deterministic tests.

## Design Philosophy

**Accuracy over cost.** Always choose the approach that produces the most accurate, reliable results — regardless of API costs, token usage, or number of LLM calls. This applies to:
- Extraction: re-process full conversation context every turn, never summarize or truncate for cost savings
- Policy evaluation: include all available context, never skip data to save tokens
- Prompts: be thorough and explicit, never shorten prompts to reduce token counts
- Model selection: use the most capable model available, never downgrade for cost

Token optimization and cost reduction are explicitly **not priorities** during development. Accuracy is the product — if the agent makes a wrong decision, the cost of that mistake far exceeds any token savings.

## Environment

Copy `.env.example` to `.env.local` and fill in credentials.

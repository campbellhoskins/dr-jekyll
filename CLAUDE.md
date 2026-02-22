# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PO Pro is an AI agent that executes purchase order conversations with suppliers on behalf of merchants. The agent sends emails via the merchant's Gmail, negotiates within defined guardrails, and requires human approval before finalizing orders.

## Tech Stack

See [docs/architecture.md](./docs/architecture.md) for full tech stack, diagrams, and deployment details. Key technologies: Next.js (App Router), PostgreSQL/Prisma/Neon, Claude API (structured output via tool_use), Gmail API, Vercel + Railway, Jest.

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
| [docs/PRODUCT_SPEC.md](./docs/PRODUCT_SPEC.md) | What and why — product requirements, data models, user flows, business rules, scope |
| [docs/architecture.md](./docs/architecture.md) | How — tech stack, system design diagrams, components, deployment, monitoring, security |
| [docs/PLAN_IMPLEMENTATION.md](./docs/PLAN_IMPLEMENTATION.md) | When — implementation phases, roadmap, milestones (NOT types/interfaces — code owns those) |
| [docs/project_status.md](./docs/project_status.md) | Current state — progress, blockers, technical debt, test counts |
| [docs/changelog.md](./docs/changelog.md) | What changed — version history following Keep a Changelog format |

**Important:** Update the files in this docs folder after major milestones using `/update-docs` slash command before making git commits.

## Testing Requirements

This project uses strict TDD:
1. Write tests FIRST that define the expected behavior — these are the contract
2. Implement features to make those tests pass
3. Run full suite after each feature

**CRITICAL: Tests must NEVER be loosened to make them pass.** If a test fails, the implementation is wrong — not the test. Fix the code, fix the prompts, upgrade the model, add guardrails — but do not weaken assertions. A test that accepts multiple possible outcomes when only one is correct is a broken test. The only valid reasons to change a test are:
- The requirement itself changed (user explicitly asked for different behavior)
- The test was wrong from the start (testing the wrong thing)

This applies equally to live integration tests. If Haiku can't reliably produce the correct action, the fix is better prompts or a better model — not a looser assertion.

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

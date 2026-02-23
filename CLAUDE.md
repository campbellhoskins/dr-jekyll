# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PO Pro is an AI agent that executes purchase order conversations with suppliers on behalf of merchants. The agent sends emails via the merchant's Gmail, negotiates according to the merchant's plain-English instructions, and requires human approval before finalizing orders.

## Tech Stack

See [docs/architecture.md](./docs/architecture.md) for full tech stack, diagrams, and deployment details. Key technologies: Next.js (App Router), PostgreSQL/Prisma/Neon, Claude API (structured output via tool_use), Gmail API, Vercel + Railway, Jest.

## Commands

```bash
# Development
npm run dev              # Start Next.js dev server

# Testing (TDD is required - write tests first)
npm test                 # Run all unit tests
npm run test:watch       # Watch mode
npm test -- path/to/test # Run single test file
npm run test:live        # Run live integration tests (requires ANTHROPIC_API_KEY)

# CLI Tools (agent testing)
npm run extract          # Extract quote data from supplier email
npm run pipeline         # Run full pipeline on scenario fixtures
npm run chat             # Interactive multi-turn chat session
npm run session          # Automated session runner with expectations

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

**CRITICAL: Tests must NEVER be loosened to make them pass.** If a test fails, the implementation is wrong — not the test. Fix the prompts, provide better context, upgrade the model — but do not weaken assertions. A test that accepts multiple possible outcomes when only one is correct is a broken test. The only valid reasons to change a test are:
- The requirement itself changed (user explicitly asked for different behavior)
- The test was wrong from the start (testing the wrong thing)

This applies equally to live integration tests. If Haiku can't reliably produce the correct action, the fix is better prompts or a better model — not a looser assertion.

All external dependencies (Gmail API, LLM Service providers, email service) must be mocked for deterministic tests.

## Design Philosophy

### LLM-First Decision Making

**The LLM makes all decisions.** This is the most important architectural principle in this project. Every evaluation, judgment, and action selection must be made by the LLM — never by deterministic code that second-guesses, overrides, or replaces the model's reasoning.

**Why:** LLMs are rapidly improving. A system that trusts the model automatically gets better as models improve — without code changes, without new regex patterns, without hardcoded thresholds. A system full of deterministic guardrails locks in today's model weaknesses as permanent architecture and creates a ceiling that prevents the agent from benefiting from better models.

**What this means in practice:**
- **No deterministic overrides of LLM decisions.** If the LLM says "accept", the system accepts. If it says "escalate", the system escalates. Code never second-guesses or reverses the model's judgment.
- **No regex-based evaluation.** Don't parse merchant rules with regex to check thresholds. The LLM reads the rules, understands the context, and makes the call.
- **No hardcoded keyword lists.** Don't scan for "discontinued" or "out of stock" in code. The LLM reads the email and understands what it means in context (e.g., a different product being discontinued is not an escalation).
- **No confidence thresholds in code.** Don't check `if confidence < 0.3 then escalate`. The LLM should decide whether it has enough information to act, and express that decision through its chosen action.
- **Prompts are the control mechanism.** All business logic, safety rules, and behavioral guidance live in prompts — not in if/else branches. When behavior needs to change, update the prompt, not the code.
- **Structured output is the contract.** The LLM returns structured decisions (action, reasoning, extracted data) via tool_use schemas. The system routes on the action field — it does not re-evaluate whether the action is correct.

**The only code-level concerns are:**
- Routing: take the LLM's decision and execute it (send email, propose approval, escalate)
- Data plumbing: pass the right context to the LLM, store the results
- Output parsing: validate the LLM's structured output conforms to the schema
- Orchestration: call the right LLM prompts in the right order

**When the LLM gets something wrong, the fix is:**
1. Better prompts (clearer instructions, better examples)
2. Better context (more relevant information passed to the model)
3. A better model (upgrade from Haiku to Sonnet to Opus)
4. Never: adding deterministic code to override the model

### Accuracy Over Cost

Always choose the approach that produces the most accurate, reliable results — regardless of API costs, token usage, or number of LLM calls. This applies to:
- Extraction: re-process full conversation context every turn, never summarize or truncate for cost savings
- Policy evaluation: include all available context, never skip data to save tokens
- Prompts: be thorough and explicit, never shorten prompts to reduce token counts
- Model selection: use the most capable model available, never downgrade for cost

Token optimization and cost reduction are explicitly **not priorities** during development. Accuracy is the product — if the agent makes a wrong decision, the cost of that mistake far exceeds any token savings.

## Git Workflow

**Never commit or push automatically.** Only create commits and push when explicitly asked. Do not bundle commits with implementation work — wait for the user to say "commit", "push", or similar.

## Environment

Copy `.env.example` to `.env.local` and fill in credentials.

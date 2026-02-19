# PO Pro - Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

*Nothing unreleased — all changes shipped in 0.1.0.*

---

## [0.1.0] - 2026-02-18

### Added — B1: Agent Core (Data Extraction)

**LLM Service** (`src/lib/llm/`)
- Provider-agnostic `LLMService` class with configurable retry count and delay
- `ClaudeProvider` — Anthropic SDK adapter
- `OpenAIProvider` — OpenAI SDK adapter
- Automatic fallback: primary → fallback provider after retries exhausted
- Every attempt logged with provider, model, latency, success/failure

**Data Extraction** (`src/lib/agent/`)
- `Extractor` — orchestrates prompt → LLM call → parse → USD conversion
- `output-parser` — resilient JSON parser handling markdown blocks, trailing text, numeric strings, currency aliases
- `prompts` — extraction prompt template requesting all spec Section 3.11 fields
- `ExtractedQuoteData` type matching PRODUCT_SPEC Section 3.11 field names exactly (quotedPrice, quotedPriceCurrency, quotedPriceUsd, availableQuantity, moq, leadTimeDays, paymentTerms, validityPeriod, rawExtractionJson)
- Hardcoded USD exchange rates for CNY, EUR, GBP, JPY, KRW, INR, THB, VND, TWD (real API in B4)

**CLI Test Harness** (`src/cli/extract.ts`)
- `npm run extract -- --file <path>` — extract from file
- `npm run extract -- --all-fixtures` — run all 9 fixtures
- `--verbose` flag for full trace (prompt, raw LLM output, parsing steps)
- `--provider` and `--model` flags for provider/model override

**Test Infrastructure**
- Jest configured for mocked unit tests (`npm test`) and live integration tests (`npm run test:live`)
- 39 mocked unit tests across 6 test files (LLM service: 8, Claude provider: 4, OpenAI provider: 4, output parser: 11, extractor: 8, prompts: 4)
- 9 live integration tests against real Claude API
- 9 supplier email fixture files: simple quote, multi-currency, ambiguous response, partial info, counter-offer, rejection, tiered pricing, conversational, multi-item

**Project Foundation**
- Next.js 16 with TypeScript and App Router
- Zod v4 for runtime validation
- `B1.md` — detailed implementation plan with spec alignment reference table

### Changed (from planning phase)
- **LLM integration refactored to provider-agnostic LLM Service** — All LLM calls now go through a service abstraction layer. The rest of the application never calls Claude or OpenAI directly. The service handles retries (2-3 per provider) and automatic fallback from primary provider (Claude) to fallback provider (OpenAI). Escalation to merchant only occurs after all providers are exhausted. Every attempt is fully logged with provider, model, latency, and outcome.
- **Supplier model refactored to global entity** — Suppliers are no longer scoped per merchant. They are independent entities identified by email address, shared across all merchants. The system accumulates behavioral intelligence (response patterns, negotiation tendencies, communication style) about each supplier over time as more merchants interact with them.
- **New MerchantSupplier join model** — Per-relationship configuration (negotiation style, email templates, negotiation rules, escalation triggers, SKUs) now lives on a MerchantSupplier record rather than directly on the Supplier.
- **Negotiation style is per relationship** — Each merchant chooses their own negotiation style (ask for quote vs. state price upfront) for each supplier independently.
- **Supplier Intelligence system added** — New Section 7.8 in product spec and Supplier Intelligence Service in architecture. The agent learns supplier behavioral patterns from interactions across all merchants while maintaining strict privacy boundaries (no cross-merchant pricing or volume data shared).
- **Data model renumbered** — Sections 3.3-3.16 updated to accommodate new MerchantSupplier model (16 models total, up from 15).
- SKU, NegotiationRules, and Order models now reference MerchantSupplier instead of Supplier directly.
- PriceHistory retains a global supplierId FK for cross-merchant intelligence alongside merchantSupplierId.
- **B1 scope narrowed to extraction only** — Policy evaluation, decision logic, and counter-offer generation deferred to B1.5 to validate extraction quality first.

---

## [0.0.1] - 2026-02-09

### Added
- Project initialized
- `brainstorm.md` - Initial product concept and requirements
- `PRODUCT_SPEC.md` - Comprehensive product specification including:
  - Technical architecture (Next.js, PostgreSQL, Vercel, Railway)
  - Data models (16 database schemas)
  - User flows (onboarding, orders, approval, takeover)
  - Email integration specifications (Gmail API)
  - Agent behavior rules and escalation triggers
  - Testing strategy (TDD with full coverage)
  - Monitoring and observability requirements
- `.env.example` - Environment variable template
- `docs/architecture.md` - System design and data flow diagrams
- `docs/changelog.md` - Version history (this file)
- `docs/project_status.md` - Current progress tracking

### Technical Decisions
- **Email Provider:** Gmail API only (MVP)
- **Authentication:** Google OAuth only
- **Database:** Neon (serverless PostgreSQL)
- **LLM:** Claude API with configurable model
- **Background Jobs:** Vercel Cron + Railway workers
- **Testing:** TDD approach with mocked external services

---

## Version History Format

Each release should document:

### Added
New features or capabilities

### Changed
Changes to existing functionality

### Deprecated
Features that will be removed in future versions

### Removed
Features that have been removed

### Fixed
Bug fixes

### Security
Security-related changes or fixes

---

*This changelog is updated with each significant release or milestone.*

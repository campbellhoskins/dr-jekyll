# PO Pro - Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed
- **LLM integration refactored to provider-agnostic LLM Service** — All LLM calls now go through a service abstraction layer. The rest of the application never calls Claude or OpenAI directly. The service handles retries (2-3 per provider) and automatic fallback from primary provider (Claude) to fallback provider (OpenAI). Escalation to merchant only occurs after all providers are exhausted. Every attempt is fully logged with provider, model, latency, and outcome.
- **Supplier model refactored to global entity** — Suppliers are no longer scoped per merchant. They are independent entities identified by email address, shared across all merchants. The system accumulates behavioral intelligence (response patterns, negotiation tendencies, communication style) about each supplier over time as more merchants interact with them.
- **New MerchantSupplier join model** — Per-relationship configuration (negotiation style, email templates, negotiation rules, escalation triggers, SKUs) now lives on a MerchantSupplier record rather than directly on the Supplier.
- **Negotiation style is per relationship** — Each merchant chooses their own negotiation style (ask for quote vs. state price upfront) for each supplier independently.
- **Supplier Intelligence system added** — New Section 7.8 in product spec and Supplier Intelligence Service in architecture. The agent learns supplier behavioral patterns from interactions across all merchants while maintaining strict privacy boundaries (no cross-merchant pricing or volume data shared).
- **Data model renumbered** — Sections 3.3-3.16 updated to accommodate new MerchantSupplier model (16 models total, up from 15).
- SKU, NegotiationRules, and Order models now reference MerchantSupplier instead of Supplier directly.
- PriceHistory retains a global supplierId FK for cross-merchant intelligence alongside merchantSupplierId.

### Planning Phase
- Initial product requirements defined
- System architecture designed
- Data models specified
- User flows documented

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

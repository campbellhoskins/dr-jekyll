---
name: update-docs
description: Deep-analyze the entire codebase and update all project documentation to reflect the current implementation. Use when the user says "/update-docs", "update the docs", "sync documentation", or after completing a major milestone. Launches parallel agents to audit each doc against the actual code and fix gaps, stale info, and missing components.
---

# Update Docs

Perform a deep audit of the codebase and update project documentation to accurately reflect the current implementation.

## Target Docs and Update Strategy

| Doc | Strategy |
|-----|----------|
| `docs/architecture.md` | **Heavy** — verify every component, service, data flow, diagram against actual code. Add missing modules, fix stale descriptions, update diagrams. |
| `docs/project_status.md` | **Heavy** — scan implemented code to mark phases complete/incomplete, update test counts, refresh milestone checklists, update progress percentage. |
| `docs/PLAN_IMPLEMENTATION.md` | **Moderate** — verify which phases are done vs. planned, update status markers. Keep plan structure intact. |
| `docs/PRODUCT_SPEC.md` | **Light** — only fix factual inaccuracies (e.g., renamed models, changed data structures). Do not add implementation details. The spec describes intended behavior. |
| `CLAUDE.md` | **Minimal** — only update if tech stack, commands, or file references are factually wrong. Never bloat this file. |
| `docs/changelog.md` | **Skip** — append-only, never auto-updated. |

## Procedure

### Step 1: Codebase Discovery

Launch parallel Task agents (subagent_type: "Explore") to build a complete picture of the current implementation. Each agent should return a structured summary. Launch all of these in a single message for maximum parallelism:

**Agent 1 — Source Structure & Modules**
- Glob all `src/**/*.ts` files
- For each module directory (e.g., `src/lib/agent/`, `src/lib/llm/`, `src/cli/`), read the key files
- Return: list of all modules, their public exports, class/function names, and a one-line purpose for each

**Agent 2 — Types, Models & Data Structures**
- Read all type definition files (`types.ts`, Prisma schema if exists, Zod schemas)
- Return: all data models, their fields, enums, and key interfaces

**Agent 3 — Test Coverage & Project Health**
- Glob all `tests/**/*.ts` files
- Count test files by category (unit, integration, e2e)
- Read test files to extract test names and count assertions
- Check `package.json` for scripts, dependencies, and project config
- Return: test counts by category, list of what's tested, dependency list

**Agent 4 — Current Docs Snapshot**
- Read all target docs (architecture.md, project_status.md, PLAN_IMPLEMENTATION.md, PRODUCT_SPEC.md, CLAUDE.md)
- Return: structured summary of what each doc currently claims — components listed, phases marked complete, tech stack described, etc.

### Step 2: Gap Analysis

After all agents return, compare agent results to identify gaps:

For **architecture.md**:
- Modules/services in code but missing from architecture doc
- Components described in doc but not present in code (removed or renamed)
- Data flow descriptions that don't match actual function signatures or call patterns
- Diagrams showing components that don't exist or missing components that do

For **project_status.md**:
- Phases marked incomplete but code exists and tests pass
- Phases marked complete but code is missing or tests fail
- Test counts that don't match actual test file counts
- Milestone checklist items that need updating

For **PLAN_IMPLEMENTATION.md**:
- Implementation phases that are complete but not marked as such
- Phase descriptions that don't match what was actually built

For **PRODUCT_SPEC.md**:
- Model names or field names that were renamed in implementation
- Data structures described that differ from actual types.ts/schemas

For **CLAUDE.md**:
- Tech stack entries that are wrong
- Commands that don't exist in package.json
- File references to docs that moved or were renamed

### Step 3: Apply Updates

Update each doc file using Edit tool. Follow these rules:

- **Preserve voice and formatting** — match the existing style of each doc
- **Preserve ASCII diagrams** — update them in-place, don't remove or simplify
- **Be surgical** — only change what's actually wrong or missing. Don't rewrite sections that are accurate
- **Architecture.md diagrams** — when adding new components to ASCII diagrams, maintain alignment and box-drawing character consistency
- **project_status.md** — update the progress bar percentage, phase table checkmarks, milestone checklists, and test counts based on actual data
- **CLAUDE.md** — absolute minimum changes only. If a doc file moved, update the reference. If a command changed, update it. Never add new sections

### Step 4: Verify

After all edits, read each modified doc once more to confirm:
- No broken markdown formatting
- No contradictions between docs
- ASCII diagrams render correctly
- Changed sections are internally consistent

Report a summary of all changes made to the user.

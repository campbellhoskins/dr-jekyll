Product Requirements Document
Product: Autonomous Purchase Communication Agent (working name)
Version: MVP / V1
Date: Feb 2026

1. Summary
Build an AI agent that executes routine purchase order conversations with existing suppliers on behalf of Shopify merchants, operating within explicit guardrails and escalating exceptions to humans.

The MVP replaces email/WhatsApp back-and-forth, not purchasing strategy.

Success = merchants save time and feel confident nothing bad will happen.

2. Problem
Merchants repeatedly reorder inventory from known suppliers through slow, manual communication.

Pain today:

repetitive emails

waiting for quotes

interpreting messy replies

remembering constraints

fear of mistakes

high cognitive load

This consumes hours per week and delays replenishment.

Tools for forecasting exist; tools for executing the conversation do not.

3. Target User (VERY specific)
Initial ICP:

Shopify merchant

20–500 SKUs

reorders same products regularly

works with 1–5 primary overseas suppliers

communicates via email

founder or ops manager handles purchasing

Not enterprises.
Not marketplaces.
Not brands with procurement teams.

4. Jobs To Be Done
When inventory is low, the merchant wants to:

✔ get updated price
✔ confirm availability
✔ know lead time
✔ negotiate within known bounds
✔ produce a confirmed order

without spending their day in inbox hell.

5. Value Proposition
“Give us your purchasing rules.
We run the supplier conversation.
You approve the result.”

6. Product Scope (MVP)
In Scope
Email-based supplier communication

Single merchant

Known supplier

Known SKU

Guardrail-based negotiation

Human approval before commitment

Clear audit trail

Out of Scope
❌ demand forecasting
❌ supplier discovery
❌ freight booking
❌ payments
❌ cross-merchant benchmarking
❌ autonomous approval
❌ WhatsApp/WeChat integrations
❌ multi-location allocation

If it smells like platform, it’s later.

7. User Flow
Step 1 – Setup
Merchant provides:

supplier contact

SKUs

last known price

MOQ

negotiation rules

escalation triggers

Example:

ask for discount above 500 units
never exceed $4.20/unit
escalate if lead time > 30 days

Step 2 – Initiate Order
Merchant types:

“Order 300–600 units of SKU A.”

Step 3 – Agent Executes
Agent:

emails supplier

requests quote

parses reply

evaluates against policy

optionally counters

reaches tentative agreement

Step 4 – Summary to Merchant
Merchant receives:

proposed quantity

price

total

lead time

conversation transcript

why this satisfies rules

Buttons:
✅ Approve
✏ Modify
🚩 Take over

Step 5 – Confirmation Sent
Agent sends confirmation email.

8. Functional Requirements
Supplier Communication
send/receive email

maintain thread context

handle attachments (basic parsing)

extract price / MOQ / lead time

Reasoning
compare supplier response vs constraints

determine compliance

generate counteroffers

Transparency
Every action must be explainable:

“Supplier asked $4.50. Your max is $4.20. I countered with $4.10.”

Escalation
Immediate handoff if:

ambiguity

policy conflict

supplier proposes new terms

model confidence low

Human Override
Merchant can jump into thread anytime.

9. Non-Functional Requirements (CRITICAL)
Reliability > intelligence
Boring, predictable behavior wins.

No hallucinated commitments
If uncertain → escalate.

Full audit history
Merchants must trust you after mistakes.

Response latency
Within minutes, not hours.

10. UX Principles
feel like an assistant, not a black box

show the math

show the messages

make override easy

never surprise the user

Trust accumulation is the product.

11. Success Metrics (first 6 months)
Usage
% of reorders run through agent

repeat usage per merchant per month

Trust
approval rate of recommendations

reduction in manual typing

Value
time saved per PO

faster order confirmations

Retention
do they keep using after 60 days?

12. Failure Modes to Watch
agent agrees incorrectly

supplier confusion

merchants bypass system

too many escalations → not useful

too few escalations → risky

13. Pricing Hypothesis (MVP)
Keep simple.

Examples:

$100–300/month depending on volume
or

per active supplier

Goal = easy yes.

14. Technical Architecture (simple)
Shopify data ingestion

email integration

LLM reasoning layer

policy engine

action logger

approval UI

No exotic ML infra required yet.
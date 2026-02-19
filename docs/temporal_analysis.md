# Temporal vs Custom Implementation: Deep Dive Analysis for PO Pro

## Context

PO Pro's AI agent needs to orchestrate long-running, multi-step purchase order conversations that span days or weeks. The current architecture splits this across Vercel Cron (lightweight polling/reminders) and Railway workers (heavy LLM processing), with order state tracked in the database. This analysis evaluates whether Temporal — a durable execution platform — would be a better foundation than building custom.

---

## What Is Temporal?

Temporal.io is an open-source **durable execution platform** (MIT license). Originally derived from Uber's Cadence workflow engine, it lets you write long-running, multi-step processes as ordinary sequential functions while the platform handles state persistence, failure recovery, retries, and timeouts transparently.

**Core concepts:**
- **Workflows** — Plain TypeScript functions that orchestrate steps. Fully durable: if the process crashes, Temporal reconstructs state from event history and resumes exactly where it left off.
- **Activities** — Functions that perform actual side effects (API calls, email sends, database writes). Can be retried automatically on failure.
- **Workers** — Long-running processes (deployed on Railway) that poll the Temporal Server for tasks and execute workflows/activities. Workers are stateless; all state lives in the Temporal Server.
- **Signals** — Async messages sent to a running workflow (e.g., "merchant approved"). Persisted by the server, never lost even if the worker is down.
- **Queries** — Synchronous read-only inspection of workflow state without affecting it.
- **Durable Timers** — `await sleep('24 hours')` persists on the server, not in worker memory. Fires at the correct time even after crashes.

---

## What Temporal Would Replace in Our Spec

### 1. The Entire Vercel Cron + Railway Worker Split

**Current spec:** Two-tier architecture where Vercel Cron triggers lightweight checks (email polling every 5-15 min, reminder scheduling hourly) and queues heavy work to Railway workers for LLM reasoning and email parsing.

**With Temporal:** This split goes away. A single Temporal worker process on Railway handles everything — both the scheduling/timer logic and the heavy processing. Temporal's durable timers replace cron entirely. There's no need for a separate polling scheduler because the workflow itself can `await sleep('10 minutes')` in a loop, and that sleep is persisted by the Temporal server (not held in worker memory).

**What's eliminated:**
- Vercel Cron configuration and route handlers (`/api/cron/poll-emails`, `/api/cron/send-reminders`)
- Custom job queuing between Vercel and Railway
- The entire "lightweight trigger -> queue -> heavy worker" handoff pattern

### 2. Database-Backed Order State Machine

**Current spec:** Order status lives in the database as an enum column (`draft`, `awaiting_quote`, `negotiating`, `pending_approval`, `approved`, `confirmed`, `cancelled`, `escalated`, `paused`). State transitions are managed by application code that updates the database and triggers side effects.

**With Temporal:** Each order becomes a single long-running workflow. The state machine is expressed as sequential code — `if/else` branches and `await` calls — rather than database status columns and transition handlers. The workflow function *is* the state machine. Temporal persists the workflow's position automatically.

```typescript
// Instead of: UPDATE orders SET status = 'awaiting_quote' WHERE id = ?
// You write:
await sendInitialEmail(order);
// The workflow is now implicitly in "awaiting_quote" state
const supplierReply = await waitForSupplierReply();
```

**What's eliminated:**
- Hand-coded state transition logic
- "What if the server crashes between updating status and sending the email?" edge cases
- Database polling to check "which orders are in state X and need action?"

### 3. Timer-Based Reminder Logic

**Current spec:** Reminder Scheduler runs hourly via Vercel Cron, scans the database for orders needing action:
- Approval reminders every 24h
- Supplier hold messages after 48h
- Supplier response follow-ups at 48h and 96h
- Order confirmation follow-ups at 48h and 96h

**With Temporal:** Each timer is a `sleep()` or `Promise.race()` inside the workflow. No database scanning needed.

```typescript
// Wait for merchant approval OR 24-hour reminder timer
const approved = await Promise.race([
  condition(() => merchantDecision !== undefined),
  sleep('24 hours').then(() => { sendReminder(); return null; })
]);
```

**What's eliminated:**
- Hourly cron job scanning all orders for timer conditions
- Timestamp math ("has it been 24h since last reminder?")
- Edge cases around "what if the cron missed a cycle?"
- Dedicated reminder scheduler service
- All timing-related env vars (`APPROVAL_REMINDER_HOURS`, `SUPPLIER_HOLD_MESSAGE_HOURS`, etc.) — these become workflow constants

### 4. Human-in-the-Loop Approval Polling

**Current spec:** Order sits in `pending_approval` in the database. Dashboard queries for pending orders. When merchant clicks "Approve", an API route updates the database and triggers the next step.

**With Temporal:** The workflow uses signals. It literally `await`s a signal from the merchant. When the merchant clicks "Approve" on the dashboard, the API route sends a Temporal signal instead of updating a database row. The workflow wakes up and continues.

```typescript
// API route (Vercel):
await temporalClient.workflow.getHandle(`order-${orderId}`)
  .signal(approveSignal, { approved: true });

// Workflow (Railway worker):
await condition(() => approval !== undefined); // waits indefinitely, durably
```

**What's eliminated:**
- Database polling for approval status
- "What if the merchant approves while the worker is down?" — signals are persisted by Temporal, never lost

### 5. Retry and Fallback Logic in the LLM Service

**Current spec:** LLM Service retries primary provider 2-3 times, falls back to secondary, escalates to merchant if both fail. This is custom code.

**With Temporal:** Activity retry policies handle this declaratively:

```typescript
const { callLLM } = proxyActivities({
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['AuthenticationError']
  }
});
```

The fallback-to-secondary-provider pattern would still be custom code inside the activity, but the retry mechanics are handled by Temporal.

**What's partially eliminated:** Retry loop boilerplate. The provider fallback logic is still yours to write, but it lives cleanly inside a single activity function.

---

## What New Functionality Temporal Would Add

### 1. Crash Recovery Without Data Loss

**Not in current spec.** If the Railway worker crashes mid-LLM-call or mid-email-send, the current architecture has no built-in recovery. You'd need to build idempotency checks and restart logic.

**With Temporal:** The workflow replays from its event history. If the worker crashes after sending an email but before recording the result, Temporal detects the incomplete activity and can re-execute it (with idempotency keys you provide). Nothing is lost.

### 2. Full Workflow Visibility and Debugging

**Not in current spec** (beyond the audit log). Temporal provides a built-in Web UI that shows every running workflow, its current state, full event history timeline, and pending timers. You can inspect exactly where an order workflow is, what it's waiting for, and every activity it has executed.

This is significantly richer than the audit log viewer planned in the spec. It gives you operational visibility for free.

### 3. Workflow Queries (Real-Time State Inspection)

**Not in current spec.** With Temporal, you can query a running workflow for its current state without touching the database:

```typescript
const status = await client.workflow.getHandle(`order-${orderId}`).query(getStatusQuery);
```

The dashboard could query Temporal directly for order state instead of querying PostgreSQL. This means the workflow is the single source of truth — no risk of database state drifting from actual workflow state.

### 4. Takeover/Resume as a First-Class Primitive

**Current spec:** Merchant takeover sets `takenOverByMerchant = true` in the database. Agent monitors silently. On resume, agent ingests all messages from takeover period.

**With Temporal:** This becomes a signal pattern. The workflow receives a "take over" signal, enters a monitoring-only loop, and waits for a "resume" signal. All state (including messages received during takeover) is inside the workflow. No database flags needed.

### 5. Gmail Disconnection Handling as Workflow Pause

**Current spec:** All active orders -> `paused` status. Resume when reconnected. The mechanism for detecting disconnection and resuming is undefined.

**With Temporal:** Each order workflow can listen for a "gmail disconnected" signal, enter a paused state (just a `while` loop waiting for "reconnected" signal), and resume exactly where it left off. The Temporal server holds the workflow state during the pause — no database status updates needed.

### 6. Deterministic Testing with Time Skipping

**Current spec:** Mocked external dependencies, but no way to test timer logic without waiting real time.

**With Temporal:** The test framework includes time-skipping. You can fast-forward 24 hours in a test to verify that a reminder fires, or skip 48 hours to test escalation logic — all in milliseconds.

---

## Advantages of Temporal vs Custom Implementation

| Dimension | Custom (Vercel Cron + Railway + DB) | Temporal |
|-----------|-------------------------------------|----------|
| **Order workflow as code** | Spread across cron handlers, API routes, database transitions, worker processors | Single sequential function per order |
| **Crash recovery** | Must build idempotency, restart logic, and "where did we leave off?" checks | Automatic — replay from event history |
| **Timer reliability** | Cron scans database hourly; if cron misses a cycle, timers drift | Durable timers fire at exact time, survive crashes |
| **Human-in-the-loop** | Database polling, status flags, "is the merchant's decision recorded yet?" | `await condition()` — the workflow just waits |
| **Debugging** | Custom audit log viewer, database queries to reconstruct state | Built-in Web UI with full event timeline |
| **Testing timers** | Either wait real time or mock `Date.now()` everywhere | Time-skipping test framework |
| **Scaling** | Scale cron + workers + database independently; coordinate between them | Scale workers only — Temporal server handles routing |
| **State consistency** | Database can drift from actual workflow state if updates fail mid-transition | Workflow IS the state — single source of truth |
| **Complexity of adding new timers** | Add cron logic, database queries, timestamp columns | Add `sleep()` or `Promise.race()` in the workflow |

---

## Disadvantages of Temporal vs Custom Implementation

| Dimension | Impact | Severity |
|-----------|--------|----------|
| **Learning curve** | Determinism constraints, replay mental model, workflow versioning. Developers must learn that workflow code cannot use `Date.now()`, `Math.random()`, or direct I/O. All side effects must be in activities. | **High for first 2-3 weeks**, then manageable |
| **Infrastructure** | Temporal Server is a cluster of services (Frontend, History, Matching, Worker) backed by a database. Self-hosting requires PostgreSQL + Elasticsearch + 4 services. Temporal Cloud avoids this but costs $100-500/mo. | **Medium** — Temporal Cloud with startup credits ($6K) mitigates this significantly |
| **Workflow versioning** | When you change workflow code, already-running workflows must still replay correctly. Requires patching mechanisms. An order workflow running for 2 weeks when you deploy a code change needs careful handling. | **Medium** — real concern for long-running workflows like PO orders |
| **Vendor lock-in** | Workflow logic is tied to Temporal's programming model. Migrating away means rewriting all orchestration code. However, Temporal is open-source (MIT). | **Low-Medium** — open source mitigates, but the abstraction is Temporal-specific |
| **Over-engineering risk** | For a single-merchant MVP, the current spec's async needs (polling, reminders, retries) are achievable with simpler tools. Temporal's full power is most justified at scale. | **Medium** — depends on whether you value foundation-for-scale vs. ship-fast |
| **Debugging complexity** | Replay-based execution can be confusing. "Why did my workflow execute this line 3 times?" requires understanding event history replay. | **Medium** — improves with experience |
| **V8 sandbox constraints** | Workflow code runs in a sandboxed V8 isolate. Some npm packages may not work inside workflows. All I/O must be in activities. | **Low** — well-documented, and the separation is clean once understood |

---

## Deployment Architecture with Temporal

```
Vercel (Next.js)                    Temporal Cloud              Railway
+--------------+                    +--------------+            +--------------+
|  Dashboard   |                    |              |            |   Temporal   |
|  API Routes  |--- gRPC client -->|   Managed    |<-- polls --|   Workers    |
|  (start      |    (start wf,     |   Server     |            |              |
|  workflows,  |     signals,      |              |            |  - Order wf  |
|  send        |     queries)      |  Handles:    |            |  - Email wf  |
|  signals,    |                    |  - State     |            |  - LLM calls |
|  queries)    |                    |  - Timers    |            |  - Gmail API |
+--------------+                    |  - History   |            +--------------+
                                    |  - Routing   |
                                    +--------------+
                                           |
                                    +--------------+
                                    |   Web UI     |
                                    |  (included)  |
                                    +--------------+
```

**What changes:**
- Vercel: No more cron jobs. Just API routes that act as Temporal client (start workflows, send signals, run queries)
- Railway: Runs Temporal worker processes instead of custom worker + processor
- Neon (PostgreSQL): Still used for application data (merchants, suppliers, SKUs), but order *workflow state* lives in Temporal
- New dependency: Temporal Cloud ($100/mo base, $6K startup credit available) OR self-hosted Temporal on Railway (free, one-click template, but more operational overhead)

**What stays the same:**
- Next.js dashboard on Vercel
- PostgreSQL on Neon for application data
- Gmail API integration (now called from Temporal activities)
- LLM Service (now called from Temporal activities)
- SendGrid/Resend for notifications (now called from Temporal activities)

---

## Hosting Options & Cost

### Temporal Cloud (Managed — Recommended for MVP)

| Tier | Base Cost | Included |
|------|-----------|----------|
| Essentials | $100/month | 1M Actions, 1 GB Active Storage |
| Business | $500/month | 2.5M Actions, 2.5 GB Active Storage |

- **Free credits:** $1,000 for new users. $6,000 for startups under $30M funding.
- You only deploy workers — Temporal handles the server, database, scaling, upgrades.

### Self-Hosted on Railway

- Free (open-source MIT license)
- One-click Railway template deploys full stack: PostgreSQL, Elasticsearch, all Temporal services, Web UI
- Requires ongoing maintenance: database backups, schema migrations, cluster upgrades

---

## How an Order Would Look as a Temporal Workflow

```typescript
export async function purchaseOrderWorkflow(order: PurchaseOrder): Promise<OrderResult> {
  let merchantDecision: ApprovalDecision | undefined;
  let takenOver = false;

  // Register signal handlers
  wf.setHandler(approveSignal, (d) => { merchantDecision = d; });
  wf.setHandler(takeOverSignal, () => { takenOver = true; });
  wf.setHandler(resumeSignal, () => { takenOver = false; });

  // 1. Send initial email (first order to supplier = draft review)
  if (await isFirstOrderToSupplier(order)) {
    const draft = await generateDraftEmail(order);
    await wf.condition(() => merchantDecision?.type === 'draft_approved');
    await saveAsTemplate(order.supplierId, draft);
  }
  await sendInitialEmail(order);

  // 2. Wait for supplier response (with follow-up timers)
  let supplierReply = await raceSupplierResponse(order.id, {
    followUpAfter: '48 hours',
    alertMerchantAfter: '96 hours',
  });

  // 3. Negotiate
  while (needsNegotiation(supplierReply, order.rules)) {
    if (shouldEscalate(supplierReply, order.escalationTriggers)) {
      await notifyMerchant('escalation', order);
      await wf.condition(() => !takenOver); // wait for merchant to handle it
      break;
    }
    const counter = await generateCounterOffer(order, supplierReply);
    await sendCounterOffer(counter);
    supplierReply = await raceSupplierResponse(order.id, { ... });
  }

  // 4. Seek approval (with reminder timers)
  await notifyMerchant('offer_received', order);
  const approved = await raceApproval({
    reminderEvery: '24 hours',
    holdMessageAfter: '48 hours',
  });

  if (!approved) {
    await sendCancellation(order);
    return { status: 'cancelled' };
  }

  // 5. Confirm with supplier
  await sendConfirmation(order);
  await raceConfirmation(order.id, {
    followUpAfter: '48 hours',
    alertMerchantAfter: '96 hours',
  });

  // 6. Update supplier intelligence
  await updateSupplierIntelligence(order);

  return { status: 'confirmed' };
}
```

The entire order lifecycle — from creation through negotiation, approval, and confirmation — is a single readable function. Every `await` is a durable checkpoint. Every timer survives crashes. Every signal is persisted.

---

## Recommendation

Temporal is a strong fit for PO Pro's core problem: orchestrating multi-step, multi-day supplier conversations with human-in-the-loop approvals, timed reminders, and reliable retries. It would eliminate the most complex custom infrastructure (cron scheduling, database state machines, timer polling, crash recovery) and replace it with straightforward sequential workflow code.

**The tradeoff is real:** there's a meaningful learning curve and an infrastructure dependency. For a single-merchant MVP, you could ship faster with custom cron + database + workers. But the foundation Temporal provides would pay off as the system scales to more merchants and more concurrent order workflows.

**If adopting Temporal**, the recommended path:
1. Use Temporal Cloud (not self-hosted) to avoid operational overhead — $6K startup credit covers ~1 year
2. Workers on Railway (long-running processes, not serverless)
3. Temporal client in Next.js API routes on Vercel (lightweight gRPC calls)
4. Keep PostgreSQL for application data; let Temporal own workflow state
5. Model each purchase order as one long-running workflow
6. Model email polling as a separate scheduled workflow per merchant

---

*Document created: February 2026*
*Sources: temporal.io docs, Temporal TypeScript SDK, Temporal Cloud pricing, Railway deployment guides*

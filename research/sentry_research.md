# Sentry Deep Dive -- Research & PO Pro Integration Guide

**Date:** February 2026
**Purpose:** Comprehensive research on the Sentry observability platform and analysis of how it fits into the PO Pro product specification.

---

## Table of Contents

1. [What Is Sentry](#1-what-is-sentry)
2. [Core Features](#2-core-features)
3. [How It Works -- SDK Integration & Event Lifecycle](#3-how-it-works)
4. [Architecture -- How Sentry Processes Events](#4-architecture)
5. [SDK Ecosystem](#5-sdk-ecosystem)
6. [Next.js Integration Deep Dive](#6-nextjs-integration)
7. [Key Concepts](#7-key-concepts)
8. [Performance Monitoring](#8-performance-monitoring)
9. [Alerting & Workflow](#9-alerting--workflow)
10. [Pricing Tiers](#10-pricing-tiers)
11. [Self-Hosting Option](#11-self-hosting-option)
12. [Alternatives Comparison](#12-alternatives-comparison)
13. [Best Practices](#13-best-practices)
14. [How Sentry Fits Into PO Pro](#14-how-sentry-fits-into-po-pro)

---

## 1. What Is Sentry

### Core Product

Sentry is a **developer-first application monitoring platform** specializing in real-time error tracking, performance monitoring, and application observability. It automatically captures exceptions, crashes, and slow transactions, then surfaces them with rich contextual data -- stack traces, breadcrumbs, user info, environment details -- so developers can diagnose and fix issues quickly.

### History

| Year | Event |
|------|-------|
| 2008 | Began as a Django plugin by David Cramer for Python error logging |
| 2015 | Incorporated as Functional Software, Inc.; launched sentry.io SaaS |
| 2019 | Relicensed from BSD-3 to Business Source License (BSL) |
| 2023 | Introduced the Functional Source License (FSL) -- converts to Apache 2.0/MIT after 2 years |
| 2024-25 | Expanded into full observability: Session Replay, Profiling, Cron Monitoring, Uptime Monitoring, AI-powered debugging (Seer/Autofix) |
| 2025 | Serves 100,000+ organizations, 1.3M+ users globally |

### Open-Source vs. SaaS

- **SaaS (sentry.io)**: The primary offering. Fully managed, multi-tenant cloud service. Most users use this.
- **Self-Hosted**: The Sentry codebase is available on GitHub under the FSL license. Anyone can self-host for free. However, it is **not "open source"** by the OSI definition -- it is "source-available" with a delayed open-source conversion (FSL -> Apache/MIT after 2 years).
- **Key restriction**: You cannot use the FSL-licensed code to build a competing hosted error-monitoring service. Internal use, modifications, and contributions are all permitted.

---

## 2. Core Features

### Error Tracking (Primary Feature)

- **Automatic exception capture**: Uncaught exceptions, unhandled promise rejections, and crashes are captured automatically by SDKs without explicit `try/catch`.
- **Stack traces**: Full stack traces with source code context, deobfuscated via source maps (JavaScript), ProGuard (Android), dSYM (iOS).
- **Intelligent issue grouping**: Events are grouped into "issues" using fingerprinting algorithms. Duplicate errors are deduplicated automatically.
- **Breadcrumbs**: Trail of events (clicks, navigation, console logs, HTTP requests) leading up to an error.
- **Rich context**: OS, browser, device, user info, custom tags, release version, environment.
- **User impact tracking**: See how many users are affected by each issue; prioritize by impact.

### Performance Monitoring (APM)

- **Distributed tracing**: Traces span across frontend, backend, microservices, databases.
- **Transaction tracking**: Measure latency, throughput, and error rates for every transaction.
- **Database query monitoring**: Identify slow queries and N+1 issues.
- **Web Vitals**: LCP, INP, CLS, TTFB, FCP automatically captured in browser SDKs.
- **Performance anomaly detection**: Alerts when performance degrades.

### Session Replay

- **DOM-based recording**: Captures DOM changes (not video) to create pixel-perfect playback of user sessions.
- **Privacy by default**: Sensitive text and input values are masked automatically.
- **Linked to errors**: Jump directly from an error to the replay showing what the user did before the crash.
- **Configurable sampling**: `replaysSessionSampleRate` (e.g., 10% of all sessions) and `replaysOnErrorSampleRate` (e.g., 100% of sessions with errors).

### Profiling

- **Code-level performance insights**: See which functions/lines of code are slow in production.
- **Continuous profiling**: Available for Python, Node.js, Go, Ruby, and others.
- **Linked to traces**: Profile data is correlated with specific transactions/spans.

### Cron Monitoring

- **Scheduled job monitoring**: Track whether recurring jobs run on time, complete successfully, or time out.
- **Check-in protocol**: Jobs send check-ins (started, completed, failed) to Sentry.
- **Alerts on missed runs**: Notification if a job doesn't run when expected.

### Uptime Monitoring

- **HTTP endpoint monitoring**: Sentry probes your endpoints and alerts on downtime.
- **Correlated with issues**: See related errors and user feedback alongside downtime.
- **Included in all plans**: At least one uptime monitor on every plan.

### AI Features (Seer)

- **Autofix (Beta)**: AI-powered root cause analysis and code fix suggestions. Uses Anthropic Claude 3.7 Sonnet for reasoning and Google Gemini Flash 2.0 as a research agent.
- **Issue Summary**: Translates complex error data into human-readable summaries.
- **AI-enhanced grouping**: Uses transformer-based text embeddings to identify semantically similar errors.
- **Trace-aware debugging**: Seer analyzes distributed traces to understand multi-service error propagation.

---

## 3. How It Works

### SDK Initialization

1. Install the SDK for your platform (e.g., `npm install @sentry/nextjs`).
2. Call `Sentry.init({ dsn: "...", tracesSampleRate: 1.0 })` as early as possible in your application.
3. The **DSN** (Data Source Name) is a URL-like string containing your project ID, public key, and the Sentry server address.

```
https://<public_key>@o<org_id>.ingest.sentry.io/<project_id>
```

The public key is safe to expose in client-side code -- it only allows sending events, not reading data.

### Automatic Event Capture

The SDK hooks into the runtime's global error handlers (`window.onerror`, `process.on('uncaughtException')`, etc.). HTTP requests, console calls, DOM events, and navigation are instrumented automatically for breadcrumbs and tracing. **No explicit `try/catch` needed** for most errors.

### Breadcrumbs

A trail of events (typically the 100 most recent) recorded before an error occurs.

**Automatically captured types:**
- DOM interactions (clicks, inputs)
- XHR/fetch requests
- Console API calls (`console.log`, `console.error`)
- Navigation/URL changes
- Network connectivity changes

**Custom breadcrumbs:**
```javascript
Sentry.addBreadcrumb({
  category: "auth",
  message: "User logged in",
  level: "info",
});
```

### Context Enrichment

```javascript
// Tags: key-value pairs indexed for search
Sentry.setTag("payment_method", "stripe");

// User context
Sentry.setUser({ id: "123", email: "user@example.com" });

// Extra data: arbitrary unstructured data
Sentry.setExtra("order_data", { orderId: "abc", quantity: 500 });
```

### Source Maps

For minified JavaScript, source maps allow Sentry to display original source code in stack traces.

**Upload methods:**
1. `withSentryConfig` in build tools (recommended for Next.js)
2. `sentry-cli releases files` in CI/CD
3. Webpack/Vite/Rollup plugins

Source maps are matched to events via the **release** tag and the `//# sourceMappingURL` comment.

### Release Tracking

```javascript
Sentry.init({
  release: "po-pro@1.2.3",
  environment: "production",
});
```

Enables: suspect commits, regression detection, release health (crash-free sessions/users), deploy tracking.

### Event Transport

Events are serialized into the **Envelope** format and sent to the Sentry ingestion endpoint via HTTPS POST. The Envelope format supports batching multiple items (errors, attachments, sessions, replays) in a single HTTP request. SDKs implement retry logic, offline caching, and rate limiting.

---

## 4. Architecture

### High-Level Data Flow

```
SDK -> Nginx -> Relay -> Kafka -> Ingest Consumer -> Preprocessing -> Processing -> Snuba Consumer -> ClickHouse
                                       |                                                                  |
                                       v                                                                  v
                                  Symbolicator                                                      Snuba (Query)
                                       |                                                                  |
                                       v                                                                  v
                                  PostgreSQL                                                        Sentry Web UI
                                  (nodestore)
```

### Key Infrastructure Components

| Component | Role |
|-----------|------|
| **Nginx** | TLS termination, load balancing |
| **Relay** (Rust) | Ingestion, validation, PII scrubbing, rate limiting |
| **Kafka** | Event streaming and decoupling |
| **Redis** | Caching (project configs, event payloads), Celery task queue |
| **PostgreSQL** | Relational data (users, projects, orgs), nodestore (event payloads) |
| **ClickHouse** | Analytics database for event search and aggregation |
| **Snuba** | Query layer between Sentry web and ClickHouse |
| **Symbolicator** | Source map resolution, dSYM processing, ProGuard deobfuscation |
| **Celery** | Distributed task queue for async processing |

### Relay

Written in **Rust** for high performance. Sits between SDKs and the processing pipeline.

**Responsibilities:**
1. Parses and validates envelopes
2. Verifies DSN and project ID
3. Applies rate limiting and quota enforcement
4. Scrubs PII
5. Forwards valid events to Kafka

Sentry operates Relay at global **Points of Presence (PoPs)** for low-latency ingestion worldwide.

### Processing Pipeline

1. **Relay** receives the envelope, validates it, reads project config from Redis, publishes to Kafka.
2. **Ingest Consumer** reads from Kafka, caches event in Redis, triggers `preprocess_event` Celery task.
3. **Preprocessing**: Symbolicates stack traces via Symbolicator (resolves minified frames, dSYMs, ProGuard mappings).
4. **Processing**: Applies grouping/fingerprinting, saves event payload to PostgreSQL, publishes processed event to Kafka.
5. **Snuba Consumer** reads processed events, writes to ClickHouse for fast analytical queries.
6. **Post-Process Forwarder** triggers alert evaluation, integration webhooks, and downstream actions.

---

## 5. SDK Ecosystem

### JavaScript Framework SDKs (Most Relevant to PO Pro)

| Framework | Package |
|-----------|---------|
| **Next.js** | `@sentry/nextjs` |
| React | `@sentry/react` |
| Node.js | `@sentry/node` |
| Browser | `@sentry/browser` |
| Vue | `@sentry/vue` |
| Angular | `@sentry/angular` |
| Remix | `@sentry/remix` |
| Electron | `@sentry/electron` |

### Language SDKs

| Language | Package |
|----------|---------|
| Python | `sentry-sdk` |
| Java/Kotlin | `sentry-java` |
| .NET/C# | `Sentry` (NuGet) |
| Go | `sentry-go` |
| Ruby | `sentry-ruby` |
| Rust | `sentry` (crates.io) |
| PHP | `sentry-php` |
| Dart/Flutter | `sentry-dart` |

### Mobile SDKs

| Platform | Package |
|----------|---------|
| React Native | `@sentry/react-native` |
| Android | `sentry-android` |
| iOS | `sentry-cocoa` |
| Flutter | `sentry_flutter` |

---

## 6. Next.js Integration

This section is the most relevant to PO Pro, which uses Next.js 14+ with App Router.

### Package

`@sentry/nextjs` (current version: 10.x as of early 2026). This single SDK handles **client, server, and edge runtimes** for Next.js applications.

### Installation

```bash
# Wizard (recommended -- auto-generates config files)
npx @sentry/wizard@latest -i nextjs

# Manual
npm install @sentry/nextjs
```

### Required Configuration Files

#### 1. `next.config.ts` -- Wrap config with `withSentryConfig`

```typescript
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig = {
  /* your Next.js config */
};

export default withSentryConfig(nextConfig, {
  org: "po-pro",
  project: "po-pro-web",
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Recommended options
  widenClientFileUpload: true,        // Better stack traces
  tunnelRoute: "/monitoring",          // Bypass ad-blockers
  disableLogger: true,                 // Remove Sentry logger from client bundle
  automaticVercelMonitors: true,       // Auto Vercel Cron monitoring
});
```

#### 2. `instrumentation-client.ts` -- Client-side initialization (runs in browser)

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,               // 1.0 in dev, lower in prod
  replaysSessionSampleRate: 0.1,       // 10% of sessions
  replaysOnErrorSampleRate: 1.0,       // 100% of error sessions
  integrations: [
    Sentry.replayIntegration(),
    Sentry.feedbackIntegration({ colorScheme: "system" }),
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

#### 3. `sentry.server.config.ts` -- Server-side initialization (Node.js runtime)

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});
```

#### 4. `sentry.edge.config.ts` -- Edge runtime initialization

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});
```

#### 5. `instrumentation.ts` -- Next.js instrumentation hook

```typescript
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors from Server Components, middleware, and API routes
export const onRequestError = Sentry.captureRequestError;
```

#### 6. `app/global-error.tsx` -- App Router error boundary

```typescript
"use client";
import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
```

### Key `withSentryConfig` Options

| Option | Description |
|--------|-------------|
| `org` / `project` | Sentry org slug and project slug |
| `authToken` | Auth token for source map upload during build |
| `silent` | Suppress build-time logs |
| `widenClientFileUpload` | Upload more files for better stack traces |
| `tunnelRoute` | Route browser events through your server (bypass ad-blockers) |
| `hideSourceMaps` | Remove `sourceMappingURL` comments from client bundles |
| `disableLogger` | Tree-shake Sentry's logger from client bundle |
| `automaticVercelMonitors` | Auto-instrument Vercel Cron Jobs |

### Server vs. Client Error Handling

| Error Origin | Capture Method |
|-------------|----------------|
| Client (browser) | Automatic via `global-error.tsx` + SDK global handler |
| Server Components | `onRequestError` instrumentation hook |
| API Routes (App Router) | `onRequestError` instrumentation hook |
| Server Actions | Wrap with `Sentry.withServerActionInstrumentation()` |
| Edge Runtime | Separate `sentry.edge.config.ts` |

### Runtime Detection in Sentry UI

| `contexts.runtime.name` | Origin |
|--------------------------|--------|
| `"node"` | Server-side |
| `"vercel-edge"` | Edge runtime |
| Not set | Browser/client |

### Tunneling

The `tunnelRoute: "/monitoring"` option creates a Next.js rewrite that proxies browser-to-Sentry traffic through your own domain. This prevents ad-blockers from blocking Sentry event submission.

**Important**: Exclude the tunnel route from your middleware matcher to avoid infinite loops.

### Source Maps in Next.js

When `authToken` is set, `withSentryConfig` automatically uploads source maps during `next build` via the Sentry Webpack plugin. For CI/CD, set `SENTRY_AUTH_TOKEN` as an environment variable in Vercel.

---

## 7. Key Concepts

### Scopes (v8+ -- Replaces Hubs)

As of SDK v8+, the old Hub concept is deprecated and replaced by a three-tier scope system:

| Scope | Lifetime | Purpose | Example |
|-------|----------|---------|---------|
| **Global Scope** | Application lifetime | Data that never changes | `release`, `environment`, `dist` |
| **Isolation Scope** | Per-request / per-tab | Request-specific data | `user`, `tags`, `contexts` |
| **Current Scope** | Per-span / per-block | Span-local data | Data set within `Sentry.withScope()` |

**Precedence**: Current > Isolation > Global.

### Transactions & Spans

- A **trace** is the entire journey of a request through your system.
- A **transaction** is a single unit of work within a trace (e.g., one page load, one API request).
- A **span** is a timed operation within a transaction (e.g., a database query, an HTTP call).
- Each span has: `op` (operation type), `description`, `start_timestamp`, `timestamp`, `status`, `data`.

### Distributed Tracing

When Service A calls Service B, the SDK propagates trace context via HTTP headers (`sentry-trace`, `baggage`). This links spans across services into a single trace. Uses **head-based sampling**: the sampling decision is made at the trace origin and propagated downstream.

### Sampling

- **`tracesSampleRate`**: A float 0.0-1.0 representing the probability of sampling a transaction (e.g., `0.1` = 10%).
- **`tracesSampler`**: A function for dynamic sampling decisions based on transaction name, URL, etc.
- **Inheritance**: In distributed tracing, downstream services inherit the sampling decision.
- **Dynamic Sampling (server-side)**: Sentry can apply additional sampling rules server-side (Business plan+).

### Fingerprinting & Issue Grouping

**Grouping priority** (checked in order):
1. Custom fingerprint (if set in SDK or via project rules)
2. Stack trace (most reliable -- uses in-app frames only)
3. Exception type + value
4. Message (fallback)

**AI-enhanced grouping**: Sentry's Seer generates vector embeddings of stack traces and uses semantic similarity to group issues that differ syntactically but represent the same root cause.

**Customization options:**
1. Merge issues manually in UI
2. Fingerprint rules (project settings)
3. Stack trace rules (project settings)
4. SDK fingerprinting: `scope.setFingerprint(["my-custom-group"])`

---

## 8. Performance Monitoring

### How Transaction Tracing Works

1. The SDK creates a **transaction** when a page loads, a navigation occurs, or an API request is received.
2. Within the transaction, child **spans** are automatically created for: HTTP requests (fetch/XHR), database queries, file I/O, template rendering, middleware execution.
3. The transaction is closed when the operation completes, and the full span tree is sent to Sentry.
4. In the UI, view the waterfall visualization of all spans within a transaction.

### Web Vitals

Sentry automatically captures Core Web Vitals via `browserTracingIntegration`:

| Metric | What It Measures |
|--------|-----------------|
| **LCP** | Loading performance -- time to render largest visible element |
| **INP** | Interactivity -- responsiveness to user input |
| **CLS** | Visual stability -- unexpected layout movement |
| **FCP** | Time to first meaningful paint |
| **TTFB** | Server response time |

Sentry calculates a **Performance Score** (0-100) based on these vitals, with per-page breakdowns.

### Custom Instrumentation

```javascript
const result = await Sentry.startSpan(
  { name: "expensive-operation", op: "function" },
  async (span) => {
    return doExpensiveWork();
  }
);
```

### Automatic Performance Issue Detection

Sentry automatically detects:
- **N+1 queries**: Repeated similar database queries
- **Slow DB queries**: Queries exceeding duration thresholds
- **Consecutive HTTP calls**: Sequential calls that could be parallelized
- **Large render-blocking assets**: Resources blocking page rendering

---

## 9. Alerting & Workflow

### Alert Types

| Type | Trigger | Example |
|------|---------|---------|
| **Issue Alerts** | Error events | First seen, regression, event count, user count |
| **Metric Alerts** | Aggregated metrics | P95 latency > threshold, error rate > X% |
| **Uptime Alerts** | Endpoint unreachable | HTTP probe fails |

### Alert Actions

- Email notification
- Slack message (to specific channel)
- PagerDuty incident
- Opsgenie alert
- Microsoft Teams message
- Custom webhook
- Jira ticket creation
- GitHub issue creation

### Issue Assignment

- **Ownership Rules**: Define file path / URL / tag patterns to auto-assign issues to teams or individuals.
- **CODEOWNERS sync**: Import GitHub/GitLab CODEOWNERS file for automatic routing.
- **Suspect Commits**: Identifies the commit that likely introduced the error and suggests the commit author.
- **Manual assignment**: From the UI or directly from Slack.

### Key Integrations

**Source Code Management:**
- **GitHub**: Suspect commits, stack trace linking, commit tracking, PR/issue creation, CODEOWNERS sync
- **GitLab**: Similar to GitHub

**Issue Tracking:**
- **Jira**: Two-way sync (comments, resolution status), automatic ticket creation
- **Linear**: Issue creation and linking

**Notification & Incident:**
- **Slack**: Rich notifications with resolve/archive/assign buttons
- **PagerDuty**: Incident creation and management

**CI/CD:**
- GitHub Actions, Vercel, Netlify for source map upload and release creation

---

## 10. Pricing Tiers

### Current Pricing (2025-2026)

| Feature | Developer (Free) | Team ($29/mo) | Business ($89/mo) | Enterprise (Custom) |
|---------|-------------------|---------------|-------------------|---------------------|
| **Users** | 1 | Unlimited | Unlimited | Unlimited |
| **Errors/month** | 5,000 | 50,000 | 50,000 | Custom |
| **Performance events** | 10,000 | 100,000 | 100,000 | Custom |
| **Session Replays** | 50 | 500 | 500 | Custom |
| **Cron Monitors** | 1 | Unlimited | Unlimited | Unlimited |
| **Uptime Monitors** | 1 | 1+ | 1+ | Custom |
| **Data Retention** | 30 days | 90 days | 90 days | Custom |
| **Alerting** | Email only | All integrations | All integrations | All integrations |
| **SSO/SAML** | No | No | Yes | Yes |
| **Dynamic Sampling** | No | No | Yes | Yes |

### Pricing Model

- **Event-based**: Pay for the volume of errors, transactions, replays, and profiles sent.
- **Spike protection**: Sentry caps overage charges to prevent bill shock.
- **Annual commitment**: ~10-15% savings on annual billing.

---

## 11. Self-Hosting Option

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 16 GB (+16 GB swap) | 32 GB |
| Disk | 20 GB | 50+ GB |
| Docker | 19.03.6+ | Latest stable |

### Installation

```bash
git clone https://github.com/getsentry/self-hosted.git
cd self-hosted
./install.sh
docker compose up --wait
# Access at http://localhost:9000
```

### Components (20+ Docker containers)

Sentry Web (Django), Sentry Workers (Celery), Relay (Rust), Kafka + Zookeeper, ClickHouse, PostgreSQL, Redis, Snuba, Symbolicator, Memcached, Nginx, and various consumers.

### When to Self-Host

- Data sovereignty / compliance requirements (GDPR, HIPAA)
- Extremely high event volumes where SaaS pricing becomes prohibitive
- Air-gapped environments
- You have DevOps/SRE capacity to maintain the infrastructure

### Recommendation for PO Pro

**Use SaaS (sentry.io)**. Self-hosting is overkill for an MVP. The free Developer tier (5K errors/month) is sufficient for initial development and testing. Upgrade to Team ($29/mo) when onboarding real users.

---

## 12. Alternatives Comparison

### Sentry vs. Datadog

| Dimension | Sentry | Datadog |
|-----------|--------|---------|
| **Focus** | Developer-centric error tracking + APM | Full-stack infrastructure + APM + logs |
| **Error Tracking** | Best-in-class: rich context, source maps, suspect commits, AI grouping | Errors as part of APM; less detailed |
| **Infrastructure Monitoring** | Not available | Comprehensive |
| **Session Replay** | Built-in, well-integrated | Available as add-on, extra cost |
| **Pricing** | Affordable; free tier; self-hosting option | Significantly more expensive |
| **Best For** | Dev teams focused on error tracking + app performance | Organizations needing unified infra + app observability |

### Sentry vs. New Relic

| Dimension | Sentry | New Relic |
|-----------|--------|-----------|
| **Error Tracking** | More granular, detailed context | Good but less detailed |
| **Free Tier** | 5K errors/month, 1 user | 100 GB/month ingestion, 1 user |
| **Pricing Model** | Per-event | Per-user + data ingestion |
| **Infrastructure** | No | Full infrastructure monitoring |
| **Best For** | Error-focused teams | Teams needing full-stack observability |

### Sentry vs. LogRocket

| Dimension | Sentry | LogRocket |
|-----------|--------|-----------|
| **Session Replay** | Good (DOM-based) | Best-in-class |
| **Error Tracking** | Best-in-class | Good, secondary to replay |
| **Backend Monitoring** | Yes | Limited; frontend-focused |
| **Best For** | Full-stack error tracking | Frontend UX debugging |

### Sentry vs. Bugsnag

| Dimension | Sentry | Bugsnag |
|-----------|--------|---------|
| **Error Tracking** | Excellent across all platforms | Excellent, especially mobile |
| **APM** | Full transaction tracing | Basic performance metrics |
| **Best For** | Full-stack web + mobile | Mobile-first teams |

### Sentry vs. Rollbar

| Dimension | Sentry | Rollbar |
|-----------|--------|---------|
| **Error Tracking** | Rich context, source maps, replays | Straightforward, simple API |
| **APM** | Full transaction tracing | No APM |
| **Best For** | Teams wanting error tracking + performance | Small teams wanting simple error tracking |

### Other Alternatives

- **SigNoz**: Open-source, OpenTelemetry-native. Good for data ownership.
- **GlitchTip**: Open-source Sentry-compatible alternative (simpler, lighter).
- **Dynatrace**: Enterprise-scale, AI-powered. Expensive.

---

## 13. Best Practices

### What to Track

- **All unhandled exceptions** -- on by default, never disable
- **Key user flows** -- order creation, approval, supplier management
- **API endpoints** -- response times and error rates for critical routes
- **Background jobs** -- use Cron Monitoring for email polling and reminders
- **Web Vitals** -- automatic via `browserTracingIntegration`
- **Release health** -- always set `release` in `Sentry.init()` and tag deploys

### What NOT to Track

- **Expected errors** -- don't send known/handled errors (e.g., 404s, validation errors). Use `beforeSend` to filter.
- **Third-party script errors** -- filter `Script error.` events from cross-origin scripts.
- **Bot traffic** -- filter known bot user agents.
- **Health check endpoints** -- exclude `/health`, `/ping` from transaction tracking.
- **High-volume, low-value events** -- console warnings, deprecation notices.

### PII Scrubbing

- **`sendDefaultPii: false`** (the default): SDK does not send IP addresses, cookies, or request headers.
- **`beforeSend`**: Scrub sensitive data in the SDK before it leaves the client. Most secure approach.
- **Server-side scrubbing**: Configure in Project Settings > Security & Privacy. Auto-scrubs fields matching `password`, `secret`, `token`, `authorization`, `credit_card`.
- **Advanced Data Scrubbing**: Use PII rule syntax for custom patterns (e.g., regex for custom field names).
- **Principle**: Scrub at the SDK level first, then add server-side scrubbing as a safety net.

### Performance Sampling Rates

| Scenario | Recommended Rate |
|----------|-----------------|
| Development | `tracesSampleRate: 1.0` (100%) |
| Production start | `tracesSampleRate: 0.05` to `0.1` (5-10%) |
| Critical flows (checkout, approval) | Sample at 100% via `tracesSampler` |
| Health checks | Sample at 0-1% |
| Error replays | `replaysOnErrorSampleRate: 1.0` (always) |
| Normal session replays | `replaysSessionSampleRate: 0.1` (10%) |

### Source Map Upload

- **Always upload source maps** for production JavaScript builds.
- Use `withSentryConfig` with `authToken` for automatic upload during `next build`.
- **Delete source maps from deployed bundles**: use `sourcemaps.deleteFilesAfterUpload: true`.
- **Verify**: Use `sentry-cli releases files <release> list` to confirm maps are uploaded.
- **Match releases**: Ensure the `release` value in `Sentry.init()` matches the release used during upload.

### General Configuration

- Set `environment: "production"` / `"staging"` / `"development"` in `Sentry.init()`.
- Use `tunnelRoute` in Next.js to prevent ad-blocker interference.
- Start with default alerts, then tune thresholds over time.
- Connect GitHub for suspect commits and Slack for real-time notifications.
- Enable `debug: true` in development only.

---

## 14. How Sentry Fits Into PO Pro

### Already Specified in the Product Spec

Sentry is already called out in the PO Pro product spec:

- **Section 2.1 (Tech Stack)**: `Error Tracking | Sentry | Error capture and alerting`
- **Section 15.1 (Error Tracking)**: "Tool: Sentry. Coverage: All unhandled exceptions, API errors, LLM Service failures (including per-provider breakdown and fallback activation rate)"
- **Section 21 (Environment Variables)**: `SENTRY_DSN=`

### Recommended Plan for PO Pro

| Phase | Plan | Cost | Rationale |
|-------|------|------|-----------|
| **Development/MVP** | Developer (Free) | $0/mo | 5K errors, 10K transactions, 1 user. Sufficient for solo development and self-testing. |
| **First real users** | Team | $29/mo | 50K errors, 100K transactions, unlimited users. Slack/GitHub integrations for real alerting. |
| **Growth** | Business | $89/mo | Dynamic sampling, SSO if needed. Only if volume or features demand it. |

### Integration Points with PO Pro Architecture

#### 1. Next.js Web App (Vercel)

This is the primary integration point. `@sentry/nextjs` covers:

- **Client-side errors**: Dashboard React component crashes, form submission failures, API call failures from the browser.
- **Server-side errors**: API route failures (`/api/orders`, `/api/suppliers`, `/api/gmail`), Server Component rendering errors, auth failures.
- **Performance**: Page load times (dashboard, order detail, supplier management), API response times, Web Vitals.

#### 2. Railway Background Workers

The Railway worker (email polling, agent processing, reminders) should use `@sentry/node`:

```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.RELEASE_VERSION,
  tracesSampleRate: 1.0,
});
```

**Critical errors to track in workers:**
- Gmail API failures (token refresh, rate limits, permission revoked)
- LLM Service failures (Claude API timeouts, fallback activations, total failures)
- Email parsing failures (extraction errors, unparseable attachments)
- Policy evaluation errors (rule parsing failures, unexpected states)

#### 3. Cron Monitoring for Scheduled Jobs

Sentry Cron Monitoring is a natural fit for PO Pro's scheduled tasks:

| Job | Frequency | What to Monitor |
|-----|-----------|-----------------|
| Email Poller | Every 5-15 min | Did it run? Did it complete? How long did it take? |
| Approval Reminders | Hourly | Did it send all pending reminders? |
| Supplier Follow-ups | Hourly | Did it check all pending follow-ups? |
| Hold Messages | Hourly | Did it send hold messages for 48h+ pending approvals? |

```typescript
// Example: Email poller with Sentry Cron check-in
const checkInId = Sentry.captureCheckIn({
  monitorSlug: "email-poller",
  status: "in_progress",
});

try {
  await pollEmails();
  Sentry.captureCheckIn({
    checkInId,
    monitorSlug: "email-poller",
    status: "ok",
  });
} catch (error) {
  Sentry.captureCheckIn({
    checkInId,
    monitorSlug: "email-poller",
    status: "error",
  });
  throw error;
}
```

#### 4. Custom Context for PO Pro Domain

Enrich Sentry events with PO Pro-specific context so errors are actionable:

```typescript
// Set merchant context on login
Sentry.setUser({
  id: merchant.id,
  email: merchant.email,
  username: merchant.businessName,
});

// Tag events with order context in API routes / workers
Sentry.setTag("order_id", order.id);
Sentry.setTag("order_status", order.status);
Sentry.setTag("supplier_id", order.merchantSupplier.supplierId);

// Track LLM provider context
Sentry.setContext("llm_service", {
  primary_provider: "claude",
  primary_model: "claude-3-haiku",
  fallback_provider: "openai",
  fallback_model: "gpt-4o",
  attempt_number: attemptNumber,
  used_fallback: usedFallback,
});
```

#### 5. Custom Fingerprinting for PO Pro Error Categories

Group errors by domain-relevant categories rather than generic stack traces:

```typescript
// Group all LLM primary provider failures together
Sentry.withScope((scope) => {
  scope.setFingerprint(["llm-primary-failure", provider, model]);
  Sentry.captureException(error);
});

// Group all Gmail API token refresh failures together
Sentry.withScope((scope) => {
  scope.setFingerprint(["gmail-token-refresh-failure"]);
  Sentry.captureException(error);
});

// Group extraction failures by supplier
Sentry.withScope((scope) => {
  scope.setFingerprint(["extraction-failure", supplierId]);
  Sentry.captureException(error);
});
```

#### 6. Breadcrumbs for Agent Decision Trail

Add custom breadcrumbs that mirror PO Pro's audit log, giving rich context when errors occur:

```typescript
// Before LLM call
Sentry.addBreadcrumb({
  category: "llm_service",
  message: `Calling ${provider}/${model} for policy evaluation`,
  level: "info",
  data: { orderId, attemptNumber },
});

// After policy evaluation
Sentry.addBreadcrumb({
  category: "policy_engine",
  message: `Policy evaluation: ${complianceStatus}`,
  level: "info",
  data: { matchedRules, recommendedAction },
});

// Before sending email
Sentry.addBreadcrumb({
  category: "gmail",
  message: `Sending email to ${supplierEmail}`,
  level: "info",
  data: { orderId, emailType: "counter_offer" },
});
```

#### 7. Distributed Tracing Across Vercel + Railway

PO Pro has a split architecture (Vercel web + Railway workers). Distributed tracing connects the dots:

```
[Vercel Cron] --HTTP--> [Railway Worker] --HTTP--> [Gmail API]
                              |
                              +--> [Claude API]
                              |
                              +--> [PostgreSQL]
```

When the Vercel Cron triggers the Railway worker via HTTP, Sentry's `sentry-trace` and `baggage` headers propagate automatically. A single trace can show:
1. Cron trigger latency
2. Worker processing time
3. Gmail API call duration
4. LLM reasoning duration
5. Database write time

#### 8. Alert Configuration for PO Pro

| Alert | Type | Condition | Action |
|-------|------|-----------|--------|
| Gmail API Down | Issue | First seen, tag `category:gmail` | Slack + Email |
| LLM Service Total Failure | Issue | Event count > 3 in 1h, tag `category:llm_service` | Slack + Email |
| High Error Rate | Metric | Error rate > 5% in 15min | Slack |
| Email Poller Missed | Cron | No check-in for 30 min | Email |
| Approval Reminder Missed | Cron | No check-in for 2 hours | Email |
| Slow API Response | Metric | P95 > 5s for `/api/orders` | Slack |

#### 9. Session Replay for Merchant Debugging

Session Replay is valuable for understanding merchant-reported issues:
- "The approval button didn't work" -- watch the replay to see exactly what happened
- "I couldn't add a supplier" -- see the form state, API errors, UI behavior
- Set `replaysOnErrorSampleRate: 1.0` to always capture replays when errors occur

#### 10. Uptime Monitoring

Use Sentry's built-in uptime monitoring (or complement with Better Uptime / Checkly as spec suggests):
- Monitor the main dashboard URL
- Monitor the API health endpoint
- Correlate downtime with error spikes

### PO Pro-Specific Error Categories to Track

Based on the product spec's failure modes (Section 19):

| Failure Mode | What Sentry Tracks | Custom Tags/Context |
|-------------|-------------------|---------------------|
| Agent agrees incorrectly | Policy evaluation errors, unexpected LLM responses | `order_id`, `policy_compliance_status` |
| Supplier confusion | Email bounce rates, unusual response patterns | `supplier_id`, `email_type` |
| Too many escalations | Escalation rate metrics | `escalation_reason` |
| Email deliverability | Gmail API errors, bounce events | `supplier_email`, `gmail_error_code` |
| Parsing failures | Extraction errors, LLM parse failures | `supplier_id`, `attachment_type` |
| LLM failures | Provider errors, fallback activations | `llm_provider`, `llm_model`, `attempt_number`, `used_fallback` |
| Gmail disconnection | Token refresh failures, permission errors | `merchant_id`, `gmail_error_type` |

### Environment Variables for PO Pro

```env
# Sentry -- Client (exposed to browser)
NEXT_PUBLIC_SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>

# Sentry -- Server/Build (never exposed to browser)
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
SENTRY_AUTH_TOKEN=sntrys_...   # For source map upload
SENTRY_ORG=po-pro
SENTRY_PROJECT=po-pro-web
```

### Implementation Priority

| Priority | Task | Effort |
|----------|------|--------|
| **P0** | Install `@sentry/nextjs`, configure DSN, set up error tracking | 1 hour |
| **P0** | Configure source map upload in `next.config.ts` | 15 min |
| **P0** | Add `global-error.tsx` for App Router error boundary | 15 min |
| **P1** | Add `@sentry/node` to Railway worker | 30 min |
| **P1** | Add custom context (merchant, order, supplier tags) | 1 hour |
| **P1** | Set up Cron Monitoring for email poller + reminders | 1 hour |
| **P2** | Configure Slack integration for alerts | 30 min |
| **P2** | Configure GitHub integration for suspect commits | 15 min |
| **P2** | Add custom breadcrumbs for agent decision trail | 2 hours |
| **P2** | Set up Session Replay | 15 min |
| **P3** | Fine-tune fingerprinting rules | 1 hour |
| **P3** | Set up performance monitoring with custom spans | 2 hours |
| **P3** | Configure dynamic sampling for production | 30 min |

---

*End of Sentry Research Document*

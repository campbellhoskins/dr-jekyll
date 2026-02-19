# Agent Memory Systems: Mem0 and Implementation Plan for PO Pro

## What is Mem0?

[Mem0](https://mem0.ai/) is a **memory layer for AI agents** that solves a fundamental problem: LLMs forget everything between conversations. While your agent might have a brilliant negotiation with a supplier today, tomorrow it starts from zero.

Mem0 provides **persistent, intelligent memory** that:
- Extracts important facts from conversations automatically
- Stores them efficiently (not raw transcripts)
- Retrieves relevant memories when needed
- Updates/deletes memories as information changes

**Key stats from [Mem0 research](https://arxiv.org/abs/2504.19413):**
- 26% higher accuracy than OpenAI's memory
- 91% lower latency than full-context approaches
- 90%+ token cost savings vs. stuffing full history into context

---

## How Mem0 Works: Technical Architecture

### The Core Problem

Traditional approach: Stuff entire conversation history into LLM context.
```
[Message 1] + [Message 2] + ... + [Message 500] + [New Query] → LLM
```

Problems:
- Context windows have limits (even 200K fills up)
- Most historical messages aren't relevant to current query
- Expensive: paying for tokens you don't need
- Slow: more tokens = more latency

### Mem0's Solution: Extract → Store → Retrieve

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MEM0 ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CONVERSATION                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ User: "We usually order 500 units from Acme Corp"           │   │
│  │ Agent: "Got it, I'll use that as the baseline quantity"     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              MEMORY EXTRACTION MODULE                        │   │
│  │                                                              │   │
│  │  Input: New message pair + Conversation summary +            │   │
│  │         Last 10 messages (for context)                       │   │
│  │                                                              │   │
│  │  LLM extracts candidate facts:                               │   │
│  │  - "Standard order quantity for Acme Corp is 500 units"      │   │
│  │  - "User works with supplier named Acme Corp"                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              MEMORY UPDATE MODULE                            │   │
│  │                                                              │   │
│  │  For each candidate fact, compare to existing memories:      │   │
│  │                                                              │   │
│  │  • ADD    - New fact, no similar memory exists               │   │
│  │  • UPDATE - Augments existing memory with new info           │   │
│  │  • DELETE - Contradicts existing memory (old one removed)    │   │
│  │  • NOOP   - Already known, no change needed                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              MEMORY STORAGE                                  │   │
│  │                                                              │   │
│  │  Vector Database (for similarity search):                    │   │
│  │  ┌────────────────────────────────────────────────────────┐ │   │
│  │  │ ID: mem_001                                             │ │   │
│  │  │ Text: "Standard order quantity for Acme Corp: 500"      │ │   │
│  │  │ Embedding: [0.23, -0.45, 0.12, ...]                     │ │   │
│  │  │ Metadata: {supplier: "acme", type: "preference"}        │ │   │
│  │  │ Timestamp: 2026-02-13T10:30:00Z                         │ │   │
│  │  └────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  LATER: New conversation about Acme Corp...                        │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              MEMORY RETRIEVAL                                │   │
│  │                                                              │   │
│  │  Query: "Drafting order for Acme Corp"                       │   │
│  │  → Vector similarity search                                  │   │
│  │  → Returns: "Standard order quantity for Acme Corp: 500"     │   │
│  │  → Injected into LLM context for response generation         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Mem0g: Graph Memory Extension

For complex relationships, Mem0 offers a graph-based variant ([Mem0g](https://mem0.ai/blog/graph-memory-solutions-ai-agents)):

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GRAPH MEMORY STRUCTURE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│     [Merchant: TechStore]                                          │
│            │                                                        │
│            ├──── works_with ────► [Supplier: Acme Corp]            │
│            │                            │                           │
│            │                            ├── offers ──► [SKU: Widget-A]
│            │                            │                    │      │
│            │                            │              last_price   │
│            │                            │                    │      │
│            │                            │                    ▼      │
│            │                            │              [$3.50/unit] │
│            │                            │                           │
│            │                            └── contact ──► [Email: sales@acme.com]
│            │                                                        │
│            └──── prefers ────► [Payment: NET 30]                   │
│                                                                     │
│  Triplet examples:                                                  │
│  (TechStore, works_with, Acme Corp)                                │
│  (Acme Corp, offers, Widget-A)                                     │
│  (Widget-A, last_price, $3.50/unit)                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Graph memory excels at:
- Multi-hop reasoning: "What suppliers offer products under $4?"
- Temporal tracking: "How has Acme's pricing changed over time?"
- Relationship queries: "Which suppliers have we used for electronics?"

---

## Alternative Memory Systems

| System | Best For | Architecture | Pros | Cons |
|--------|----------|--------------|------|------|
| **[Mem0](https://github.com/mem0ai/mem0)** | Production apps needing personalization | Vector + Graph hybrid | Most mature, 26% accuracy gain, AWS partnership | Requires infrastructure setup |
| **[Zep](https://www.getzep.com/)** | Enterprise with temporal reasoning | Temporal knowledge graph | Tracks fact changes over time, <100ms retrieval | More complex setup |
| **[LangMem](https://python.langchain.com/docs/)** | LangChain users | Semantic/procedural/episodic | Easy if already using LangChain | Less battle-tested |
| **Custom** | Full control | Your choice | Tailored to exact needs | Build everything yourself |

**Source:** [Memory Systems Comparison](https://www.index.dev/skill-vs-skill/ai-mem0-vs-zep-vs-langchain-memory)

---

## How Memory Would Work in PO Pro

### Current State (No Memory)

Each negotiation is isolated:
```
Order #1 with Acme Corp:
- Agent negotiates, learns Acme counters 5% higher
- Order completes
- Knowledge is lost

Order #2 with Acme Corp (3 months later):
- Agent starts from zero
- Makes same mistakes
- No benefit from past experience
```

### With Memory Enabled

```
Order #1 with Acme Corp:
- Agent negotiates, learns Acme counters 5% higher
- Memory extracted: "Acme Corp typically counters 5% above initial ask"
- Order completes

Order #2 with Acme Corp (3 months later):
- Agent retrieves: "Acme Corp typically counters 5% above initial ask"
- Agent's initial offer accounts for this
- Better negotiation outcome
```

---

## Implementation Plan for PO Pro

### Phase 1: Memory Data Model

Add to Prisma schema:

```prisma
// Memory stored per merchant-supplier relationship
model SupplierMemory {
  id              String   @id @default(uuid())
  merchantId      String
  supplierId      String

  // The extracted memory fact
  memoryText      String
  memoryType      MemoryType

  // Vector embedding for similarity search
  embedding       Float[]  // pgvector extension

  // Metadata
  confidence      Float    @default(1.0)
  sourceOrderId   String?  // Which order this came from

  // Lifecycle
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  supersededAt    DateTime? // Soft delete when updated
  supersededBy    String?   // ID of memory that replaced this

  merchant        Merchant @relation(fields: [merchantId], references: [id])
  supplier        Supplier @relation(fields: [supplierId], references: [id])

  @@index([merchantId, supplierId])
  @@index([embedding]) // For vector similarity search
}

enum MemoryType {
  NEGOTIATION_PATTERN   // "Supplier counters 5% higher"
  PRICING_INSIGHT       // "Prices drop 10% for orders over 1000"
  COMMUNICATION_STYLE   // "Responds within 24 hours"
  RELATIONSHIP_FACT     // "Primary contact is John"
  MERCHANT_PREFERENCE   // "Prefers NET 30 terms"
  PRODUCT_INFO          // "Lead time increases in Q4"
}
```

### Phase 2: Memory Extraction Service

```typescript
// src/lib/memory/extractor.ts

interface ExtractedMemory {
  text: string;
  type: MemoryType;
  confidence: number;
}

interface ExtractionContext {
  currentMessages: Message[];      // Current negotiation
  orderContext: OrderContext;      // SKU, quantity, rules
  conversationSummary?: string;    // Summary of older messages
}

export async function extractMemories(
  context: ExtractionContext
): Promise<ExtractedMemory[]> {

  const prompt = `
You are analyzing a supplier negotiation to extract memorable facts.

## Current Negotiation
${formatMessages(context.currentMessages)}

## Order Context
- SKU: ${context.orderContext.skuName}
- Quantity: ${context.orderContext.quantity}
- Supplier: ${context.orderContext.supplierName}

## Task
Extract facts that would be valuable for FUTURE negotiations with this supplier.
Focus on:
1. Negotiation patterns (how they respond to counters)
2. Pricing insights (volume discounts, seasonal changes)
3. Communication style (response time, formality)
4. Relationship facts (key contacts, preferences)
5. Product-specific info (lead times, MOQ flexibility)

Do NOT extract:
- One-time facts specific to this order
- Information already in our system (stored prices, MOQ)
- Obvious/generic business practices

Return JSON array:
[
  {
    "text": "Supplier typically counters 5% above their initial quote",
    "type": "NEGOTIATION_PATTERN",
    "confidence": 0.85
  }
]

Return empty array [] if no valuable memories found.
`;

  const response = await claude.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  return parseMemories(response);
}
```

### Phase 3: Memory Update Logic

```typescript
// src/lib/memory/updater.ts

type MemoryOperation = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';

interface UpdateDecision {
  operation: MemoryOperation;
  existingMemoryId?: string;
  reasoning: string;
}

export async function updateMemories(
  merchantId: string,
  supplierId: string,
  newMemories: ExtractedMemory[]
): Promise<void> {

  for (const memory of newMemories) {
    // 1. Generate embedding for new memory
    const embedding = await generateEmbedding(memory.text);

    // 2. Find similar existing memories (vector search)
    const similarMemories = await db.$queryRaw`
      SELECT id, memory_text, embedding,
             1 - (embedding <=> ${embedding}::vector) as similarity
      FROM supplier_memory
      WHERE merchant_id = ${merchantId}
        AND supplier_id = ${supplierId}
        AND superseded_at IS NULL
      ORDER BY embedding <=> ${embedding}::vector
      LIMIT 5
    `;

    // 3. Decide operation via LLM
    const decision = await decideOperation(memory, similarMemories);

    // 4. Execute operation
    switch (decision.operation) {
      case 'ADD':
        await db.supplierMemory.create({
          data: {
            merchantId,
            supplierId,
            memoryText: memory.text,
            memoryType: memory.type,
            embedding,
            confidence: memory.confidence
          }
        });
        break;

      case 'UPDATE':
        // Soft-delete old, create new with reference
        const newMem = await db.supplierMemory.create({
          data: {
            merchantId,
            supplierId,
            memoryText: memory.text,
            memoryType: memory.type,
            embedding,
            confidence: memory.confidence
          }
        });
        await db.supplierMemory.update({
          where: { id: decision.existingMemoryId },
          data: {
            supersededAt: new Date(),
            supersededBy: newMem.id
          }
        });
        break;

      case 'DELETE':
        await db.supplierMemory.update({
          where: { id: decision.existingMemoryId },
          data: { supersededAt: new Date() }
        });
        break;

      case 'NOOP':
        // Do nothing
        break;
    }

    // 5. Log to audit trail
    await auditLog.log({
      eventType: 'memory_update',
      merchantId,
      data: { memory, decision }
    });
  }
}
```

### Phase 4: Memory Retrieval for Agent

```typescript
// src/lib/memory/retriever.ts

interface RetrievedMemory {
  text: string;
  type: MemoryType;
  relevanceScore: number;
  createdAt: Date;
}

export async function retrieveRelevantMemories(
  merchantId: string,
  supplierId: string,
  query: string,
  limit: number = 5
): Promise<RetrievedMemory[]> {

  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(query);

  // Vector similarity search
  const memories = await db.$queryRaw<RetrievedMemory[]>`
    SELECT
      memory_text as text,
      memory_type as type,
      1 - (embedding <=> ${queryEmbedding}::vector) as relevance_score,
      created_at
    FROM supplier_memory
    WHERE merchant_id = ${merchantId}
      AND supplier_id = ${supplierId}
      AND superseded_at IS NULL
      AND 1 - (embedding <=> ${queryEmbedding}::vector) > 0.7  -- similarity threshold
    ORDER BY embedding <=> ${queryEmbedding}::vector
    LIMIT ${limit}
  `;

  return memories;
}
```

### Phase 5: Integration with Agent

```typescript
// src/lib/agent/context-builder.ts

export async function buildAgentContext(
  order: Order
): Promise<AgentContext> {

  // Existing context
  const recentMessages = await getRecentMessages(order.id, 10);
  const negotiationRules = await getNegotiationRules(order.supplierId);

  // NEW: Retrieve relevant memories
  const memories = await retrieveRelevantMemories(
    order.merchantId,
    order.supplierId,
    `Negotiating ${order.sku.name} quantity ${order.quantityMin}`
  );

  return {
    orderContext: formatOrderContext(order),
    recentMessages: formatMessages(recentMessages),
    negotiationRules: negotiationRules.rulesText,
    escalationTriggers: negotiationRules.escalationTriggersText,

    // NEW: Include memories in context
    supplierMemories: memories.length > 0
      ? formatMemoriesForPrompt(memories)
      : null
  };
}

function formatMemoriesForPrompt(memories: RetrievedMemory[]): string {
  return `
## Relevant Knowledge About This Supplier

Based on past negotiations, here's what we know:

${memories.map(m => `- ${m.text}`).join('\n')}

Use this information to inform your negotiation strategy, but don't mention
these facts explicitly to the supplier.
`;
}
```

### Phase 6: Memory Extraction Trigger

```typescript
// src/lib/services/order-processor.ts

export async function processOrderCompletion(orderId: string): Promise<void> {
  const order = await getOrderWithConversation(orderId);

  if (order.status !== 'confirmed') return;

  // Extract memories from completed negotiation
  const memories = await extractMemories({
    currentMessages: order.conversation.messages,
    orderContext: {
      skuName: order.sku.merchantSku,
      quantity: order.quantityMin,
      supplierName: order.supplier.name
    }
  });

  if (memories.length > 0) {
    await updateMemories(
      order.merchantId,
      order.supplierId,
      memories
    );
  }
}
```

---

## Merchant Visibility (Critical for Trust)

Following the "no hidden learned behaviors" principle, merchants should see and control memories:

### Memory Dashboard Component

```typescript
// src/components/suppliers/supplier-memories.tsx

export function SupplierMemories({ supplierId }: { supplierId: string }) {
  const { data: memories } = useSupplierMemories(supplierId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What the Agent Has Learned</CardTitle>
        <CardDescription>
          Facts extracted from past negotiations. You can edit or remove any of these.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {memories?.map(memory => (
          <MemoryItem
            key={memory.id}
            memory={memory}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}
        <Button onClick={handleAddManual}>
          + Add Manual Note
        </Button>
      </CardContent>
    </Card>
  );
}
```

### Manual Memory Addition

Allow merchants to add their own knowledge:
```typescript
// "This supplier gives better prices if you mention competitor X"
// "Contact John directly for rush orders"
// "They're closed during Chinese New Year"
```

---

## Infrastructure Requirements

### Option A: Managed Mem0 (Recommended for MVP)

```typescript
// Using Mem0's hosted service
import { Memory } from 'mem0ai';

const memory = new Memory({
  api_key: process.env.MEM0_API_KEY
});

// Add memories
await memory.add(messages, { user_id: `${merchantId}-${supplierId}` });

// Search memories
const relevant = await memory.search(query, {
  user_id: `${merchantId}-${supplierId}`,
  limit: 5
});
```

**Pros:** No infrastructure to manage, battle-tested
**Cons:** External dependency, data leaves your system

### Option B: Self-Hosted with pgvector

```sql
-- Enable pgvector extension in Neon
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column
ALTER TABLE supplier_memory
ADD COLUMN embedding vector(1536);

-- Create index for fast similarity search
CREATE INDEX ON supplier_memory
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

**Pros:** Data stays in your system, no external dependency
**Cons:** Need to manage embeddings, more code to write

### Option C: Hybrid (Recommended Long-term)

- Use pgvector for storage (data stays in Neon)
- Use OpenAI or Voyage for embeddings
- Custom extraction logic tailored to negotiations

---

## Implementation Phases

### B3a: Basic Memory (Week 1-2)

1. Add SupplierMemory model to Prisma
2. Implement extraction service (runs on order completion)
3. Implement retrieval service
4. Inject memories into agent context
5. Add "Supplier Notes" UI for manual entries

**Deliverable:** Agent uses past negotiation insights

### B3b: Memory Management UI (Week 3)

1. Display memories in supplier detail view
2. Allow merchant to edit/delete memories
3. Show memory source (which order it came from)
4. Add manual memory creation

**Deliverable:** Merchant can see and control what agent knows

### B3c: Memory Quality & Refinement (Week 4+)

1. Track which memories were useful (led to better outcomes)
2. Confidence decay for old memories
3. Memory deduplication and consolidation
4. Analytics: "Memories that improved negotiations"

**Deliverable:** Memory system improves over time

---

## Example: Memory in Action

### Negotiation #1 (No memories yet)

```
Agent → Supplier: "Quote for 500 Widget-A?"
Supplier → Agent: "$4.00/unit"
Agent → Supplier: "Can you do $3.50?"
Supplier → Agent: "$3.90 is our best"
Agent → Merchant: [Approval request for $3.90]
Merchant: [Approves]
```

**Memory extracted:** "Acme Corp's first counter is typically ~2.5% off their initial price"

### Negotiation #2 (With memory)

```
[Memory retrieved: "Acme Corp's first counter is typically ~2.5% off their initial price"]

Agent → Supplier: "Quote for 500 Widget-A?"
Supplier → Agent: "$4.00/unit"
Agent → Supplier: "Based on our volume, we're targeting $3.80"
          (Agent opens lower knowing supplier will counter)
Supplier → Agent: "$3.85 is our best"
Agent → Merchant: [Approval request for $3.85]
```

**Result:** $0.05/unit savings = $25 on 500 units, adds up over time

---

## Sources

- [Mem0 GitHub Repository](https://github.com/mem0ai/mem0)
- [Mem0 Research Paper (arXiv:2504.19413)](https://arxiv.org/abs/2504.19413)
- [Mem0 Official Documentation](https://docs.mem0.ai/)
- [AWS Mem0 Integration Guide](https://aws.amazon.com/blogs/database/build-persistent-memory-for-agentic-ai-applications-with-mem0-open-source-amazon-elasticache-for-valkey-and-amazon-neptune-analytics/)
- [Memory Systems Comparison: Mem0 vs Zep vs LangMem](https://www.index.dev/skill-vs-skill/ai-mem0-vs-zep-vs-langchain-memory)
- [Survey of AI Agent Memory Frameworks](https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks)

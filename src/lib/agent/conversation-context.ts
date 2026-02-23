export interface ConversationMessage {
  role: "agent" | "supplier";
  content: string;
  timestamp: Date;
}

/**
 * Tracks conversation history across turns.
 * Designed for in-memory use in chat mode; will be backed by DB in B3.
 */
export class ConversationContext {
  private messages: ConversationMessage[] = [];

  /** Add an agent (outbound) message */
  addAgentMessage(content: string): void {
    this.messages.push({ role: "agent", content, timestamp: new Date() });
  }

  /** Add a supplier (inbound) message */
  addSupplierMessage(content: string): void {
    this.messages.push({ role: "supplier", content, timestamp: new Date() });
  }

  /** Get all messages in order */
  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  /** Get message count */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * Format the conversation history for inclusion in LLM prompts.
   * Returns a readable thread format.
   */
  formatForPrompt(): string {
    if (this.messages.length === 0) return "No prior messages.";

    return this.messages
      .map((m) => {
        const label = m.role === "agent" ? "AGENT (sent)" : "SUPPLIER (received)";
        return `[${label}]\n${m.content}`;
      })
      .join("\n\n---\n\n");
  }
}

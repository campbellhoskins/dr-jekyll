import type { ExtractedQuoteData } from "./types";

export interface ConversationMessage {
  role: "agent" | "supplier";
  content: string;
  timestamp: Date;
}

/**
 * Tracks conversation history and accumulated extraction data across turns.
 * Designed for in-memory use in chat mode; will be backed by DB in B3.
 */
export class ConversationContext {
  private messages: ConversationMessage[] = [];
  private mergedData: Partial<ExtractedQuoteData> = {};

  /** Add an agent (outbound) message */
  addAgentMessage(content: string): void {
    this.messages.push({ role: "agent", content, timestamp: new Date() });
  }

  /** Add a supplier (inbound) message */
  addSupplierMessage(content: string): void {
    this.messages.push({ role: "supplier", content, timestamp: new Date() });
  }

  /** Merge new extraction data — new non-null values override, nulls don't overwrite */
  mergeExtraction(data: ExtractedQuoteData): void {
    if (data.quotedPrice !== null) this.mergedData.quotedPrice = data.quotedPrice;
    if (data.quotedPriceCurrency) this.mergedData.quotedPriceCurrency = data.quotedPriceCurrency;
    if (data.quotedPriceUsd !== null) this.mergedData.quotedPriceUsd = data.quotedPriceUsd;
    if (data.availableQuantity !== null) this.mergedData.availableQuantity = data.availableQuantity;
    if (data.moq !== null) this.mergedData.moq = data.moq;
    if (data.leadTimeMinDays !== null) this.mergedData.leadTimeMinDays = data.leadTimeMinDays;
    if (data.leadTimeMaxDays !== null) this.mergedData.leadTimeMaxDays = data.leadTimeMaxDays;
    if (data.paymentTerms !== null) this.mergedData.paymentTerms = data.paymentTerms;
    if (data.validityPeriod !== null) this.mergedData.validityPeriod = data.validityPeriod;
  }

  /** Get the best-known extraction data (merged across all turns) */
  getMergedData(): Partial<ExtractedQuoteData> {
    return { ...this.mergedData };
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

  /**
   * Format the merged extraction data for inclusion in prompts.
   */
  formatMergedDataForPrompt(): string {
    const d = this.mergedData;
    const lines: string[] = [];
    if (d.quotedPrice !== undefined) lines.push(`Price: ${d.quotedPrice} ${d.quotedPriceCurrency ?? "USD"} ($${d.quotedPriceUsd ?? "?"} USD)`);
    if (d.availableQuantity !== undefined) lines.push(`Quantity: ${d.availableQuantity}`);
    if (d.moq !== undefined) lines.push(`MOQ: ${d.moq}`);
    if (d.leadTimeMinDays !== undefined) {
      const lt = d.leadTimeMaxDays && d.leadTimeMaxDays !== d.leadTimeMinDays
        ? `${d.leadTimeMinDays}-${d.leadTimeMaxDays} days`
        : `${d.leadTimeMinDays} days`;
      lines.push(`Lead Time: ${lt}`);
    }
    if (d.paymentTerms !== undefined) lines.push(`Payment: ${d.paymentTerms}`);
    if (d.validityPeriod !== undefined) lines.push(`Validity: ${d.validityPeriod}`);
    return lines.length > 0 ? lines.join("\n") : "No data extracted yet.";
  }
}

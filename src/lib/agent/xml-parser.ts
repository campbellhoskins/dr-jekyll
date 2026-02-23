import type { AgentAction } from "./types";

/**
 * Extracts content between XML-style tags from text.
 * Returns the trimmed content or null if the tag is not found.
 */
export function extractXmlTag(text: string, tagName: string): string | null {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;

  const startIdx = text.indexOf(openTag);
  if (startIdx === -1) return null;

  const contentStart = startIdx + openTag.length;
  const endIdx = text.indexOf(closeTag, contentStart);
  if (endIdx === -1) return null;

  return text.substring(contentStart, endIdx).trim();
}

/**
 * Parses the decision section to extract the overall action.
 * Looks for "Overall Action: ACCEPT/COUNTER/ESCALATE".
 * Defaults to "escalate" if parsing fails (safe fallback).
 */
export function parseDecision(decisionText: string): { action: AgentAction } {
  const match = decisionText.match(/Overall\s+Action:\s*(ACCEPT|COUNTER|ESCALATE)/i);
  if (!match) {
    return { action: "escalate" };
  }
  return { action: match[1].toLowerCase() as AgentAction };
}

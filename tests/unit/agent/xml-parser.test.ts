import { extractXmlTag, parseDecision } from "@/lib/agent/xml-parser";

describe("extractXmlTag", () => {
  it("extracts content between matching tags", () => {
    const text = "Some preamble\n<foo>bar baz</foo>\nSome postamble";
    expect(extractXmlTag(text, "foo")).toBe("bar baz");
  });

  it("extracts multiline content", () => {
    const text = `<systematic_evaluation>
Line 1
Line 2
Line 3
</systematic_evaluation>`;
    expect(extractXmlTag(text, "systematic_evaluation")).toBe("Line 1\nLine 2\nLine 3");
  });

  it("returns null when tag is not found", () => {
    expect(extractXmlTag("no tags here", "missing")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(extractXmlTag("", "foo")).toBeNull();
  });

  it("handles tags with surrounding whitespace in content", () => {
    const text = "<response>  Hello World  </response>";
    expect(extractXmlTag(text, "response")).toBe("Hello World");
  });

  it("extracts only the first occurrence when multiple tags exist", () => {
    const text = "<note>first</note> some text <note>second</note>";
    expect(extractXmlTag(text, "note")).toBe("first");
  });

  it("handles nested content that looks like XML", () => {
    const text = `<response>
Dear Supplier,

We would like to <b>confirm</b> the order.

Best regards
</response>`;
    const result = extractXmlTag(text, "response");
    expect(result).toContain("confirm");
    expect(result).toContain("Dear Supplier");
  });

  it("handles real agent output format", () => {
    const text = `<systematic_evaluation>
**1. Relevant Rules:**
Price rule: target $4.00

**2. Supplier Terms:**
Price: $4.50
</systematic_evaluation>

<decision>
- Price: NEEDS COUNTER
Overall Action: COUNTER
</decision>

<response>
Thank you for your quote. We were hoping for a price closer to $4.00 per unit.
</response>`;

    expect(extractXmlTag(text, "systematic_evaluation")).toContain("Relevant Rules");
    expect(extractXmlTag(text, "decision")).toContain("COUNTER");
    expect(extractXmlTag(text, "response")).toContain("$4.00 per unit");
  });
});

describe("parseDecision", () => {
  it("parses ACCEPT action", () => {
    const text = `- Price: ACCEPTABLE - accept
- Quantity: ACCEPTABLE - accept
Overall Action: ACCEPT`;
    const result = parseDecision(text);
    expect(result.action).toBe("accept");
  });

  it("parses COUNTER action", () => {
    const text = `- Price: NEEDS COUNTER - counter at $4.00
- Quantity: ACCEPTABLE
Overall Action: COUNTER`;
    const result = parseDecision(text);
    expect(result.action).toBe("counter");
  });

  it("parses ESCALATE action", () => {
    const text = `- Price: ESCALATE - exceeds maximum
Overall Action: ESCALATE`;
    const result = parseDecision(text);
    expect(result.action).toBe("escalate");
  });

  it("is case-insensitive for action parsing", () => {
    expect(parseDecision("Overall Action: accept").action).toBe("accept");
    expect(parseDecision("Overall Action: Accept").action).toBe("accept");
    expect(parseDecision("Overall Action: ACCEPT").action).toBe("accept");
  });

  it("defaults to escalate when action cannot be parsed", () => {
    const result = parseDecision("no action here");
    expect(result.action).toBe("escalate");
  });

  it("defaults to escalate for empty text", () => {
    const result = parseDecision("");
    expect(result.action).toBe("escalate");
  });
});

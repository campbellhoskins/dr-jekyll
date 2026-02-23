import type { OrderInformation } from "@/lib/agent/types";

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

function deepMerge<T>(base: T, overrides?: DeepPartial<T>): T {
  if (!overrides) return base;
  const result = { ...base } as Record<string, unknown>;
  const over = overrides as Record<string, unknown>;
  for (const key of Object.keys(over)) {
    const val = over[key];
    if (val !== undefined && typeof val === "object" && val !== null && !Array.isArray(val)) {
      result[key] = deepMerge(
        (result[key] ?? {}) as Record<string, unknown>,
        val as DeepPartial<Record<string, unknown>>
      );
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result as T;
}

export function buildTestOrderInformation(overrides?: DeepPartial<OrderInformation>): OrderInformation {
  const base: OrderInformation = {
    merchant: {
      merchantId: "test-m1",
      merchantName: "Test Merchant",
      contactName: "Test Contact",
      contactEmail: "test@example.com",
    },
    supplier: {
      supplierName: "Test Supplier",
      relationshipTier: "standard",
    },
    product: {
      merchantSKU: "TEST-SKU",
      supplierProductCode: "TST-001",
      productName: "Test Product",
    },
    pricing: {
      currency: "USD",
      targetPrice: 4.00,
      maximumAcceptablePrice: 5.00,
      lastKnownPrice: 4.25,
    },
    quantity: {
      targetQuantity: 500,
      minimumAcceptableQuantity: 200,
      maximumAcceptableQuantity: 1000,
    },
    leadTime: {
      maximumLeadTimeDays: 45,
    },
    escalation: {
      additionalTriggers: ["Escalate if MOQ exceeds 1000 units"],
    },
  };

  return deepMerge(base, overrides);
}

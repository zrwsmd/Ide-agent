const NON_EVIDENCE_VALUES = new Set([
  "???",
  "N/A",
  "NA",
  "NONE",
  "NULL",
  "UNDEFINED",
  "UNKNOWN",
  "TRUE",
  "FALSE",
]);

export function compactBusinessEvidenceText(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  const compatibleText = text.normalize("NFKC");
  const placeholder = compatibleText
    .replace(/[\s._\\/-]+/gu, "")
    .toUpperCase();
  if (
    NON_EVIDENCE_VALUES.has(compatibleText.toUpperCase()) ||
    NON_EVIDENCE_VALUES.has(placeholder) ||
    /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(compatibleText) ||
    /^(?:"[^"]*"|'[^']*')$/u.test(compatibleText)
  ) {
    return "";
  }

  return text;
}

export function normalizeBusinessEvidenceText(value: unknown): string {
  const text = compactBusinessEvidenceText(value);
  if (!text) {
    return "";
  }

  return splitBusinessIdentifierWords(text.normalize("NFKC"))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function businessEvidenceTextVariants(value: unknown): string[] {
  const text = compactBusinessEvidenceText(value);
  if (!text) {
    return [];
  }

  const compatibleText = text.normalize("NFKC");
  return uniqueStrings([
    text,
    compatibleText,
    splitBusinessIdentifierWords(compatibleText),
    normalizeBusinessEvidenceText(compatibleText),
  ]);
}

export function splitBusinessIdentifierWords(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalizedKey = value.toLowerCase();
    if (!value || seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);
    result.push(value);
  }
  return result;
}

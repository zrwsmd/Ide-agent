import * as fs from "fs";
import * as path from "path";
import { normalizeBlockType } from "./BusinessEvidence";

export interface LibraryElementInfo {
  name: string;
  type: string;
  inputs?: Array<[string, string, string]>;
  outputs?: Array<[string, string, string]>;
  comment?: string;
  category?: string;
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArrayRecord(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value
        .map(asPlainRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function asStringConfig(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asArrayConfig(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isFunctionLibraryElement(
  libraryElement: LibraryElementInfo,
): boolean {
  return libraryElement.type === "function";
}

export function getLibraryElement(
  name: string,
): LibraryElementInfo | undefined {
  const normalized = normalizeBlockType(name);
  if (!normalized) {
    return undefined;
  }

  const data = loadLibraryData();
  return data.get(normalized);
}

let cachedLibraryData: Map<string, LibraryElementInfo> | undefined;

function loadLibraryData(): Map<string, LibraryElementInfo> {
  if (cachedLibraryData) {
    return cachedLibraryData;
  }

  const filePath = path.join(__dirname, "st-library-info-data.json");
  const parsed = readJsonFile(filePath);
  const elements = new Map<string, LibraryElementInfo>();

  for (const category of asArrayRecord(parsed)) {
    const categoryName = asStringConfig(category.name);
    for (const item of asArrayRecord(category.list)) {
      const name = asStringConfig(item.name);
      const type = asStringConfig(item.type);
      if (!name || !type) {
        continue;
      }

      const libraryElement: LibraryElementInfo = {
        name,
        type,
        category: categoryName,
        comment: asStringConfig(item.comment),
        inputs: parseLibraryPorts(item.inputs),
        outputs: parseLibraryPorts(item.outputs),
      };
      const key = normalizeBlockType(name);
      if (!elements.has(key)) {
        elements.set(key, libraryElement);
      }
    }
  }

  cachedLibraryData = elements;
  return elements;
}

function parseLibraryPorts(
  value: unknown,
): Array<[string, string, string]> | undefined {
  const ports = asArrayConfig(value)
    .map((entry) =>
      Array.isArray(entry) && entry.length >= 2
        ? [
            asStringConfig(entry[0]),
            asStringConfig(entry[1]),
            asStringConfig(entry[2]),
          ]
        : undefined,
    )
    .filter((entry): entry is [string, string, string] => Boolean(entry));

  return ports.length > 0 ? ports : undefined;
}

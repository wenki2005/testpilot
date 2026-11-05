import { sha256Hex } from "../../shared/sha256.js";
import type { DocumentProjectRevisionKind } from "../shared/test-model.js";

function canonicalRevisionJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => left.localeCompare(right, "en"))
          .map(([key, entry]) => [key, canonicalize(entry)]),
      );
    }
    return item;
  };
  return JSON.stringify(canonicalize(value));
}

/** Stable digest shared by saved project revisions and evidence that points to them. */
export function documentProjectRevisionDigest(kind: DocumentProjectRevisionKind, entityId: string, snapshot: unknown): string {
  return sha256Hex(`testpilot-project-revision-v1\0${kind}\0${entityId}\0${canonicalRevisionJson(snapshot)}`);
}

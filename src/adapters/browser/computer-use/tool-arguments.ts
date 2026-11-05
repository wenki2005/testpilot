/** Decode transport variations without repairing or executing malformed JSON.
 * Some compatible relays return an already-decoded object or JSON-encoded JSON.
 * Only a complete object is accepted; truncation remains an explicit error. */
export function parseComputerUseToolArguments(value: unknown): Record<string, unknown> {
  let decoded = value;
  for (let depth = 0; depth < 2 && typeof decoded === 'string'; depth++) {
    const text = decoded.trim();
    const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*)\n```$/u);
    decoded = JSON.parse(fenced ? fenced[1]! : text);
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Computer Use tool arguments must be one JSON object.');
  if (typeof (decoded as Record<string, unknown>).action !== 'string') throw new Error('Computer Use tool action is missing.');
  return decoded as Record<string, unknown>;
}

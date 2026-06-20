import { ApiError } from './api-client';

/**
 * Best-effort human message for an unknown thrown value.
 *
 * Order:
 *  1. `ApiError` → its `friendlyMessage()` (status-code-based).
 *  2. `Error` → `.message`.
 *  3. `string` → as-is.
 *  4. anything else → `fallback` (default: "Request failed").
 */
export function formatError(e: unknown, fallback = 'Request failed'): string {
  if (e instanceof ApiError) return e.friendlyMessage();
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return fallback;
}

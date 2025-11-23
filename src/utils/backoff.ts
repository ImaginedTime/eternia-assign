/**
 * Calculate exponential backoff delay
 * @param attempt - Current attempt number (0-indexed)
 * @param baseMs - Base delay in milliseconds
 * @returns Delay in milliseconds
 */
export function calculateBackoff(attempt: number, baseMs: number): number {
  return baseMs * Math.pow(2, attempt);
}

/**
 * Sleep with exponential backoff
 */
export async function sleepWithBackoff(
  attempt: number,
  baseMs: number
): Promise<void> {
  const delay = calculateBackoff(attempt, baseMs);
  await new Promise((resolve) => setTimeout(resolve, delay));
}


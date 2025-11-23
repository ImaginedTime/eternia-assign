import { describe, it, expect } from 'vitest';
import { calculateBackoff, sleepWithBackoff } from '../utils/backoff';
import { sleep } from '../utils/sleep';

describe('Backoff utilities', () => {
  it('should calculate exponential backoff correctly', () => {
    const baseMs = 500;
    expect(calculateBackoff(0, baseMs)).toBe(500);
    expect(calculateBackoff(1, baseMs)).toBe(1000);
    expect(calculateBackoff(2, baseMs)).toBe(2000);
    expect(calculateBackoff(3, baseMs)).toBe(4000);
  });

  it('should sleep with backoff', async () => {
    const start = Date.now();
    await sleepWithBackoff(1, 100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(190); // Allow some margin
    expect(elapsed).toBeLessThan(300);
  });
});

describe('Sleep utility', () => {
  it('should sleep for specified milliseconds', async () => {
    const start = Date.now();
    await sleep(100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(200);
  });
});


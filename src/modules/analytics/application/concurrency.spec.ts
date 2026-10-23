import { settleWithConcurrency } from './concurrency.js';

describe('settleWithConcurrency', () => {
  it('limits parallelism and keeps the order', async () => {
    let running = 0;
    let peak = 0;
    const results = await settleWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      if (n === 3) throw new Error('caído');
      return n * 10;
    });
    expect(peak).toBe(2);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : 'x'))).toEqual([10, 20, 'x', 40, 50]);
  });

  it('handles empty input', async () => {
    await expect(settleWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });
});

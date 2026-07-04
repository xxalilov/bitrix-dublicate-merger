// Per-portal token-bucket limiter. Bitrix24 sustains ~2 REST req/s per portal
// (leaky bucket + "operating time" limit); bursting past that returns 503
// QUERY_LIMIT_EXCEEDED. We serialize outgoing calls per member_id to stay under.

interface Bucket { tokens: number; last: number; }

const RATE = Number(process.env.BITRIX_RATE_PER_SEC || 2); // tokens added per second
const BURST = Number(process.env.BITRIX_BURST || 2);       // bucket capacity

const buckets = new Map<string, Bucket>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Wait until a token is available for `key`, then consume it.
export async function acquire(key: string): Promise<void> {
  for (;;) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: BURST, last: now }; buckets.set(key, b); }
    // Refill based on elapsed time.
    b.tokens = Math.min(BURST, b.tokens + ((now - b.last) / 1000) * RATE);
    b.last = now;
    if (b.tokens >= 1) { b.tokens -= 1; return; }
    // Not enough — wait for the next token to accrue.
    await sleep(Math.ceil(((1 - b.tokens) / RATE) * 1000));
  }
}

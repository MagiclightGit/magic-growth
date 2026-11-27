import { setTimeout as delay } from 'node:timers/promises';

// Local integration tests share an IP. Respect the real auth limiter between suites.
export async function signInWithRetry(request: () => Promise<Response>) {
  for (let attempt = 0; ; attempt++) {
    const response = await request();
    if (response.status !== 429 || attempt >= 3) return response;
    const retryAfter = response.headers.get('retry-after');
    const seconds = Number(retryAfter);
    const wait = retryAfter
      ? Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retryAfter) - Date.now()
      : 11_000;
    if (!Number.isFinite(wait) || wait > 60_000) return response;
    await response.body?.cancel();
    await delay(Math.max(1000, wait) + 100);
  }
}

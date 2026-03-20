import type { FtvEvent, Transfer } from "@/lib/generator/types";

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Submit a single transfer (array of events) to Syncrofy with retry logic
export async function submitTransfer(events: FtvEvent[]): Promise<void> {
  const endpoint = process.env.SYNCROFY_ENDPOINT;
  const apiKey = process.env.SYNCROFY_API_KEY;
  const authHeader = process.env.SYNCROFY_AUTH_HEADER ?? "token";

  if (!endpoint || !apiKey) {
    throw new Error("SYNCROFY_ENDPOINT and SYNCROFY_API_KEY must be set");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [authHeader]: apiKey,
  };

  const body = JSON.stringify(events);
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(endpoint, { method: "POST", headers, body, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) return;
      const text = await res.text().catch(() => "");
      if (attempt === maxAttempts) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === maxAttempts) throw err;
    }
    // Exponential backoff: 1s, 2s, 4s
    await delay(1000 * Math.pow(2, attempt - 1));
  }
}

// Submit a batch of transfers sequentially with progress callback
export async function submitBatch(
  transfers: Transfer[],
  onProgress?: (submitted: number, total: number, key: string) => void
): Promise<{ submitted: number; failed: number; errors: string[] }> {
  let submitted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < transfers.length; i++) {
    const [key, events] = transfers[i];
    try {
      await submitTransfer(events);
      submitted++;
    } catch (err) {
      failed++;
      errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    onProgress?.(i + 1, transfers.length, key);
    // 50-100ms between requests
    if (i < transfers.length - 1) {
      await delay(50 + Math.random() * 50);
    }
  }

  return { submitted, failed, errors };
}

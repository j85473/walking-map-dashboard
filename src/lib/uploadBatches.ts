import type { Walk } from "./walkTypes";

export type UploadItem = { walk: Walk; fileIndex: number };
export type UploadBatch = { items: UploadItem[]; body: string };

// Stay below the route's 8 MB limit and its 20-walk transaction limit.
export const MAX_UPLOAD_BATCH_BYTES = 7_500_000;
export const MAX_UPLOAD_BATCH_WALKS = 20;

export function makeUploadBatches(
  items: UploadItem[],
  maxBytes = MAX_UPLOAD_BATCH_BYTES,
  maxWalks = MAX_UPLOAD_BATCH_WALKS,
): { batches: UploadBatch[]; oversized: UploadItem[] } {
  const batches: UploadBatch[] = [];
  const oversized: UploadItem[] = [];
  const encoder = new TextEncoder();
  let pending: UploadItem[] = [];
  let payloads: string[] = [];
  let bodyBytes = 2; // JSON array brackets

  const flush = () => {
    if (pending.length) batches.push({ items: pending, body: `[${payloads.join(",")}]` });
    pending = [];
    payloads = [];
    bodyBytes = 2;
  };

  for (const item of items) {
    const payload = JSON.stringify(item.walk);
    const payloadBytes = encoder.encode(payload).byteLength;
    if (payloadBytes + 2 > maxBytes) {
      oversized.push(item);
      continue;
    }
    if (pending.length === maxWalks || bodyBytes + payloadBytes + (pending.length ? 1 : 0) > maxBytes) flush();
    bodyBytes += payloadBytes + (pending.length ? 1 : 0);
    pending.push(item);
    payloads.push(payload);
  }
  flush();
  return { batches, oversized };
}

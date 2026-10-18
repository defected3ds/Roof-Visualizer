/**
 * SAM 3 results kept per photo and prompt, so the roof and wall masks the browser asks for and the roof measurement (which needs
 * the same masks) share one call instead of making two.
 */
import { segmentRoof } from './providers';
import type { SegmentationSettings } from '../src/types';

const cache = new Map<string, { at: number; job: Promise<string[]> }>();
const TTL = 30 * 60 * 1000;

/** The masks for a prompt on a photo; `fresh` is true when this call actually went to SAM 3 (and so costs money). */
export function segmentCached(photoId: string | null | undefined, seg: SegmentationSettings, image: string): { job: Promise<string[]>; fresh: boolean } {
  if (!photoId) return { job: segmentRoof(seg, image), fresh: true };
  const key = `${photoId}|${seg.prompt}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return { job: hit.job, fresh: false };
  for (const [k, v] of cache) if (now - v.at > TTL) cache.delete(k);
  if (cache.size > 400) cache.delete(cache.keys().next().value as string);
  const job = segmentRoof(seg, image);
  cache.set(key, { at: now, job });
  // A failed call must not be remembered: the next request tries again.
  job.catch(() => {
    if (cache.get(key)?.job === job) cache.delete(key);
  });
  return { job, fresh: true };
}

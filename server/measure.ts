/**
 * Roof measurements from one photo: SAM 3 finds the roof and a wall, Apple Depth Pro (on Replicate) gives metric depth and the
 * camera's focal length, and plain geometry turns the roof pixels into 3D points and fits planes to them. Everything is an estimate
 * (see `notes` in the result); an unreliable photo returns confidence "low" so the app sends no numbers.
 */
import { inflateRawSync, inflateSync } from 'node:zlib';
import { imageSize, segmentRoof } from './providers';
import type { MeasurementSettings, Product, SegmentationSettings } from '../src/types';

const REPLICATE = process.env.REPLICATE_API_URL || 'https://api.replicate.com/v1';
/** oitoito/depth-pro on Replicate: input image_path, output npz (depth) + color_map + focal_length_px. Override with DEPTH_PRO_VERSION. */
const DEPTH_PRO_VERSION = '229e06384ee89b1e658ef5cd2859698a91aadef68d7537fbd4095e9fd92ae456';

export interface PlaneResult {
  /** Slope of the plane against the horizontal, degrees. */
  pitchDeg: number;
  /** Length along the eave (horizontal direction in the plane), metres. */
  eaveM: number;
  /** Length up the slope (rafter length), metres. */
  slopeM: number;
  /** Surface area of the plane's pixels, square metres. */
  areaM2: number;
  /** Share of the roof mask that belongs to this plane, 0–1. */
  share: number;
}

export interface Measurement {
  planes: PlaneResult[];
  roofAreaM2: number;
  focalPx: number;
  /** How "up" was found: from the wall's plane, or by assuming a level camera. */
  up: 'wall' | 'level';
  confidence: 'ok' | 'low';
  notes: string[];
  ms: number;
  /** Numbers for checking a measurement by hand (shown in the admin test only). */
  debug?: Record<string, number | string>;
  /** Depth Pro's coloured depth picture as a data URL (for the loading screen), when it could be fetched. */
  colorMap?: string;
}

// ---- Depth Pro on Replicate -----------------------------------------------------------------

async function depthPro(token: string, image: string): Promise<{ depth: Float32Array; w: number; h: number; focalPx: number; colorMap?: string }> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${REPLICATE}/predictions`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'wait=60' },
    body: JSON.stringify({ version: process.env.DEPTH_PRO_VERSION || DEPTH_PRO_VERSION, input: { image_path: await uploadImage(token, image) } }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Replicate Depth Pro ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let pred: any = await res.json();
  const deadline = Date.now() + 150_000;
  while (pred.status !== 'succeeded') {
    if (pred.status === 'failed' || pred.status === 'canceled') throw new Error(`Replicate Depth Pro ${pred.status}: ${String(pred.error ?? '').slice(0, 300)}`);
    if (Date.now() > deadline) throw new Error('Replicate Depth Pro timed out');
    await new Promise((r) => setTimeout(r, 1500));
    const next = await fetch(pred.urls?.get, { headers, signal: AbortSignal.timeout(30_000) });
    if (!next.ok) throw new Error(`Replicate Depth Pro status ${next.status}`);
    pred = await next.json();
  }
  const out = pred.output as { npz?: string; color_map?: string; focal_length_px?: number } | undefined;
  if (!out?.npz) throw new Error(`Depth Pro returned no depth file: ${JSON.stringify(pred.output).slice(0, 200)}`);
  const file = await fetch(out.npz, { signal: AbortSignal.timeout(60_000) });
  if (!file.ok) throw new Error(`Downloading the depth file failed: ${file.status}`);
  const { depth, w, h } = readNpzDepth(Buffer.from(await file.arrayBuffer()));
  const focalPx = Number(out.focal_length_px);
  if (!Number.isFinite(focalPx) || focalPx <= 0) throw new Error('Depth Pro returned no focal length');
  let colorMap: string | undefined;
  if (out.color_map?.startsWith('http')) {
    try {
      const pic = await fetch(out.color_map, { signal: AbortSignal.timeout(30_000) });
      const type = pic.headers.get('content-type') || 'image/png';
      const bytes = pic.ok ? Buffer.from(await pic.arrayBuffer()) : null;
      if (bytes && bytes.length < 3_000_000 && type.startsWith('image/')) colorMap = `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      /* the picture is only decoration */
    }
  }
  return { depth, w, h, focalPx, colorMap };
}

/** Uploads the photo to Replicate's file store and returns its URL (a large data URL in the request body is slow and may be refused). Falls back to the data URL. */
async function uploadImage(token: string, dataUrl: string): Promise<string> {
  try {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) return dataUrl;
    const form = new FormData();
    form.append('content', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), `photo.${match[1].includes('png') ? 'png' : 'jpg'}`);
    const res = await fetch(`${REPLICATE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return dataUrl;
    const file = (await res.json()) as { urls?: { get?: string } };
    return file.urls?.get ?? dataUrl;
  } catch {
    return dataUrl;
  }
}

/** First 2D float array in an .npz (a zip of .npy files). */
export function readNpzDepth(buf: Buffer): { depth: Float32Array; w: number; h: number } {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('The depth file is not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + extraLen + commentLen;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const raw = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    const arr = parseNpy(data);
    if (arr && arr.shape.length >= 2) {
      const shape = arr.shape.filter((d) => d > 1);
      if (shape.length === 2) return { depth: arr.data, w: shape[1], h: shape[0] };
    }
  }
  throw new Error('No 2D depth array in the depth file');
}

function parseNpy(b: Buffer): { shape: number[]; data: Float32Array } | null {
  if (b.length < 12 || b.readUInt8(0) !== 0x93 || b.toString('latin1', 1, 6) !== 'NUMPY') return null;
  const major = b.readUInt8(6);
  const headerLen = major === 1 ? b.readUInt16LE(8) : b.readUInt32LE(8);
  const start = (major === 1 ? 10 : 12) + headerLen;
  const header = b.toString('latin1', major === 1 ? 10 : 12, start);
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1] ?? '';
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const size = shape.reduce((a, c) => a * c, 1);
  const body = b.subarray(start);
  const data = new Float32Array(size);
  const kind = descr.replace(/^[<>|=]/, '');
  if (kind === 'f4') for (let i = 0; i < size; i++) data[i] = body.readFloatLE(i * 4);
  else if (kind === 'f8') for (let i = 0; i < size; i++) data[i] = body.readDoubleLE(i * 8);
  else if (kind === 'f2') for (let i = 0; i < size; i++) data[i] = halfToFloat(body.readUInt16LE(i * 2));
  else return null;
  return { shape, data };
}

function halfToFloat(h: number) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

// ---- Masks (PNG from SAM 3) -------------------------------------------------------------------

/** Decodes a PNG data URL to a boolean mask (white = true). Handles non-interlaced PNGs of all colour types. */
export function pngMask(dataUrl: string): { mask: Uint8Array; w: number; h: number } {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('A mask is not a PNG');
  let p = 8;
  let w = 0;
  let h = 0;
  let depth = 8;
  let type = 0;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body.readUInt8(8);
      type = body.readUInt8(9);
      if (body.readUInt8(12) !== 0) throw new Error('Interlaced PNG masks are not supported');
    } else if (kind === 'PLTE') palette = Buffer.from(body);
    else if (kind === 'IDAT') idat.push(Buffer.from(body));
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const channels = type === 0 ? 1 : type === 2 ? 3 : type === 3 ? 1 : type === 4 ? 2 : 4;
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((w * bitsPerPixel) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const cur = Buffer.alloc(stride);
  let prev = Buffer.alloc(stride);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = (cur[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      let lum: number;
      let alpha = 255;
      if (depth < 8) {
        const bit = x * depth;
        const v = (cur[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        lum = type === 3 ? (palette ? palette[v * 3] : v) : (v * 255) / ((1 << depth) - 1);
      } else if (depth === 16) {
        const o = x * channels * 2;
        lum = cur[o];
        if (type === 4) alpha = cur[o + 2];
        if (type === 6) alpha = cur[o + 6];
      } else {
        const o = x * channels;
        if (type === 3) lum = palette ? palette[cur[o] * 3] : cur[o];
        else {
          lum = cur[o];
          if (type === 4) alpha = cur[o + 1];
          if (type === 6) alpha = cur[o + 3];
        }
      }
      mask[y * w + x] = lum > 127 && alpha > 127 ? 1 : 0;
    }
    prev = Buffer.from(cur);
  }
  return { mask, w, h };
}

/** Union of several masks, resampled (nearest) to w × h. */
function unionMasks(dataUrls: string[], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (const url of dataUrls) {
    const m = pngMask(url);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(m.h - 1, Math.floor(((y + 0.5) * m.h) / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(m.w - 1, Math.floor(((x + 0.5) * m.w) / w));
        if (m.mask[sy * m.w + sx]) out[y * w + x] = 1;
      }
    }
  }
  return out;
}

// ---- Geometry ----------------------------------------------------------------------------------

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

interface Cloud {
  /** x, y, z per point (camera coordinates: x right, y down, z forward), metres. */
  pts: Float32Array;
  n: number;
  /** Pixels in the mask that had valid depth, and the pixels the sampled points stand for. */
  weight: number;
}

/** Back-projects masked pixels to 3D, sampling at most `max` points. */
function backProject(depth: Float32Array, mask: Uint8Array, w: number, h: number, f: number, max: number): Cloud {
  let total = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) total++;
  const step = Math.max(1, Math.floor(Math.sqrt(total / max)));
  const pts = new Float32Array(max * 3 * 2);
  let n = 0;
  let valid = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const z = depth[y * w + x];
      if (!Number.isFinite(z) || z < 0.3 || z > 300) continue;
      valid++;
      if (y % step || x % step || n >= max * 2) continue;
      pts[n * 3] = ((x + 0.5 - w / 2) * z) / f;
      pts[n * 3 + 1] = ((y + 0.5 - h / 2) * z) / f;
      pts[n * 3 + 2] = z;
      n++;
    }
  }
  return { pts, n, weight: valid / Math.max(1, n) };
}

function planeFromThree(pts: Float32Array, a: number, b: number, c: number): V3 | null {
  const p = (i: number): V3 => [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
  const A = p(a);
  const B = p(b);
  const C = p(c);
  const n = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
  return norm(n) < 1e-9 ? null : unit(n);
}

/** Least-squares plane through the listed points (normal and centroid). */
function fitPlane(pts: Float32Array, idx: number[]): { n: V3; c: V3 } | null {
  if (idx.length < 3) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of idx) {
    cx += pts[i * 3];
    cy += pts[i * 3 + 1];
    cz += pts[i * 3 + 2];
  }
  cx /= idx.length;
  cy /= idx.length;
  cz /= idx.length;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const i of idx) {
    const x = pts[i * 3] - cx;
    const y = pts[i * 3 + 1] - cy;
    const z = pts[i * 3 + 2] - cz;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  const dx = yy * zz - yz * yz;
  const dy = xx * zz - xz * xz;
  const dz = xx * yy - xy * xy;
  const best = Math.max(dx, dy, dz);
  if (best <= 1e-12) return null;
  let n: V3;
  if (best === dx) n = [dx, xz * yz - xy * zz, xy * yz - xz * yy];
  else if (best === dy) n = [xz * yz - xy * zz, dy, xy * xz - yz * xx];
  else n = [xy * yz - xz * yy, xy * xz - yz * xx, dz];
  return { n: unit(n), c: [cx, cy, cz] };
}

interface Plane {
  n: V3;
  c: V3;
  inliers: number[];
}

/** RANSAC: the plane with most points within `thr` metres, refitted on its inliers. */
function ransacPlane(pts: Float32Array, active: number[], thr: number, rounds = 250): Plane | null {
  if (active.length < 30) return null;
  let bestIn: number[] = [];
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let r = 0; r < rounds; r++) {
    const a = active[Math.floor(rnd() * active.length)];
    const b = active[Math.floor(rnd() * active.length)];
    const c = active[Math.floor(rnd() * active.length)];
    const n = planeFromThree(pts, a, b, c);
    if (!n) continue;
    const d = -(n[0] * pts[a * 3] + n[1] * pts[a * 3 + 1] + n[2] * pts[a * 3 + 2]);
    const inl: number[] = [];
    for (const i of active) {
      if (Math.abs(n[0] * pts[i * 3] + n[1] * pts[i * 3 + 1] + n[2] * pts[i * 3 + 2] + d) < thr) inl.push(i);
    }
    if (inl.length > bestIn.length) bestIn = inl;
  }
  const fit = fitPlane(pts, bestIn);
  if (!fit) return null;
  // Refit once on the points near the refined plane.
  const d = -dot(fit.n, fit.c);
  const inl = active.filter((i) => Math.abs(fit.n[0] * pts[i * 3] + fit.n[1] * pts[i * 3 + 1] + fit.n[2] * pts[i * 3 + 2] + d) < thr);
  const refit = fitPlane(pts, inl) ?? fit;
  return { n: refit.n, c: refit.c, inliers: inl };
}

const percentile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

/** Planes, pitch and sizes from depth, masks and focal length. Pure geometry, no network. */
export function measureGeometry(depth: Float32Array, w: number, h: number, f: number, roof: Uint8Array, wall: Uint8Array | null): Omit<Measurement, 'ms'> {
  const notes: string[] = [];
  const roofCloud = backProject(depth, roof, w, h, f, 6000);
  const count = (m: Uint8Array | null) => (m ? m.reduce((s, v) => s + (v ? 1 : 0), 0) : 0);
  const debug: Record<string, number | string> = {
    roofPixelShare: Math.round((count(roof) / (w * h)) * 1000) / 10 + ' %',
    wallPixelShare: wall ? Math.round((count(wall) / (w * h)) * 1000) / 10 + ' %' : 'no wall found',
    roofSamples: roofCloud.n,
  };
  if (roofCloud.n < 200) {
    return { planes: [], roofAreaM2: 0, focalPx: f, up: 'level', confidence: 'low', notes: ['Too little of the roof was found to measure.'], debug };
  }
  const zs = Array.from({ length: roofCloud.n }, (_, i) => roofCloud.pts[i * 3 + 2]).sort((a, b) => a - b);
  const thr = Math.max(0.05, 0.02 * zs[zs.length >> 1]);
  debug.roofDepthM = `${zs[Math.floor(zs.length * 0.05)].toFixed(1)} / ${zs[zs.length >> 1].toFixed(1)} / ${zs[Math.floor(zs.length * 0.95)].toFixed(1)} (5% / median / 95%)`;

  // Which way is up: the wall's plane is vertical, so it fixes the camera tilt (no roll assumed).
  let up: V3 = [0, -1, 0];
  let upSource: 'wall' | 'level' = 'level';
  if (wall) {
    const wallCloud = backProject(depth, wall, w, h, f, 4000);
    const plane = ransacPlane(wallCloud.pts, Array.from({ length: wallCloud.n }, (_, i) => i), thr);
    debug.wallInliers = plane ? Math.round((plane.inliers.length / wallCloud.n) * 100) + ' %' : 'no plane';
    if (plane && plane.inliers.length > wallCloud.n * 0.4) {
      const uy = plane.n[2];
      const uz = -plane.n[1];
      const len = Math.hypot(uy, uz);
      if (len > 0.5) {
        const sign = uy > 0 ? -1 : 1;
        const cand: V3 = [0, (sign * uy) / len, (sign * uz) / len];
        const tilt = (Math.atan2(cand[2], -cand[1]) * 180) / Math.PI;
        if (Math.abs(tilt) <= 45) {
          up = cand;
          upSource = 'wall';
          notes.push(`Camera tilt ${tilt.toFixed(0)}° worked out from the wall.`);
        }
      }
    }
  }
  if (upSource === 'level') notes.push('No usable wall found: the camera was assumed level, so pitch can be off by the real tilt.');

  const planes: PlaneResult[] = [];
  let active = Array.from({ length: roofCloud.n }, (_, i) => i);
  let covered = 0;
  for (let k = 0; k < 3; k++) {
    const plane = ransacPlane(roofCloud.pts, active, thr);
    if (!plane || plane.inliers.length < Math.max(60, roofCloud.n * 0.12)) break;
    const n: V3 = dot(plane.n, plane.c) > 0 ? [-plane.n[0], -plane.n[1], -plane.n[2]] : plane.n;
    const pitch = (Math.acos(Math.min(1, Math.abs(dot(n, up)))) * 180) / Math.PI;
    const inSet = new Set(plane.inliers);
    active = active.filter((i) => !inSet.has(i));
    covered += plane.inliers.length;
    if (pitch > 80) {
      notes.push('A near-vertical surface was found under the roof mask and left out.');
      continue;
    }
    const eaveDir = cross(up, n);
    if (norm(eaveDir) < 0.05) {
      // A (nearly) flat roof has no slope direction.
      continue;
    }
    const e = unit(eaveDir);
    const s = unit(cross(n, e));
    const A: number[] = [];
    const B: number[] = [];
    let area = 0;
    for (const i of plane.inliers) {
      const P: V3 = [roofCloud.pts[i * 3], roofCloud.pts[i * 3 + 1], roofCloud.pts[i * 3 + 2]];
      A.push(dot(P, e));
      B.push(dot(P, s));
      const d: V3 = [P[0] / P[2], P[1] / P[2], 1];
      area += (P[2] * P[2]) / (f * f * Math.max(0.15, Math.abs(dot(n, d))));
    }
    A.sort((a, b) => a - b);
    B.sort((a, b) => a - b);
    const eave = percentile(A, 0.99) - percentile(A, 0.01);
    const slope = percentile(B, 0.99) - percentile(B, 0.01);
    planes.push({
      pitchDeg: Math.round(pitch * 10) / 10,
      eaveM: Math.round(eave * 10) / 10,
      slopeM: Math.round(slope * 10) / 10,
      areaM2: Math.round(area * roofCloud.weight * 10) / 10,
      share: plane.inliers.length / roofCloud.n,
    });
  }
  const roofAreaM2 = Math.round(planes.reduce((s, p) => s + p.areaM2, 0) * 10) / 10;
  let confidence: 'ok' | 'low' = 'ok';
  if (!planes.length) {
    confidence = 'low';
    notes.push('No clear roof plane was found.');
  } else if (covered < roofCloud.n * 0.4) {
    confidence = 'low';
    notes.push('The roof surface was too uneven or too hidden to fit planes reliably.');
  }
  if (planes.some((p) => p.pitchDeg > 70 || p.eaveM > 60 || p.slopeM > 30)) {
    confidence = 'low';
    notes.push('A measured size was not plausible for a house roof.');
  }
  debug.planeCoverage = Math.round((covered / roofCloud.n) * 100) + ' % of roof samples';
  return { planes, roofAreaM2, focalPx: f, up: upSource, confidence, notes, debug };
}

// ---- The whole measurement ---------------------------------------------------------------------

/** Measures the roof in a photo. Throws on provider errors; returns confidence "low" when the photo can't be trusted. */
export async function measureRoof(settings: MeasurementSettings, seg: SegmentationSettings, image: string): Promise<Measurement> {
  const token = process.env[settings.keyEnv];
  if (!token) throw new Error(`${settings.keyEnv} is not set`);
  const started = Date.now();
  const [d, roofMasks, wallMasks] = await Promise.all([
    depthPro(token, image),
    segmentRoof(seg, image),
    segmentRoof({ ...seg, prompt: settings.wallPrompt || 'wall' }, image).catch(() => [] as string[]),
  ]);
  if (!roofMasks.length) throw new Error('SAM 3 found no roof in the photo');
  const size = imageSize(image);
  const f = size && size.width !== d.w ? (d.focalPx * d.w) / size.width : d.focalPx;
  const roof = unionMasks(roofMasks, d.w, d.h);
  const wall = wallMasks.length ? unionMasks(wallMasks, d.w, d.h) : null;
  const result = measureGeometry(d.depth, d.w, d.h, f, roof, wall);
  const debug = {
    ...result.debug,
    depthMap: `${d.w} × ${d.h}`,
    photo: size ? `${size.width} × ${size.height}` : 'unknown',
    focalFromDepthPro: Math.round(d.focalPx),
    focalUsed: Math.round(f),
  };
  return { ...result, debug, ms: Date.now() - started, colorMap: d.colorMap };
}

// ---- Cache by photo, so the measurement made while the visitor looks at the photo is there at Generate ----

const cache = new Map<string, { at: number; m: Measurement }>();
const TTL = 60 * 60 * 1000;

export function rememberMeasurement(photoId: string, m: Measurement) {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > TTL) cache.delete(k);
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  cache.set(photoId, { at: now, m });
}

export function recallMeasurement(photoId?: string): Measurement | undefined {
  const hit = photoId ? cache.get(photoId) : undefined;
  return hit && Date.now() - hit.at < TTL ? hit.m : undefined;
}

// ---- Text for the prompt -------------------------------------------------------------------------

/** First number (mm) in a spec whose label contains one of the words, e.g. "Cover width: 165 mm". */
function specMm(product: Product | undefined, words: string[]): number | undefined {
  for (const s of product?.specs ?? []) {
    const label = s.label.toLowerCase();
    if (!words.every((w) => label.includes(w))) continue;
    const v = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\b/i.exec(s.value);
    if (!v) continue;
    const num = Number(v[1].replace(',', '.'));
    const unit = (v[2] || 'mm').toLowerCase();
    return unit === 'm' ? num * 1000 : unit === 'cm' ? num * 10 : num;
  }
  return undefined;
}

/**
 * The measurement block added to the prompt, or '' when the measurement is missing or not reliable. Numbers are guides: the model
 * is told to follow the photo and the product photos where they disagree.
 */
export function measurementText(m: Measurement | undefined, product?: Product): string {
  if (!m || m.confidence !== 'ok' || !m.planes.length) return '';
  const cover = specMm(product, ['cover', 'width']);
  const gauge = specMm(product, ['batten', 'gauge']) ?? specMm(product, ['gauge']);
  const lines = m.planes.map((p, i) => {
    let line = `Roof plane ${i + 1}: pitch about ${Math.round(p.pitchDeg)}°, eave about ${p.eaveM.toFixed(1)} m, slope length about ${p.slopeM.toFixed(1)} m, area about ${Math.round(p.areaM2)} m²`;
    if (cover && gauge) {
      const per = Math.max(1, Math.round((p.eaveM * 1000) / cover));
      const courses = Math.max(1, Math.round((p.slopeM * 1000) / gauge));
      line += `. With this tile: about ${courses} courses of about ${per} tiles`;
    }
    return `- ${line}.`;
  });
  return [
    'ROOF MEASUREMENTS (estimated from the photo, about ±10–15%; a guide for the scale of the tiles only):',
    ...lines,
    'Use them only to judge how large the tiles are against the roof. Do not count tiles or force these numbers: the photo and the product photos decide the result.',
  ].join('\n');
}

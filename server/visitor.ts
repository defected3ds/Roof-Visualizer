/** Who made an API call: anonymised IP, rough place, device and visit (session), saved with each cost record. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { VisitorInfo } from '../src/types';

/** The request being handled, so recordUsage can find the visitor without every call site passing it. */
export const requestContext = new AsyncLocalStorage<Request>();

/** Cuts off the last part so the address no longer points at one person: 84.12.55.31 -> 84.12.55.x */
export function anonymiseIp(raw: string): string {
  const ip = raw.replace(/^::ffff:/i, '').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.x');
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::x';
  return '';
}

export function parseDevice(ua: string): string {
  if (!ua) return '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' ');
}

const geoCache = new Map<string, { country?: string; city?: string }>();

/** Country and city of the anonymised address (last part zeroed) from a free lookup service. Never throws. */
async function lookupPlace(ip: string): Promise<{ country?: string; city?: string }> {
  const target = ip.replace(/\.x$/, '.0').replace(/::x$/, '::');
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fe80)/.test(target)) return {};
  const hit = geoCache.get(target);
  if (hit) return hit;
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(target)}?fields=success,country_code,city`, { signal: AbortSignal.timeout(2500) });
    const j: any = await res.json();
    const place = j?.success ? { country: j.country_code || undefined, city: j.city || undefined } : {};
    if (geoCache.size > 2000) geoCache.clear();
    geoCache.set(target, place);
    return place;
  } catch {
    return {};
  }
}

/** Visitor details for the request being handled, or undefined outside a request. */
export async function currentVisitor(): Promise<VisitorInfo | undefined> {
  const req = requestContext.getStore();
  if (!req) return undefined;
  const ip = anonymiseIp(req.ip || req.socket?.remoteAddress || '');
  const session = (req.get('x-session') || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  const age = Number(req.get('x-session-age'));
  const cf = (req.get('cf-ipcountry') || '').toUpperCase();
  const place = ip ? await lookupPlace(ip) : {};
  return {
    ip: ip || undefined,
    country: place.country || (/^[A-Z]{2}$/.test(cf) && cf !== 'XX' ? cf : undefined),
    city: place.city,
    device: parseDevice(req.get('user-agent') || '') || undefined,
    session: session || undefined,
    sessionSeconds: Number.isFinite(age) && age >= 0 ? Math.round(age) : undefined,
  };
}

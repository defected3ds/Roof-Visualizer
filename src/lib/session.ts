/** One visit = one random id, renewed after 30 minutes without activity. Sent with every API call so the admin can group them. */
const IDLE_MS = 30 * 60 * 1000;
const KEY = 'rv.session';

interface Visit {
  id: string;
  start: number;
  last: number;
}

function visit(): Visit {
  const now = Date.now();
  let v: Visit | null = null;
  try {
    v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {
    /* storage blocked */
  }
  if (!v || now - v.last > IDLE_MS) v = { id: Math.random().toString(36).slice(2, 10) + now.toString(36).slice(-4), start: now, last: now };
  v.last = now;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
  return v;
}

/** Adds the visit headers to the app's own /api/ calls (not the admin's). */
export function installSessionHeaders() {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (url.startsWith('/api/') && !url.startsWith('/api/admin')) {
      const v = visit();
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('X-Session', v.id);
      headers.set('X-Session-Age', String(Math.round((Date.now() - v.start) / 1000)));
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
}

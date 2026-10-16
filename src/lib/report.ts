/**
 * Sends browser-side failures (depth map, roof mask) to the server log (Render > Logs), so problems on a
 * customer's device are visible. Never throws.
 */
export function reportProblem(kind: string, err: unknown) {
  try {
    const message = String((err as Error)?.message ?? err).slice(0, 300);
    void fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, message, agent: navigator.userAgent.slice(0, 200) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // reporting is best effort
  }
}

type SseWriter = (event: string, data: unknown) => Promise<void>;

const listeners = new Map<string, Set<SseWriter>>();

export function subscribeRunEvents(runId: string, writer: SseWriter) {
  let set = listeners.get(runId);
  if (!set) {
    set = new Set();
    listeners.set(runId, set);
  }
  set.add(writer);
  return () => {
    set!.delete(writer);
    if (set!.size === 0) listeners.delete(runId);
  };
}

export async function emitRunEvent(runId: string, event: string, data: unknown) {
  const set = listeners.get(runId);
  if (!set) return;
  await Promise.all([...set].map((w) => w(event, data)));
}

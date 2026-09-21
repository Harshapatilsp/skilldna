import type { Session, WorkflowEvent } from '../domain';
export interface Boundary {
  event: WorkflowEvent;
  workspace?: string;
  explicitStart?: boolean;
  taskBoundary?: boolean;
  override?: string;
}
export function segment(entries: Boundary[], idleMinutes = 30): Session[] {
  const sessions: Session[] = [];
  const active = new Map<string, { session: Session; timestamp: number; workspace?: string }>();
  for (const item of [...entries].sort((left, right) =>
    left.event.timestamp.localeCompare(right.event.timestamp),
  )) {
    const event = item.event;
    const key = `${event.source}:${item.override ?? event.sessionId}`;
    const previous = active.get(key);
    const time = Date.parse(event.timestamp);
    const reason = !previous
      ? item.override
        ? 'User override'
        : 'Source session boundary'
      : item.explicitStart
        ? 'Explicit session start'
        : item.workspace !== previous.workspace
          ? 'Workspace changed'
          : item.taskBoundary
            ? 'Task or debug boundary'
            : time - previous.timestamp > idleMinutes * 60_000
              ? 'Idle threshold exceeded'
              : '';
    let session = previous?.session;
    if (!session || reason) {
      session = {
        schemaVersion: 1,
        id: `${event.sessionId}-${sessions.length}`,
        source: event.source,
        events: [],
        reason,
        approved: false,
        synthetic: event.source === 'demo',
        createdAt: event.timestamp,
      };
      sessions.push(session);
    }
    const predecessorId = session.events.at(-1)?.id;
    session.events.push({
      ...event,
      sessionId: session.id,
      ...(predecessorId ? { predecessorId } : {}),
    });
    active.set(key, { session, timestamp: time, workspace: item.workspace });
  }
  return sessions;
}

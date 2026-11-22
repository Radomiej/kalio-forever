export class SessionIdentifyReplay {
  private readonly pending = new WeakMap<object, Map<string, Promise<void>>>();

  run(client: object, sessionId: string, replay: () => Promise<void>): Promise<void> {
    let sessions = this.pending.get(client);
    if (!sessions) {
      sessions = new Map();
      this.pending.set(client, sessions);
    }
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const current = sessions;
    const operation = Promise.resolve().then(replay).finally(() => current.delete(sessionId));
    current.set(sessionId, operation);
    return operation;
  }
}

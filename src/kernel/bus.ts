import type { EventMap, EventName } from "../types/events.js";

type Handler<T> = (payload: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();

  on<E extends EventName>(event: E, handler: Handler<EventMap[E]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as Handler<unknown>);

    return () => {
      this.handlers.get(event)?.delete(handler as Handler<unknown>);
    };
  }

  async emit<E extends EventName>(event: E, payload: EventMap[E]): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    const promises: Promise<void>[] = [];
    for (const handler of handlers) {
      const result = handler(payload);
      if (result instanceof Promise) {
        promises.push(result);
      }
    }
    await Promise.all(promises);
  }

  off<E extends EventName>(event: E, handler: Handler<EventMap[E]>): void {
    this.handlers.get(event)?.delete(handler as Handler<unknown>);
  }

  removeAllListeners(event?: EventName): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

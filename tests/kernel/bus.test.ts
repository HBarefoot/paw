import { describe, test, expect } from "bun:test";
import { EventBus } from "../../src/kernel/bus.js";

describe("EventBus", () => {
  test("emits and receives events", async () => {
    const bus = new EventBus();
    let received: unknown = null;

    bus.on("kernel:ready", (payload) => {
      received = payload;
    });

    await bus.emit("kernel:ready", undefined);
    expect(received).toBeUndefined();
  });

  test("supports multiple handlers", async () => {
    const bus = new EventBus();
    const calls: number[] = [];

    bus.on("plugin:started", () => calls.push(1));
    bus.on("plugin:started", () => calls.push(2));

    await bus.emit("plugin:started", { name: "test" });
    expect(calls).toEqual([1, 2]);
  });

  test("unsubscribe removes handler", async () => {
    const bus = new EventBus();
    let count = 0;

    const unsub = bus.on("kernel:ready", () => {
      count++;
    });

    await bus.emit("kernel:ready", undefined);
    expect(count).toBe(1);

    unsub();
    await bus.emit("kernel:ready", undefined);
    expect(count).toBe(1);
  });

  test("removeAllListeners clears specific event", async () => {
    const bus = new EventBus();
    let a = 0;
    let b = 0;

    bus.on("kernel:ready", () => { a++; });
    bus.on("kernel:shutdown", () => { b++; });

    bus.removeAllListeners("kernel:ready");

    await bus.emit("kernel:ready", undefined);
    await bus.emit("kernel:shutdown", undefined);

    expect(a).toBe(0);
    expect(b).toBe(1);
  });

  test("removeAllListeners with no arg clears everything", async () => {
    const bus = new EventBus();
    let count = 0;

    bus.on("kernel:ready", () => { count++; });
    bus.on("kernel:shutdown", () => { count++; });

    bus.removeAllListeners();

    await bus.emit("kernel:ready", undefined);
    await bus.emit("kernel:shutdown", undefined);

    expect(count).toBe(0);
  });

  test("async handlers are awaited", async () => {
    const bus = new EventBus();
    const order: number[] = [];

    bus.on("plugin:started", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });

    await bus.emit("plugin:started", { name: "test" });
    order.push(2);

    expect(order).toEqual([1, 2]);
  });
});

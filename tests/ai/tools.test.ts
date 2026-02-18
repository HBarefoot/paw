import { describe, test, expect } from "bun:test";
import { ToolRegistry } from "../../src/ai/tools.js";

describe("ToolRegistry", () => {
  test("registers and retrieves tools", () => {
    const registry = new ToolRegistry();
    registry.register([
      {
        name: "test_tool",
        description: "A test tool",
        input_schema: { type: "object", properties: {} },
        plugin: "test",
        handler: async () => ({ content: "ok" }),
      },
    ]);

    expect(registry.size).toBe(1);
    expect(registry.get("test_tool")).toBeDefined();
    expect(registry.get("test_tool")!.name).toBe("test_tool");
  });

  test("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    const tool = {
      name: "dupe",
      description: "A tool",
      input_schema: { type: "object" },
      plugin: "test",
      handler: async () => ({ content: "ok" }),
    };

    registry.register([tool]);
    expect(() => registry.register([tool])).toThrow('Tool "dupe" is already registered');
  });

  test("executes tool handler", async () => {
    const registry = new ToolRegistry();
    registry.register([
      {
        name: "greet",
        description: "Greet",
        input_schema: { type: "object", properties: { name: { type: "string" } } },
        plugin: "test",
        handler: async (input) => ({ content: `Hello ${input.name}` }),
      },
    ]);

    const result = await registry.execute("greet", { name: "World" });
    expect(result.content).toBe("Hello World");
    expect(result.is_error).toBeUndefined();
  });

  test("returns error for unknown tool", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("nope", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });

  test("catches handler errors", async () => {
    const registry = new ToolRegistry();
    registry.register([
      {
        name: "fail",
        description: "Fails",
        input_schema: { type: "object" },
        plugin: "test",
        handler: async () => {
          throw new Error("boom");
        },
      },
    ]);

    const result = await registry.execute("fail", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("boom");
  });

  test("unregisters plugin tools", () => {
    const registry = new ToolRegistry();
    registry.register([
      { name: "a", description: "", input_schema: {}, plugin: "p1", handler: async () => ({ content: "" }) },
      { name: "b", description: "", input_schema: {}, plugin: "p1", handler: async () => ({ content: "" }) },
      { name: "c", description: "", input_schema: {}, plugin: "p2", handler: async () => ({ content: "" }) },
    ]);

    expect(registry.size).toBe(3);
    registry.unregisterPlugin("p1");
    expect(registry.size).toBe(1);
    expect(registry.get("c")).toBeDefined();
  });

  test("toAnthropicTools returns correct format", () => {
    const registry = new ToolRegistry();
    registry.register([
      {
        name: "tool1",
        description: "Test tool",
        input_schema: { type: "object", properties: { x: { type: "number" } } },
        plugin: "test",
        handler: async () => ({ content: "ok" }),
      },
    ]);

    const tools = registry.toAnthropicTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      name: "tool1",
      description: "Test tool",
      input_schema: { type: "object", properties: { x: { type: "number" } } },
    });
    // Should not include handler or plugin
    expect("handler" in tools[0]).toBe(false);
    expect("plugin" in tools[0]).toBe(false);
  });
});

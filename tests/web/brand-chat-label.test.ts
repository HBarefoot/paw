import { describe, expect, test } from "bun:test";
import { getBrandUi } from "../../src/store/brands.js";
import type { Brand } from "../../src/store/brands.js";
import { ChatPage } from "../../src/web/views/chat.js";
import { brandIdentityScript } from "../../src/web/views/layout.js";

function brand(chatLabel?: string): Brand {
	return {
		id: "b1",
		name: "Acme",
		slug: "acme",
		active: true,
		data: { colors: {}, fonts: {}, logos: {}, chatLabel },
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
	};
}

describe("brand chatLabel — identity payload", () => {
	test("getBrandUi surfaces a set chatLabel", () => {
		expect(getBrandUi(brand("Command AI"))?.chatLabel).toBe("Command AI");
	});

	test("getBrandUi omits chatLabel when unset (→ client defaults to Chat)", () => {
		expect(getBrandUi(brand())?.chatLabel).toBeUndefined();
	});

	test("getBrandUi omits a blank/whitespace chatLabel", () => {
		expect(getBrandUi(brand("   "))?.chatLabel).toBeUndefined();
	});

	test("getBrandUi(null) → null (no active brand)", () => {
		expect(getBrandUi(null)).toBeNull();
	});
});

describe("brand chatLabel — client identity script", () => {
	const script = brandIdentityScript();

	test("cooked script parses (no SyntaxError from the template trap)", () => {
		expect(() => new Function(script)).not.toThrow();
	});

	test("applies chatLabel to data-brand-chat-label nodes, default Chat", () => {
		expect(script).toContain("data-brand-chat-label");
		expect(script).toContain('(b&&b.chatLabel)||"Chat"');
	});
});

describe("brand chatLabel — chat page render", () => {
	test("page title renders the brand chatLabel when provided", () => {
		const html = String(ChatPage({ sessionId: "s1", chatLabel: "Command AI" }));
		expect(html).toContain("<title>Command AI - Paw</title>");
	});

	// Regression guard: a brandless/default install MUST render "Chat".
	test("page title falls back to Chat with no chatLabel", () => {
		const html = String(ChatPage({ sessionId: "s1" }));
		expect(html).toContain("<title>Chat - Paw</title>");
	});

	test("sidebar nav exposes the data-brand-chat-label hook, default text Chat", () => {
		const html = String(ChatPage({ sessionId: "s1" }));
		expect(html).toContain("data-brand-chat-label");
		expect(html).toMatch(/data-brand-chat-label[^>]*>Chat</);
	});
});

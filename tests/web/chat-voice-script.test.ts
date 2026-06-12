import { describe, expect, test } from "bun:test";
import { getChatScript } from "../../src/web/views/chat.js";

// The voice wiring (STT/TTS) was added inside the chat client template literal.
// A literal backtick (e.g. a code-fence string) would prematurely close that
// template and ship a broken script, so the fence is built via
// String.fromCharCode(96). Compiling the cooked script catches that whole class.
describe("chat voice script", () => {
	const script = getChatScript();

	test("cooked script parses (no template/backtick breakage)", () => {
		expect(() => new Function(script)).not.toThrow();
	});

	test("STT + TTS wiring is present and backtick-safe", () => {
		expect(script).toContain("pawToggleDictation");
		expect(script).toContain("pawToggleSpeak");
		expect(script).toContain("pawSpeakReply");
		expect(script).toContain("SpeechRecognition");
		expect(script).toContain("SpeechSynthesisUtterance");
		// The code-fence is built without a literal backtick (the template trap).
		expect(script).toContain("String.fromCharCode(96)");
	});
});

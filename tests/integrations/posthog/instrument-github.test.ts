import { describe, expect, test } from "bun:test";
import type { GitHubClient } from "../../../src/integrations/github/client.js";
import { createGitHubTools } from "../../../src/integrations/github/tools.js";
import type { CommitFileInput } from "../../../src/integrations/github/types.js";
import { injectPostHogSnippet } from "../../../src/integrations/posthog/snippet.js";
import type { ToolResult } from "../../../src/types/message.js";

const KEY = "phc_PUBLIC_project_key";
const HOST = "https://us.i.posthog.com";

/** Minimal GitHubClient stand-in: records exactly the files commitFiles got. */
function fakeClient(): {
	client: GitHubClient;
	committed: () => CommitFileInput[];
} {
	let seen: CommitFileInput[] = [];
	const client = {
		async commitFiles(
			_repo: string,
			_branch: string,
			files: CommitFileInput[],
		) {
			seen = files;
			return {
				commitSha: "abc",
				url: "https://github.com/owner/repo/commit/abc",
			};
		},
	} as unknown as GitHubClient;
	return { client, committed: () => seen };
}

const transform = (path: string, content: string) =>
	path.toLowerCase().endsWith(".html")
		? injectPostHogSnippet(content, { projectApiKey: KEY, host: HOST })
		: content;

async function commit(
	tools: ReturnType<typeof createGitHubTools>,
	files: CommitFileInput[],
) {
	const tool = tools.find((t) => t.name === "github_commit_files");
	return (await tool?.handler({
		repo: "owner/repo",
		branch: "feature",
		message: "publish",
		files,
	})) as ToolResult;
}

describe("github_commit_files publish-time PostHog injection", () => {
	test("injects the snippet into committed HTML when the transform is wired", async () => {
		const { client, committed } = fakeClient();
		const tools = createGitHubTools(client, {
			htmlPublishTransform: transform,
		});
		await commit(tools, [
			{
				path: "index.html",
				content: "<html><head></head><body>hi</body></html>",
			},
			{ path: "styles.css", content: "body{color:red}" },
		]);
		const files = committed();
		const html = files.find((f) => f.path === "index.html");
		const css = files.find((f) => f.path === "styles.css");
		expect(html?.content).toContain(`posthog.init("${KEY}"`);
		// non-HTML is left untouched
		expect(css?.content).toBe("body{color:red}");
	});

	test("without the transform, HTML is committed verbatim (disabled = no snippet)", async () => {
		const { client, committed } = fakeClient();
		const tools = createGitHubTools(client); // no htmlPublishTransform
		const original = "<html><head></head><body>hi</body></html>";
		await commit(tools, [{ path: "index.html", content: original }]);
		expect(committed()[0].content).toBe(original);
		expect(committed()[0].content).not.toContain("posthog.init");
	});

	test("base64/binary files are never passed through the transform", async () => {
		const { client, committed } = fakeClient();
		const tools = createGitHubTools(client, {
			htmlPublishTransform: transform,
		});
		// a .html name but base64-encoded → must be left byte-intact
		const b64 = Buffer.from("<html><head></head></html>").toString("base64");
		await commit(tools, [
			{ path: "weird.html", content: b64, encoding: "base64" },
		]);
		expect(committed()[0].content).toBe(b64);
		expect(committed()[0].content).not.toContain("posthog.init");
	});
});

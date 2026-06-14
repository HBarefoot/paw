import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type Browser,
	type BrowserContext,
	type Page,
	chromium,
} from "playwright";
import type { ChannelPlugin, PluginContext } from "../../src/types/plugin.js";
import {
	type ConsoleEntry,
	type NetworkEntry,
	type WebPilotDeps,
	createWebPilotTools,
} from "./tools.js";

const BUFFER_CAP = 200;

interface Recording {
	context: BrowserContext;
	dir: string;
	startedAt: number;
	timer: ReturnType<typeof setTimeout> | null;
}

export default class WebPilotPlugin implements ChannelPlugin {
	readonly name = "web-pilot";
	private browser: Browser | null = null;
	private pages = new Map<string, Page>();
	private consoleBuf = new Map<string, ConsoleEntry[]>();
	private networkBuf = new Map<string, NetworkEntry[]>();
	private recordings = new Map<string, Recording>();
	private ctx: PluginContext | null = null;
	private headless = true;
	private maxPages = 3;
	private defaultTimeout = 30_000;
	// QA additions (all config-driven so secrets never reach the model):
	private recordingDir = resolve(process.cwd(), "data/recordings");
	private maxRecordingMs = 60_000;
	private maxRecordingBytes = 50 * 1024 * 1024;
	private pawBaseUrl = "";
	private pawSessionToken = "";

	async register(ctx: PluginContext): Promise<void> {
		this.ctx = ctx;
		const config = ctx.config as Record<string, unknown>;
		this.headless = (config.headless as boolean) ?? true;
		this.maxPages = (config.maxPages as number) ?? 3;
		this.defaultTimeout = (config.defaultTimeout as number) ?? 30_000;
		if (typeof config.recordingDir === "string" && config.recordingDir) {
			this.recordingDir = resolve(config.recordingDir);
		}
		if (typeof config.maxRecordingMs === "number")
			this.maxRecordingMs = config.maxRecordingMs;
		if (typeof config.maxRecordingBytes === "number")
			this.maxRecordingBytes = config.maxRecordingBytes;
		// Owner-supplied paw host + session token: the ONLY way the headless
		// browser can load an auth-gated paw page. Both come from plugin config
		// (vault/config), never from the model's tool input — so a model can ask
		// to "test my app page" without ever seeing or choosing a credential.
		this.pawBaseUrl =
			typeof config.pawBaseUrl === "string" ? config.pawBaseUrl : "";
		this.pawSessionToken =
			typeof config.pawSessionToken === "string" ? config.pawSessionToken : "";

		const deps: WebPilotDeps = {
			getPage: (sessionId) => this.getPage(sessionId),
			readConsole: (sessionId, level) => this.readConsole(sessionId, level),
			readNetwork: (sessionId, onlyFailures) =>
				this.readNetwork(sessionId, onlyFailures),
			startRecording: (sessionId, url) => this.startRecording(sessionId, url),
			stopRecording: (sessionId) => this.stopRecording(sessionId),
			attachPawSession: (sessionId) => this.attachPawSession(sessionId),
		};
		ctx.registerTools(createWebPilotTools(deps));
	}

	private async ensureBrowser(): Promise<Browser> {
		if (!this.browser) {
			this.browser = await chromium.launch({ headless: this.headless });
		}
		return this.browser;
	}

	/** Attach console + network listeners to a page, buffered per session key. */
	private instrument(page: Page, key: string): void {
		this.consoleBuf.set(key, []);
		this.networkBuf.set(key, []);
		const pushC = (e: ConsoleEntry) => {
			const buf = this.consoleBuf.get(key);
			if (!buf) return;
			buf.push(e);
			if (buf.length > BUFFER_CAP) buf.shift();
		};
		const pushN = (e: NetworkEntry) => {
			const buf = this.networkBuf.get(key);
			if (!buf) return;
			buf.push(e);
			if (buf.length > BUFFER_CAP) buf.shift();
		};
		page.on("console", (msg) =>
			pushC({ level: msg.type(), text: msg.text(), ts: Date.now() }),
		);
		page.on("pageerror", (err) =>
			pushC({
				level: "error",
				text: String(err?.message ?? err),
				ts: Date.now(),
			}),
		);
		page.on("requestfailed", (req) =>
			pushN({
				url: req.url(),
				method: req.method(),
				status: 0,
				failure: req.failure()?.errorText ?? "failed",
				ts: Date.now(),
			}),
		);
		page.on("response", (res) => {
			const status = res.status();
			if (status >= 400)
				pushN({
					url: res.url(),
					method: res.request().method(),
					status,
					ts: Date.now(),
				});
		});
	}

	private async getPage(sessionId?: string): Promise<Page> {
		const browser = await this.ensureBrowser();
		const key = sessionId ?? "default";

		const existing = this.pages.get(key);
		if (existing && !existing.isClosed()) return existing;

		if (this.pages.size >= this.maxPages) {
			const oldest = this.pages.keys().next().value as string | undefined;
			if (oldest !== undefined) {
				const oldPage = this.pages.get(oldest);
				if (oldPage && !oldPage.isClosed()) await oldPage.close();
				this.pages.delete(oldest);
				this.consoleBuf.delete(oldest);
				this.networkBuf.delete(oldest);
			}
		}

		const page = await browser.newPage();
		page.setDefaultTimeout(this.defaultTimeout);
		this.instrument(page, key);
		this.pages.set(key, page);
		return page;
	}

	private readConsole(sessionId?: string, level?: string): ConsoleEntry[] {
		const buf = this.consoleBuf.get(sessionId ?? "default") ?? [];
		return level ? buf.filter((e) => e.level === level) : buf.slice();
	}

	private readNetwork(
		sessionId?: string,
		onlyFailures?: boolean,
	): NetworkEntry[] {
		const buf = this.networkBuf.get(sessionId ?? "default") ?? [];
		return onlyFailures
			? buf.filter((e) => e.status === 0 || e.status >= 400)
			: buf.slice();
	}

	private async startRecording(
		sessionId: string | undefined,
		url?: string,
	): Promise<{ dir: string } | { error: string }> {
		const key = sessionId ?? "default";
		if (this.recordings.has(key))
			return { error: "Already recording for this session; stop first." };
		const browser = await this.ensureBrowser();
		const dir = join(this.recordingDir, `${key}-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const context = await browser.newContext({ recordVideo: { dir } });
		const page = await context.newPage();
		page.setDefaultTimeout(this.defaultTimeout);
		this.instrument(page, key);
		this.pages.set(key, page);
		// Hard duration cap: auto-stop so a runaway recording can't grow unbounded.
		const timer = setTimeout(() => {
			void this.stopRecording(key);
		}, this.maxRecordingMs);
		this.recordings.set(key, { context, dir, startedAt: Date.now(), timer });
		if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
		return { dir };
	}

	private async stopRecording(
		sessionId?: string,
	): Promise<
		| { path: string; bytes: number; durationMs: number; overCap: boolean }
		| { error: string }
	> {
		const key = sessionId ?? "default";
		const rec = this.recordings.get(key);
		if (!rec) return { error: "Not recording for this session." };
		if (rec.timer) clearTimeout(rec.timer);
		this.recordings.delete(key);
		const page = this.pages.get(key);
		const video = page?.video() ?? null;
		// Closing the context flushes the video file to disk.
		await rec.context.close();
		this.pages.delete(key);
		this.consoleBuf.delete(key);
		this.networkBuf.delete(key);
		const durationMs = Date.now() - rec.startedAt;
		if (!video) return { path: rec.dir, bytes: 0, durationMs, overCap: false };
		const path = await video.path();
		let bytes = 0;
		try {
			bytes = statSync(path).size;
		} catch {
			bytes = 0;
		}
		return { path, bytes, durationMs, overCap: bytes > this.maxRecordingBytes };
	}

	private async attachPawSession(
		sessionId?: string,
	): Promise<{ host: string } | { error: string }> {
		if (!this.pawBaseUrl || !this.pawSessionToken) {
			return {
				error:
					"No owner paw session configured. Set web-pilot config pawBaseUrl + " +
					"pawSessionToken (owner-supplied) to test auth-gated paw pages.",
			};
		}
		const page = await this.getPage(sessionId);
		// Host-scoped, single cookie name only: this is NOT a general credential
		// injector. It attaches the owner's own paw_session for the owner's own
		// paw host so the headless browser can load /api/app/* etc.
		await page.context().addCookies([
			{
				name: "paw_session",
				value: this.pawSessionToken,
				url: this.pawBaseUrl,
			},
		]);
		return { host: this.pawBaseUrl };
	}

	async start(): Promise<void> {
		this.ctx?.logger.info(
			"WebPilot plugin ready (browser will launch on first use)",
		);
	}

	async stop(): Promise<void> {
		for (const [, rec] of this.recordings) {
			if (rec.timer) clearTimeout(rec.timer);
			try {
				await rec.context.close();
			} catch {
				// best effort
			}
		}
		this.recordings.clear();
		for (const [, page] of this.pages) {
			if (!page.isClosed()) await page.close();
		}
		this.pages.clear();
		this.consoleBuf.clear();
		this.networkBuf.clear();
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
		}
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		return {
			ok: true,
			details: `Browser: ${this.browser ? "running" : "idle"}, Pages: ${this.pages.size}/${this.maxPages}, Recording: ${this.recordings.size}`,
		};
	}
}

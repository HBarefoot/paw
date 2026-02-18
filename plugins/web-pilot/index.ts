import { chromium, type Browser, type Page } from "playwright";
import type { ChannelPlugin, PluginContext } from "../../src/types/plugin.js";
import { createWebPilotTools } from "./tools.js";

export default class WebPilotPlugin implements ChannelPlugin {
  readonly name = "web-pilot";
  private browser: Browser | null = null;
  private pages = new Map<string, Page>();
  private ctx: PluginContext | null = null;
  private headless = true;
  private maxPages = 3;
  private defaultTimeout = 30_000;

  async register(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    const config = ctx.config as Record<string, unknown>;
    this.headless = (config.headless as boolean) ?? true;
    this.maxPages = (config.maxPages as number) ?? 3;
    this.defaultTimeout = (config.defaultTimeout as number) ?? 30_000;

    ctx.registerTools(createWebPilotTools((sessionId) => this.getPage(sessionId)));
  }

  private async getPage(sessionId?: string): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: this.headless });
    }

    const key = sessionId ?? "default";

    const existing = this.pages.get(key);
    if (existing && !existing.isClosed()) {
      return existing;
    }

    // Evict oldest pages if at capacity
    if (this.pages.size >= this.maxPages) {
      const oldest = this.pages.keys().next().value!;
      const oldPage = this.pages.get(oldest);
      if (oldPage && !oldPage.isClosed()) {
        await oldPage.close();
      }
      this.pages.delete(oldest);
    }

    const page = await this.browser.newPage();
    page.setDefaultTimeout(this.defaultTimeout);
    this.pages.set(key, page);
    return page;
  }

  async start(): Promise<void> {
    // Browser is lazily initialized on first tool call
    this.ctx?.logger.info("WebPilot plugin ready (browser will launch on first use)");
  }

  async stop(): Promise<void> {
    for (const [, page] of this.pages) {
      if (!page.isClosed()) await page.close();
    }
    this.pages.clear();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async health(): Promise<{ ok: boolean; details?: string }> {
    return {
      ok: true,
      details: `Browser: ${this.browser ? "running" : "idle"}, Pages: ${this.pages.size}/${this.maxPages}`,
    };
  }
}

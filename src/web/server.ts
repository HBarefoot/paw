import type { Hono } from "hono";
import type { Logger } from "../types/plugin.js";

export interface WebServerConfig {
  host: string;
  port: number;
}

export function startWebServer(
  app: Hono,
  config: WebServerConfig,
  logger: Logger,
): { stop: () => void } {
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: app.fetch,
  });

  logger.info("Web server started", { host: config.host, port: config.port });

  return {
    stop: () => {
      server.stop(true);
      logger.info("Web server stopped");
    },
  };
}

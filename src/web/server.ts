import type { Hono } from "hono";
import type { Logger } from "../types/plugin.js";

export interface WebServerConfig {
	host: string;
	port: number;
}

export interface TlsConfig {
	enabled: boolean;
	certFile: string;
	keyFile: string;
}

export function startWebServer(
	app: Hono,
	config: WebServerConfig,
	logger: Logger,
	tlsConfig?: TlsConfig,
): { stop: () => void } {
	const serveOptions: Record<string, unknown> = {
		hostname: config.host,
		port: config.port,
		fetch: app.fetch,
	};

	if (tlsConfig?.enabled && tlsConfig.certFile && tlsConfig.keyFile) {
		serveOptions.tls = {
			cert: Bun.file(tlsConfig.certFile),
			key: Bun.file(tlsConfig.keyFile),
		};
		logger.info("TLS enabled", { certFile: tlsConfig.certFile });
	}

	const server = Bun.serve(serveOptions as any);

	const protocol = serveOptions.tls ? "https" : "http";
	logger.info("Web server started", {
		host: config.host,
		port: config.port,
		protocol,
	});

	return {
		stop: () => {
			server.stop(true);
			logger.info("Web server stopped");
		},
	};
}

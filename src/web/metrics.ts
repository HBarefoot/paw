/**
 * Minimal REAL process/runtime metrics for the Heartbeat console — no mock
 * data. Everything here is measured from the live process (memory, uptime,
 * event-loop lag, CPU, a timed DB ping) or a rolling in-process request
 * counter. Anything the runtime can't truthfully measure is simply not
 * reported.
 */
import type { Database } from "bun:sqlite";
import { cpus, totalmem } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

// Event-loop delay histogram. Read .mean (ns) then reset, so each poll reports
// the lag observed since the previous poll rather than a lifetime average.
const eld = monitorEventLoopDelay({ resolution: 20 });
eld.enable();

// Rolling 60s request timestamps for a real req/s rate. recordRequest() is
// called from the web middleware on every request.
const reqTimes: number[] = [];

export function recordRequest(): void {
	reqTimes.push(Date.now());
	// Bound memory if the trimmer hasn't run (very high burst).
	if (reqTimes.length > 20000) reqTimes.splice(0, reqTimes.length - 20000);
}

function reqPerSec(): number {
	const cutoff = Date.now() - 60_000;
	while (reqTimes.length > 0 && reqTimes[0] < cutoff) reqTimes.shift();
	return reqTimes.length / 60;
}

// CPU% normalized across cores, sampled between reads from process.cpuUsage().
let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();
let lastCpuPct = 0;

function cpuPercent(): number {
	const now = Date.now();
	const elapsedMs = now - lastCpuAt;
	if (elapsedMs >= 250) {
		const u = process.cpuUsage(lastCpu);
		lastCpu = process.cpuUsage();
		lastCpuAt = now;
		const micros = u.user + u.system;
		const cores = Math.max(1, cpus().length);
		lastCpuPct = Math.min(100, ((micros / 1000 / elapsedMs) * 100) / cores);
	}
	return lastCpuPct;
}

export interface MetricsSnapshot {
	cpu: number; // % across all cores
	memRssMb: number; // resident set size
	memTotalMb: number; // machine total memory
	eventLoopLagMs: number;
	dbLatencyMs: number;
	reqPerSec: number;
	uptimeSec: number;
}

export function metricsSnapshot(db?: Database | null): MetricsSnapshot {
	let dbLatencyMs = 0;
	if (db) {
		const t0 = performance.now();
		try {
			db.prepare("SELECT 1").get();
		} catch {
			// leave at 0 — a failed ping shows as a service-health failure elsewhere
		}
		dbLatencyMs = Math.round((performance.now() - t0) * 100) / 100;
	}
	const mem = process.memoryUsage();
	const lagMs = Math.round((eld.mean / 1e6) * 10) / 10;
	eld.reset();
	return {
		cpu: Math.round(cpuPercent()),
		memRssMb: Math.round(mem.rss / 1_048_576),
		memTotalMb: Math.round(totalmem() / 1_048_576),
		eventLoopLagMs: Number.isFinite(lagMs) ? lagMs : 0,
		dbLatencyMs,
		reqPerSec: Math.round(reqPerSec() * 10) / 10,
		uptimeSec: Math.round(process.uptime()),
	};
}

export function formatUptime(sec: number): string {
	const d = Math.floor(sec / 86400);
	const h = Math.floor((sec % 86400) / 3600);
	const m = Math.floor((sec % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

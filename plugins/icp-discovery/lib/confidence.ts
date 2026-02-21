import type { RevenueSource } from "../types";

type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export function scoreConfidence(sources: RevenueSource[]): ConfidenceLevel {
	const hasSecEdgar = sources.some((s) => s.type === "sec_edgar");
	const hasFdd = sources.some((s) => s.type === "fdd");
	const hasPressRelease = sources.some((s) => s.type === "press_release");
	const hasEmployeeProxy = sources.some((s) => s.type === "employee_proxy");

	let level: ConfidenceLevel;

	if (hasSecEdgar) {
		level = "HIGH";
	} else if (hasFdd || hasPressRelease) {
		level = "MEDIUM";
	} else if (hasEmployeeProxy) {
		level = "LOW";
	} else {
		level = "LOW";
	}

	// Bump up if 2+ sources agree within 20%
	if (level !== "HIGH") {
		const numericValues = sources
			.map((s) =>
				typeof s.value === "number"
					? s.value
					: Number.parseFloat(String(s.value)),
			)
			.filter((v) => !Number.isNaN(v) && v > 0);

		if (numericValues.length >= 2) {
			const agreeing = countAgreingSources(numericValues, 0.2);
			if (agreeing >= 2) {
				level = level === "LOW" ? "MEDIUM" : "HIGH";
			}
		}
	}

	return level;
}

function countAgreingSources(values: number[], threshold: number): number {
	let maxAgreeing = 0;
	for (let i = 0; i < values.length; i++) {
		let count = 1;
		for (let j = i + 1; j < values.length; j++) {
			const ratio =
				Math.abs(values[i] - values[j]) / Math.max(values[i], values[j]);
			if (ratio <= threshold) {
				count++;
			}
		}
		maxAgreeing = Math.max(maxAgreeing, count);
	}
	return maxAgreeing;
}

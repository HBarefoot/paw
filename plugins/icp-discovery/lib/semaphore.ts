/**
 * Simple counting semaphore for limiting concurrency.
 * Use `concurrency: 1` to serialize access to a rate-limited resource.
 */
export class Semaphore {
	private queue: (() => void)[] = [];
	private running = 0;

	constructor(private concurrency: number) {}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}

	private acquire(): Promise<void> {
		if (this.running < this.concurrency) {
			this.running++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	private release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.running--;
		}
	}
}

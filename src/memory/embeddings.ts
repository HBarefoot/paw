let pipelineInstance: any = null;
let initPromise: Promise<void> | null = null;

const EMBEDDING_DIM = 384;

/** Simple LRU cache for embedding results */
const CACHE_MAX = 50;
const embeddingCache = new Map<string, Float32Array>();

function cacheGet(key: string): Float32Array | undefined {
	const val = embeddingCache.get(key);
	if (val) {
		// Move to end (most recently used)
		embeddingCache.delete(key);
		embeddingCache.set(key, val);
	}
	return val;
}

function cacheSet(key: string, val: Float32Array): void {
	if (embeddingCache.size >= CACHE_MAX) {
		// Evict oldest entry (first key)
		const first = embeddingCache.keys().next().value;
		if (first !== undefined) embeddingCache.delete(first);
	}
	embeddingCache.set(key, val);
}

async function init(model: string): Promise<void> {
	if (pipelineInstance) return;
	const { pipeline } = await import("@huggingface/transformers");
	pipelineInstance = await pipeline("feature-extraction", model);
}

/**
 * Preload the embedding pipeline without waiting for a user query. Safe to
 * call during boot when memory is enabled, so the first recall doesn't pay
 * model-download + compile latency on the request path.
 */
export async function preloadEmbedder(
	model = "Xenova/all-MiniLM-L6-v2",
): Promise<void> {
	if (!initPromise) {
		initPromise = init(model);
	}
	await initPromise;
}

export function embeddingDimension(): number {
	return EMBEDDING_DIM;
}

export async function getEmbedding(
	text: string,
	model = "Xenova/all-MiniLM-L6-v2",
): Promise<Float32Array> {
	const cacheKey = `${model}:${text}`;
	const cached = cacheGet(cacheKey);
	if (cached) return cached;

	if (!initPromise) {
		initPromise = init(model);
	}
	await initPromise;
	const output = await pipelineInstance(text, {
		pooling: "mean",
		normalize: true,
	});
	const nested = output.tolist();
	const result = new Float32Array(nested[0]);
	cacheSet(cacheKey, result);
	return result;
}

export async function getEmbeddings(
	texts: string[],
	model = "Xenova/all-MiniLM-L6-v2",
): Promise<Float32Array[]> {
	if (!initPromise) {
		initPromise = init(model);
	}
	await initPromise;
	const output = await pipelineInstance(texts, {
		pooling: "mean",
		normalize: true,
	});
	const nested = output.tolist();
	const results = nested.map((row: number[]) => new Float32Array(row));
	// Cache each result
	for (let i = 0; i < texts.length; i++) {
		cacheSet(`${model}:${texts[i]}`, results[i]);
	}
	return results;
}

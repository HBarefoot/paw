let pipelineInstance: any = null;
let initPromise: Promise<void> | null = null;

const EMBEDDING_DIM = 384;

async function init(model: string): Promise<void> {
  if (pipelineInstance) return;
  const { pipeline } = await import("@huggingface/transformers");
  pipelineInstance = await pipeline("feature-extraction", model);
}

export function embeddingDimension(): number {
  return EMBEDDING_DIM;
}

export async function getEmbedding(text: string, model = "Xenova/all-MiniLM-L6-v2"): Promise<Float32Array> {
  if (!initPromise) {
    initPromise = init(model);
  }
  await initPromise;
  const output = await pipelineInstance(text, { pooling: "mean", normalize: true });
  const nested = output.tolist();
  return new Float32Array(nested[0]);
}

export async function getEmbeddings(texts: string[], model = "Xenova/all-MiniLM-L6-v2"): Promise<Float32Array[]> {
  if (!initPromise) {
    initPromise = init(model);
  }
  await initPromise;
  const output = await pipelineInstance(texts, { pooling: "mean", normalize: true });
  const nested = output.tolist();
  return nested.map((row: number[]) => new Float32Array(row));
}

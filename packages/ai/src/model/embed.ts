import { openai } from "@ai-sdk/openai";
import { env } from "@quiksend/config";
import { embed } from "ai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

function requireOpenAiKey(): void {
  const key = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for embeddings. Set it in your environment.");
  }
}

export async function embedText(value: string): Promise<number[]> {
  requireOpenAiKey();
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value,
  });
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-dim embedding, got ${embedding.length}`);
  }
  return embedding;
}

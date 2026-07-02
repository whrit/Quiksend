import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { env } from "@quiksend/config";
import type { LanguageModel } from "ai";
import type { ModelProviderId, ModelSpec } from "./types.ts";

const DEFAULT_MODEL_IDS: Record<ModelProviderId, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
};

export interface DefaultModelResult {
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly provider: ModelProviderId;
}

function resolveDefaultProvider(): ModelProviderId {
  return (
    (process.env.AI_DEFAULT_PROVIDER as ModelProviderId | undefined) ?? env.AI_DEFAULT_PROVIDER
  );
}

function requireApiKey(provider: ModelProviderId): string {
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "ANTHROPIC_API_KEY is required to use the Anthropic provider. Set it in your environment.",
      );
    }
    return key;
  }

  const key = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is required to use the OpenAI provider. Set it in your environment.",
    );
  }
  return key;
}

export function resolveModel(spec: ModelSpec): LanguageModel {
  requireApiKey(spec.provider);

  switch (spec.provider) {
    case "anthropic":
      return anthropic(spec.modelId);
    case "openai":
      return openai(spec.modelId);
    default:
      throw new Error(`Unsupported model provider: ${String(spec.provider)}`);
  }
}

export function getDefaultModel(): DefaultModelResult {
  const provider = resolveDefaultProvider();
  const modelId = DEFAULT_MODEL_IDS[provider];
  return {
    model: resolveModel({ provider, modelId }),
    modelId,
    provider,
  };
}

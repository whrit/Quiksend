export type ModelProviderId = "anthropic" | "openai";

export interface ModelSpec {
  readonly provider: ModelProviderId;
  readonly modelId: string;
}

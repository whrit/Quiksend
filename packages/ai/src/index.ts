export type { ModelProviderId, ModelSpec } from "./model/types.ts";
export { getDefaultModel, resolveModel } from "./model/provider.ts";
export { embedText } from "./model/embed.ts";
export type { FetchedPage } from "./fetch/extract.ts";
export { extractMainTextFromHtml, fetchAndExtract } from "./fetch/extract.ts";
export type { SearchProvider, SearchResult } from "./search/types.ts";
export { createSearchProvider } from "./search/provider.ts";
export { createFakeSearchProvider } from "./search/fake.ts";
export { BraveRateLimitError, createBraveSearchProvider } from "./search/brave.ts";
export { buildProfile } from "./research/build-profile.ts";
export type { BuildProfileOptions } from "./research/build-profile.ts";
export { fetchCrmContext } from "./research/fetch-crm-context.ts";
export { searchWeb } from "./research/search-web.ts";
export { fetchAndSummarize } from "./research/fetch-and-summarize.ts";
export { buildPrompt, retrieveValueProps } from "./generation/prompt-builder.ts";
export type {
  BuiltPrompt,
  MatchedValueProp,
  PromptInput,
  StepContext,
  ThreadMessage,
} from "./generation/prompt-builder.ts";
export { generateEmail } from "./generation/generate-email.ts";
export type { GeneratedEmail } from "./generation/generate-email.ts";
export { EmailSchema } from "./generation/email-schema.ts";
export type { EmailOutput } from "./generation/email-schema.ts";
export { humanizeEmail, parseSpintax } from "./humanize/humanize-email.ts";
export type { HumanizeResult, HumanizeWarning } from "./humanize/humanize-email.ts";
export { classifyInboundSentiment } from "./classify/sentiment.ts";
export type { InboundForSentiment, Sentiment } from "./classify/sentiment.ts";

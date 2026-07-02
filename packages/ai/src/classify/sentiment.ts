import { env, logger } from "@quiksend/config";
import { generateText } from "ai";
import { getDefaultModel } from "../model/provider.ts";

export type Sentiment =
  | "interested"
  | "not_now"
  | "objection"
  | "out_of_office"
  | "unsubscribe_request";

const VALID_SENTIMENTS = new Set<string>([
  "interested",
  "not_now",
  "objection",
  "out_of_office",
  "unsubscribe_request",
  "null",
]);

export interface InboundForSentiment {
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}

function hasAiCredentials(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY);
}

function parseSentimentLabel(raw: string): Sentiment | null {
  const label = raw.trim().toLowerCase();
  if (label === "null" || label === "none" || label === "") return null;
  if (VALID_SENTIMENTS.has(label) && label !== "null") {
    return label as Sentiment;
  }
  return null;
}

export async function classifyInboundSentiment(
  inbound: InboundForSentiment,
): Promise<Sentiment | null> {
  if (!hasAiCredentials()) return null;

  const body = inbound.bodyText ?? inbound.bodyHtml?.replace(/<[^>]+>/g, " ") ?? "";
  const prompt = [
    "Classify this email reply into one of: interested, not_now, objection, out_of_office, unsubscribe_request, or null.",
    "Return only the label.",
    "",
    `Subject: ${inbound.subject ?? "(none)"}`,
    `Body: ${body.slice(0, 2000)}`,
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const { text } = await generateText({
      model: getDefaultModel(),
      prompt,
      abortSignal: controller.signal,
    });
    return parseSentimentLabel(text);
  } catch (err) {
    logger.warn({ err }, "inbound sentiment classification failed or timed out");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

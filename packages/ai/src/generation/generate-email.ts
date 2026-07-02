import { generateObject } from "ai";
import { getDefaultModel } from "../model/provider.ts";
import { EmailSchema, type EmailOutput } from "./email-schema.ts";
import type { BuiltPrompt } from "./prompt-builder.ts";

const MAX_RETRIES = 2;

export type GeneratedEmail = EmailOutput & {
  model: string;
  prompt: BuiltPrompt;
};

export async function generateEmail(prompt: BuiltPrompt): Promise<GeneratedEmail> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { model, modelId } = getDefaultModel();
      const result = await generateObject({
        model,
        schema: EmailSchema,
        system: prompt.system,
        prompt: prompt.user,
      });
      return {
        ...result.object,
        model: modelId,
        prompt,
      };
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Email generation failed");
}

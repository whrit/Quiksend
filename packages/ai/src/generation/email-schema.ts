import { z } from "zod";

export const EmailSchema = z.object({
  subject: z.string().min(1).max(200),
  body_markdown: z.string().min(50).max(3000),
  angle: z.string(),
  cited_facts: z.array(
    z.object({
      claim: z.string(),
      source_url: z.string().url().optional(),
    }),
  ),
});

export type EmailOutput = z.infer<typeof EmailSchema>;

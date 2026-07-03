import { randomUUID } from "node:crypto";
import {
  buildProfile,
  buildPrompt,
  generateEmail,
  humanizeEmail,
  retrieveValueProps,
  type StepContext,
  type ThreadMessage,
} from "@quiksend/ai";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type { GenerationPromptPayload, ResearchFact } from "@quiksend/db/schema";
import { enqueue } from "@quiksend/queue";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";
import { deleteValueProp, listValueProps, type PublicValueProp } from "./value-props.functions.ts";

class AiError extends Error {
  readonly code: "NOT_FOUND" | "VALIDATION" | "RESEARCH_PENDING";
  constructor(code: AiError["code"], message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

type GenerationRow = typeof tables.generation.$inferSelect;

export type PublicGeneration = {
  id: string;
  organizationId: string;
  prospectId: string;
  enrollmentId: string | null;
  stepId: string | null;
  variant: "A" | "B";
  model: string;
  outputSubject: string;
  outputBodyMarkdown: string;
  outputRationale: string;
  citedFacts: Array<{ claim: string; source_url?: string }>;
  humanized: boolean;
  status: "draft" | "approved" | "sent" | "discarded";
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  warnings?: Array<{ code: string; message: string }>;
};

export type PublicResearchProfile = {
  id: string;
  prospectId: string;
  facts: ResearchFact[];
  sources: Array<{ url: string; title: string; published_at: string | null }>;
  summary: string | null;
  status: "pending" | "ready" | "error";
  error: string | null;
  freshUntil: string | null;
  updatedAt: string;
};

function toPublicGeneration(
  row: GenerationRow,
  warnings?: PublicGeneration["warnings"],
): PublicGeneration {
  return {
    id: row.id,
    organizationId: row.organizationId,
    prospectId: row.prospectId,
    enrollmentId: row.enrollmentId,
    stepId: row.stepId,
    variant: row.variant,
    model: row.model,
    outputSubject: row.outputSubject,
    outputBodyMarkdown: row.outputBodyMarkdown,
    outputRationale: row.outputRationale,
    citedFacts: row.citedFacts,
    humanized: row.humanized,
    status: row.status,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    warnings,
  };
}

async function loadStepContext(
  organizationId: string,
  stepId: string | undefined,
): Promise<StepContext | null> {
  if (!stepId) return null;
  const step = await db.query.sequenceStep.findFirst({
    where: and(
      eq(tables.sequenceStep.id, stepId),
      eq(tables.sequenceStep.organizationId, organizationId),
    ),
  });
  if (!step) return null;
  const config = step.config as Record<string, unknown>;
  return {
    subject: typeof config.subject === "string" ? config.subject : undefined,
    bodyTemplate: typeof config.body_template === "string" ? config.body_template : undefined,
    aiGenerate: config.ai_generate === true,
  };
}

async function loadThreadContext(
  organizationId: string,
  enrollmentId: string | undefined,
): Promise<ThreadMessage[]> {
  if (!enrollmentId) return [];
  const messages = await db.query.message.findMany({
    where: and(
      eq(tables.message.organizationId, organizationId),
      eq(tables.message.enrollmentId, enrollmentId),
    ),
    orderBy: desc(tables.message.sentAt),
    limit: 5,
  });
  return messages.map((m) => ({
    subject: m.subject ?? "",
    body: m.bodyText ?? m.bodyHtml ?? "",
    direction: m.direction,
    sentAt: (m.sentAt ?? m.createdAt).toISOString(),
  }));
}

async function ensureResearch(
  organizationId: string,
  prospectId: string,
  forceResearch: boolean,
): Promise<void> {
  const profile = await db.query.researchProfile.findFirst({
    where: and(
      eq(tables.researchProfile.organizationId, organizationId),
      eq(tables.researchProfile.prospectId, prospectId),
    ),
  });

  const stale =
    !profile ||
    profile.status !== "ready" ||
    !profile.freshUntil ||
    profile.freshUntil <= new Date();

  if (stale || forceResearch) {
    await buildProfile(prospectId, { forceRefresh: forceResearch || stale });
  }
}

export const getProspectAiReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ prospectId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const prospect = await db.query.prospect.findFirst({
      where: and(
        eq(tables.prospect.id, data.prospectId),
        eq(tables.prospect.organizationId, organizationId),
      ),
      with: { company: true },
    });
    if (!prospect) throw new AiError("NOT_FOUND", "Prospect not found");

    const profile = await db.query.researchProfile.findFirst({
      where: and(
        eq(tables.researchProfile.organizationId, organizationId),
        eq(tables.researchProfile.prospectId, data.prospectId),
      ),
    });

    const latestGeneration = await db.query.generation.findFirst({
      where: and(
        eq(tables.generation.organizationId, organizationId),
        eq(tables.generation.prospectId, data.prospectId),
      ),
      orderBy: desc(tables.generation.createdAt),
    });

    const valueProps = profile?.summary
      ? await retrieveValueProps(organizationId, profile.summary, 5)
      : await retrieveValueProps(organizationId, null, 5);

    const publicProfile: PublicResearchProfile | null = profile
      ? {
          id: profile.id,
          prospectId: profile.prospectId,
          facts: profile.facts as ResearchFact[],
          sources: profile.sources as PublicResearchProfile["sources"],
          summary: profile.summary,
          status: profile.status,
          error: profile.error,
          freshUntil: profile.freshUntil?.toISOString() ?? null,
          updatedAt: profile.updatedAt.toISOString(),
        }
      : null;

    return {
      prospect: {
        id: prospect.id,
        email: prospect.email,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        title: prospect.title,
        company: prospect.company
          ? {
              name: prospect.company.name,
              domain: prospect.company.domain,
              industry: prospect.company.industry,
            }
          : null,
      },
      researchProfile: publicProfile,
      matchedValueProps: valueProps,
      latestGeneration: latestGeneration ? toPublicGeneration(latestGeneration) : null,
    };
  });

export const generateEmailForProspect = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        prospectId: z.string().uuid(),
        stepId: z.string().uuid().optional(),
        enrollmentId: z.string().uuid().optional(),
        forceResearch: z.boolean().optional(),
        variant: z.enum(["A", "B"]).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const prospect = await db.query.prospect.findFirst({
      where: and(
        eq(tables.prospect.id, data.prospectId),
        eq(tables.prospect.organizationId, organizationId),
      ),
      with: { company: true },
    });
    if (!prospect) throw new AiError("NOT_FOUND", "Prospect not found");

    await ensureResearch(organizationId, data.prospectId, data.forceResearch === true);

    const profile = await db.query.researchProfile.findFirst({
      where: and(
        eq(tables.researchProfile.organizationId, organizationId),
        eq(tables.researchProfile.prospectId, data.prospectId),
      ),
    });
    if (!profile || profile.status === "pending") {
      throw new AiError("RESEARCH_PENDING", "Research is still in progress");
    }
    if (profile.status === "error") {
      throw new AiError("VALIDATION", profile.error ?? "Research failed");
    }

    const facts = profile.facts as ResearchFact[];
    const valueProps = await retrieveValueProps(organizationId, profile.summary, 3);
    const step = await loadStepContext(organizationId, data.stepId);
    const threadContext = await loadThreadContext(organizationId, data.enrollmentId);
    const variant = data.variant ?? "A";

    const built = buildPrompt({
      prospect: {
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        email: prospect.email,
        title: prospect.title,
      },
      company: prospect.company
        ? {
            name: prospect.company.name,
            domain: prospect.company.domain,
            industry: prospect.company.industry,
          }
        : null,
      researchFacts: facts,
      researchSummary: profile.summary,
      valueProps,
      step,
      threadContext,
      variant,
    });

    const generated = await generateEmail(built);
    const generationId = randomUUID();
    const humanized = humanizeEmail(
      { subject: generated.subject, bodyMarkdown: generated.body_markdown },
      generationId,
    );

    const promptPayload: GenerationPromptPayload = {
      system: built.system,
      user: built.user,
      researchSummary: profile.summary,
      valuePropIds: built.valuePropIds,
      stepId: data.stepId ?? null,
      variant,
    };

    const [row] = await db
      .insert(tables.generation)
      .values({
        id: generationId,
        organizationId,
        prospectId: data.prospectId,
        enrollmentId: data.enrollmentId ?? null,
        stepId: data.stepId ?? null,
        variant,
        prompt: promptPayload,
        model: generated.model,
        outputSubject: humanized.subject,
        outputBodyMarkdown: humanized.bodyMarkdown,
        outputRationale: generated.angle,
        citedFacts: generated.cited_facts,
        humanized: humanized.humanized,
        status: "draft",
      })
      .returning();

    if (!row) throw new AiError("VALIDATION", "Failed to persist generation");
    return toPublicGeneration(row, humanized.warnings);
  });

export const approveGeneration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        generationId: z.string().uuid(),
        edits: z
          .object({
            outputSubject: z.string().min(1).max(200).optional(),
            outputBodyMarkdown: z.string().min(1).optional(),
          })
          .optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;
    const now = new Date();

    const [row] = await db
      .update(tables.generation)
      .set({
        ...(data.edits?.outputSubject ? { outputSubject: data.edits.outputSubject } : {}),
        ...(data.edits?.outputBodyMarkdown
          ? { outputBodyMarkdown: data.edits.outputBodyMarkdown }
          : {}),
        status: "approved",
        approvedByUserId: userId,
        approvedAt: now,
      })
      .where(
        and(
          eq(tables.generation.id, data.generationId),
          eq(tables.generation.organizationId, organizationId),
        ),
      )
      .returning();

    if (!row) throw new AiError("NOT_FOUND", "Generation not found");
    return toPublicGeneration(row);
  });

export const discardGeneration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ generationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const [row] = await db
      .update(tables.generation)
      .set({ status: "discarded" })
      .where(
        and(
          eq(tables.generation.id, data.generationId),
          eq(tables.generation.organizationId, organizationId),
        ),
      )
      .returning();
    if (!row) throw new AiError("NOT_FOUND", "Generation not found");
    return toPublicGeneration(row);
  });

export const triggerResearch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        prospectId: z.string().uuid(),
        forceRefresh: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const prospect = await db.query.prospect.findFirst({
      where: and(
        eq(tables.prospect.id, data.prospectId),
        eq(tables.prospect.organizationId, organizationId),
      ),
    });
    if (!prospect) throw new AiError("NOT_FOUND", "Prospect not found");

    await enqueue("ai.research", {
      prospectId: data.prospectId,
      forceRefresh: data.forceRefresh ?? false,
    });
    return { ok: true as const };
  });

const upsertValuePropSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  body: z.string().min(1),
  tags: z.array(z.string().min(1).max(100)).optional(),
});

export { listValueProps, deleteValueProp, type PublicValueProp };

export const upsertValueProp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => upsertValuePropSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;
    if (data.id) {
      const [row] = await db
        .update(tables.valueProp)
        .set({
          title: data.title,
          body: data.body,
          tags: data.tags ?? [],
        })
        .where(
          and(
            eq(tables.valueProp.id, data.id),
            eq(tables.valueProp.organizationId, organizationId),
          ),
        )
        .returning();
      if (!row) throw new AiError("NOT_FOUND", "Value prop not found");
      return {
        id: row.id,
        organizationId: row.organizationId,
        title: row.title,
        body: row.body,
        tags: row.tags,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      } satisfies PublicValueProp;
    }

    const [row] = await db
      .insert(tables.valueProp)
      .values({
        organizationId,
        title: data.title,
        body: data.body,
        tags: data.tags ?? [],
        createdByUserId: userId,
      })
      .returning();
    if (!row) throw new AiError("VALIDATION", "Failed to create value prop");
    return {
      id: row.id,
      organizationId: row.organizationId,
      title: row.title,
      body: row.body,
      tags: row.tags,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies PublicValueProp;
  });

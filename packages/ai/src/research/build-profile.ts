import { db, tables } from "@quiksend/db";
import type { ResearchFact, ResearchSource } from "@quiksend/db/schema";
import { and, eq } from "drizzle-orm";
import { embedText } from "../model/embed.ts";
import { fetchCrmContext } from "./fetch-crm-context.ts";
import { fetchAndSummarize } from "./fetch-and-summarize.ts";
import { searchWeb } from "./search-web.ts";

const FRESHNESS_DAYS = 14;

function dedupeFacts(facts: ResearchFact[]): ResearchFact[] {
  const seen = new Set<string>();
  const out: ResearchFact[] = [];
  for (const fact of facts) {
    const key = fact.claim.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

function factsFromCrm(
  crm: NonNullable<Awaited<ReturnType<typeof fetchCrmContext>>>,
): ResearchFact[] {
  const facts: ResearchFact[] = [];
  const title =
    (crm.prospect.Title as string | undefined) ??
    (crm.prospect.properties as Record<string, string> | undefined)?.jobtitle;
  if (title) {
    facts.push({
      claim: `Prospect title: ${title}`,
      source_url: `crm://${crm.provider}/contact`,
      confidence: 1,
    });
  }
  const companyName =
    (crm.company?.Name as string | undefined) ??
    (crm.company?.properties as Record<string, string> | undefined)?.name;
  if (companyName) {
    facts.push({
      claim: `Company: ${companyName}`,
      source_url: `crm://${crm.provider}/company`,
      confidence: 1,
    });
  }
  for (const activity of crm.recentActivity) {
    if (!activity.subject) continue;
    facts.push({
      claim: `Recent CRM activity (${activity.type}): ${activity.subject}`,
      source_url: `crm://${crm.provider}/activity`,
      confidence: 0.9,
    });
  }
  return facts;
}

function buildSummary(facts: ResearchFact[]): string {
  if (facts.length === 0) return "No research facts available.";
  return facts
    .slice(0, 12)
    .map((f) => `- ${f.claim}`)
    .join("\n");
}

export type BuildProfileOptions = {
  forceRefresh?: boolean;
};

export async function buildProfile(
  prospectId: string,
  options: BuildProfileOptions = {},
): Promise<void> {
  const prospect = await db.query.prospect.findFirst({
    where: eq(tables.prospect.id, prospectId),
    with: { company: true },
  });
  if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);

  const organizationId = prospect.organizationId;
  const existing = await db.query.researchProfile.findFirst({
    where: and(
      eq(tables.researchProfile.organizationId, organizationId),
      eq(tables.researchProfile.prospectId, prospectId),
    ),
  });

  const now = new Date();
  if (
    !options.forceRefresh &&
    existing?.freshUntil &&
    existing.freshUntil > now &&
    existing.status === "ready"
  ) {
    return;
  }

  await db
    .insert(tables.researchProfile)
    .values({
      organizationId,
      prospectId,
      status: "pending",
      facts: [],
      sources: [],
      error: null,
    })
    .onConflictDoUpdate({
      target: [tables.researchProfile.organizationId, tables.researchProfile.prospectId],
      set: { status: "pending", error: null, updatedAt: now },
    });

  try {
    const companyName =
      prospect.company?.name ??
      prospect.company?.domain ??
      prospect.email.split("@")[1] ??
      "Unknown";

    const [crmContext, searchResults] = await Promise.all([
      fetchCrmContext({ organizationId, prospectId }),
      searchWeb(companyName),
    ]);

    const webFacts = await fetchAndSummarize(searchResults);
    const crmFacts = crmContext ? factsFromCrm(crmContext) : [];
    const facts = dedupeFacts([...crmFacts, ...webFacts]);

    const sources: ResearchSource[] = searchResults.map((r) => ({
      url: r.url,
      title: r.title,
      published_at: r.publishedAt,
    }));

    const summary = buildSummary(facts);
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(summary);
    } catch {
      embedding = null;
    }

    const freshUntil = new Date(now);
    freshUntil.setDate(freshUntil.getDate() + FRESHNESS_DAYS);

    await db
      .update(tables.researchProfile)
      .set({
        facts,
        sources,
        summary,
        embedding,
        freshUntil,
        status: "ready",
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(tables.researchProfile.organizationId, organizationId),
          eq(tables.researchProfile.prospectId, prospectId),
        ),
      );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(tables.researchProfile)
      .set({ status: "error", error: message, updatedAt: now })
      .where(
        and(
          eq(tables.researchProfile.organizationId, organizationId),
          eq(tables.researchProfile.prospectId, prospectId),
        ),
      );
    throw err;
  }
}

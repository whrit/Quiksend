import { env } from "@quiksend/config";
import { isAdminOrOwner } from "@quiksend/core";
import { db, tables } from "@quiksend/db";
import { enqueue } from "@quiksend/queue";
import type { EmailGateway } from "@quiksend/mail";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { encryptSeedImapConfig, validateImapHost, type SeedImapConfigPlain } from "@quiksend/mail";
import { isDeliverabilityProEntitled } from "./canary-injection.ts";
import { orgFn } from "./org-fn.ts";

class SeedInboxError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFIG";
  constructor(code: SeedInboxError["code"], message: string) {
    super(message);
    this.name = "SeedInboxError";
    this.code = code;
  }
}

function requireAdmin(ctx: { orgContext: { role: string } }): void {
  if (!isAdminOrOwner(ctx.orgContext as never)) {
    throw new SeedInboxError("FORBIDDEN", "Admin or owner role required");
  }
}

export type UserSeedInboxListItem = {
  kind: "user";
  id: string;
  email: string;
  gateway: EmailGateway;
  provider: string;
  verifiedAt: string | null;
  active: boolean;
  notes: string | null;
  providerManaged: false;
};

export type ProviderPoolSummaryListItem = {
  kind: "provider_pool_summary";
  gateway: EmailGateway;
  count: number;
  providerManaged: true;
};

export type SeedInboxListItem = UserSeedInboxListItem | ProviderPoolSummaryListItem;

/** @deprecated Use `SeedInboxListItem` — kept for create/toggle responses. */
export type PublicSeedInbox = {
  id: string;
  email: string;
  gateway: EmailGateway;
  provider: string;
  verifiedAt: string | null;
  active: boolean;
  notes: string | null;
  providerManaged: boolean;
};

function toPublic(row: typeof tables.seedInbox.$inferSelect): PublicSeedInbox {
  return {
    id: row.id,
    email: row.email,
    gateway: row.gateway,
    provider: row.provider,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    active: row.active,
    notes: row.notes,
    providerManaged: row.organizationId === null,
  };
}

function toUserListItem(row: typeof tables.seedInbox.$inferSelect): UserSeedInboxListItem {
  const pub = toPublic(row);
  return { kind: "user", ...pub, providerManaged: false };
}

function summarizeProviderPools(
  rows: (typeof tables.seedInbox.$inferSelect)[],
): ProviderPoolSummaryListItem[] {
  const counts = new Map<EmailGateway, number>();
  for (const row of rows) {
    counts.set(row.gateway, (counts.get(row.gateway) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([gateway, count]) => ({
      kind: "provider_pool_summary" as const,
      gateway,
      count,
      providerManaged: true as const,
    }));
}

const createSchema = z.object({
  email: z.string().email(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().positive(),
  imapUsername: z.string().min(1),
  imapPassword: z.string().min(1),
  useSsl: z.boolean(),
  gateway: z.string(),
  provider: z.enum(["m365", "google_workspace"]),
  notes: z.string().max(500).optional(),
});

export const listSeedInboxes = orgFn({ method: "GET" }).handler(async ({ context }) => {
  const { organizationId } = context.orgContext;
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, organizationId),
    columns: { metadata: true },
  });
  const pro = isDeliverabilityProEntitled(org?.metadata);

  const userSeeds = await db.query.seedInbox.findMany({
    where: eq(tables.seedInbox.organizationId, organizationId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });

  const providerSeeds = pro
    ? await db.query.seedInbox.findMany({
        where: isNull(tables.seedInbox.organizationId),
        orderBy: (s, { asc }) => [asc(s.gateway), asc(s.email)],
      })
    : [];

  return [
    ...userSeeds.map(toUserListItem),
    ...summarizeProviderPools(providerSeeds),
  ] satisfies SeedInboxListItem[];
});

export const createUserSeedInbox = orgFn({ method: "POST" })
  .validator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const { organizationId } = context.orgContext;
    if (!env.MAILBOX_ENCRYPTION_KEY) {
      throw new SeedInboxError("CONFIG", "MAILBOX_ENCRYPTION_KEY is required");
    }

    const hostError = validateImapHost(data.imapHost);
    if (hostError) {
      throw new SeedInboxError("VALIDATION", hostError);
    }

    const imap: SeedImapConfigPlain = {
      host: data.imapHost,
      port: data.imapPort,
      auth: { user: data.imapUsername, pass: data.imapPassword },
      secure: data.useSsl,
    };

    const [row] = await db
      .insert(tables.seedInbox)
      .values({
        organizationId,
        email: data.email.toLowerCase(),
        gateway: data.gateway as EmailGateway,
        provider: data.provider,
        imapConfig: encryptSeedImapConfig(imap, organizationId),
        notes: data.notes ?? null,
      })
      .returning();

    if (!row) throw new SeedInboxError("VALIDATION", "Failed to create seed inbox");
    await enqueue("seed_inbox.verify", { seedInboxId: row.id });
    return toPublic(row);
  });

export const verifySeedInbox = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ seedInboxId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const { organizationId } = context.orgContext;
    const seed = await db.query.seedInbox.findFirst({
      where: and(
        eq(tables.seedInbox.id, data.seedInboxId),
        eq(tables.seedInbox.organizationId, organizationId),
      ),
    });
    if (!seed) throw new SeedInboxError("NOT_FOUND", "Seed inbox not found");
    await enqueue("seed_inbox.verify", { seedInboxId: seed.id });
    return { ok: true };
  });

export const deleteSeedInbox = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ seedInboxId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const { organizationId } = context.orgContext;
    const seed = await db.query.seedInbox.findFirst({
      where: and(
        eq(tables.seedInbox.id, data.seedInboxId),
        eq(tables.seedInbox.organizationId, organizationId),
      ),
    });
    if (!seed) throw new SeedInboxError("NOT_FOUND", "Seed inbox not found");
    await db.delete(tables.seedInbox).where(eq(tables.seedInbox.id, seed.id));
    return { ok: true };
  });

export const toggleSeedInboxActive = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ seedInboxId: z.string().uuid(), active: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const { organizationId } = context.orgContext;
    const [row] = await db
      .update(tables.seedInbox)
      .set({ active: data.active })
      .where(
        and(
          eq(tables.seedInbox.id, data.seedInboxId),
          eq(tables.seedInbox.organizationId, organizationId),
        ),
      )
      .returning();
    if (!row) throw new SeedInboxError("NOT_FOUND", "Seed inbox not found");
    return toPublic(row);
  });

export const isEntitledToProviderSeeds = orgFn({ method: "GET" }).handler(async ({ context }) => {
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, context.orgContext.organizationId),
    columns: { metadata: true },
  });
  const parsed =
    typeof org?.metadata === "string"
      ? (JSON.parse(org.metadata) as Record<string, unknown>)
      : (org?.metadata as Record<string, unknown> | null);
  const until = (
    parsed?.entitlements as { deliverability_pro?: { activeUntil?: string } } | undefined
  )?.deliverability_pro?.activeUntil;
  const entitled = isDeliverabilityProEntitled(org?.metadata);
  return { entitled, expiresAt: until };
});

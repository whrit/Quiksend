import { randomUUID } from "node:crypto";
import { logger, env } from "@quiksend/config";
import { client, db, tables } from "./index.ts";
import { member, organization, user } from "./schema/auth.ts";
import { eq } from "drizzle-orm";

const DEMO_EMAIL = "demo@quiksend.local";

async function main(): Promise<void> {
  const existing = await db.query.user.findFirst({
    where: eq(user.email, DEMO_EMAIL),
  });
  if (existing) {
    logger.info("Seed already applied (demo user exists). Skipping.");
    await client.end();
    return;
  }

  const orgId = `org_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const userId = `user_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const memberId = `member_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    name: "Demo User",
    email: DEMO_EMAIL,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(organization).values({
    id: orgId,
    name: "Demo Workspace",
    slug: `demo-${randomUUID().slice(0, 8)}`,
    createdAt: now,
    metadata: JSON.stringify({ postal_address: "123 Demo St, San Francisco, CA 94105" }),
  });

  await db.insert(member).values({
    id: memberId,
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: now,
  });

  const smtpHost = env.SMTP_HOST ?? "localhost";
  const smtpPort = env.SMTP_PORT ?? 1025;

  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: "demo@quiksend.local",
      fromName: "Demo Sender",
      dailyCap: 50,
      throttleSeconds: 90,
      status: "active",
      smtpConfig: JSON.stringify({
        host: smtpHost,
        port: smtpPort,
        secure: false,
        auth: null,
      }),
    })
    .returning();

  const prospects = Array.from({ length: 20 }, (_, i) => ({
    organizationId: orgId,
    email: `prospect${i + 1}@example.com`,
    firstName: `Prospect`,
    lastName: `${i + 1}`,
    status: "new" as const,
    source: "manual" as const,
  }));

  await db.insert(tables.prospect).values(prospects);

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: "Demo Outreach Sequence",
      status: "active",
      settings: {
        timezone: "UTC",
        throttle_seconds: 90,
        mailbox_ids: mailbox ? [mailbox.id] : [],
        stop_on_reply: true,
        business_days_only: true,
      },
      createdByUserId: userId,
    })
    .returning();

  if (sequence) {
    await db.insert(tables.sequenceStep).values([
      {
        sequenceId: sequence.id,
        organizationId: orgId,
        stepIndex: 0,
        stepType: "manual_email",
        delayMinutes: 0,
        config: {
          subject: "Quick intro",
          body_template: "Hi {{firstName}}, reaching out from Quiksend demo.",
          ai_generate: false,
        },
      },
      {
        sequenceId: sequence.id,
        organizationId: orgId,
        stepIndex: 1,
        stepType: "wait",
        delayMinutes: 1440,
        config: { minutes: 1440 },
      },
    ]);
  }

  logger.info("Seed complete.");
  logger.info({ orgId }, "Demo workspace created");
  logger.info({ email: DEMO_EMAIL }, "Demo user email");
  logger.info({ smtpHost, smtpPort }, "Mailpit SMTP");
  logger.info("Sign up via the UI with the demo email or create your own account.");
}

main()
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exit(1);
  })
  .finally(async () => {
    await client.end();
  });

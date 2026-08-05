-- Tenant isolation: roles, row-level security policies, and grants.
-- Hand-authored; no drizzle schema change. Roles contain no passwords.

-- ── Roles ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quiksend_app') THEN
    CREATE ROLE quiksend_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quiksend_worker') THEN
    CREATE ROLE quiksend_worker NOLOGIN BYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT quiksend_app TO CURRENT_USER;
--> statement-breakpoint
GRANT quiksend_worker TO CURRENT_USER;
--> statement-breakpoint

-- ── Table privileges ───────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO quiksend_app, quiksend_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quiksend_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quiksend_worker;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO quiksend_app;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO quiksend_worker;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quiksend_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quiksend_worker;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO quiksend_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO quiksend_worker;
--> statement-breakpoint

-- ── Enable RLS on all tenant-scoped tables ─────────────────────────────────
-- ENABLE only (no FORCE): table owner bypasses RLS. withTenantTransaction
-- switches to quiksend_app via SET LOCAL ROLE, activating policies.
-- Worker code runs as owner and bypasses naturally; quiksend_worker
-- (BYPASSRLS) is available for explicit opt-in later.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'member','invitation','apikey','company','prospect','list','list_member',
    'import_batch','import_error','crm_connection','sync_state','mailbox',
    'message','sequence','sequence_step','enrollment','send_reservation',
    'value_prop','research_profile','generation','task','api_key_usage',
    'webhook_endpoint','webhook_delivery','event_outbox','crm_writeback_log',
    'event','suppression','seed_inbox','canary_send','deliverability_snapshot'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ── Direct organization_id policies ────────────────────────────────────────
-- Tables with an organization_id column use a simple equality check.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'member','invitation','company','prospect','list','import_batch',
    'crm_connection','sync_state','mailbox','message','sequence',
    'sequence_step','enrollment','task','value_prop','research_profile',
    'generation','api_key_usage','webhook_endpoint','webhook_delivery',
    'event_outbox','crm_writeback_log','event','suppression',
    'seed_inbox','canary_send','deliverability_snapshot'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO quiksend_app '
      'USING (organization_id = current_setting(''app.organization_id'', true)) '
      'WITH CHECK (organization_id = current_setting(''app.organization_id'', true))',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- ── Membership-based policy for auth tables without organization_id ────────
-- apikey.reference_id → user → member.user_id scoped via member.organization_id

CREATE POLICY tenant_isolation ON apikey FOR ALL TO quiksend_app
  USING (EXISTS (
    SELECT 1 FROM member
    WHERE member.user_id = apikey.reference_id
      AND member.organization_id = current_setting('app.organization_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM member
    WHERE member.user_id = apikey.reference_id
      AND member.organization_id = current_setting('app.organization_id', true)
  ));
--> statement-breakpoint

-- ── Indirect FK-based policies ─────────────────────────────────────────────
-- Tables without organization_id, scoped via parent FK.

CREATE POLICY tenant_isolation ON list_member FOR ALL TO quiksend_app
  USING (EXISTS (
    SELECT 1 FROM list
    WHERE list.id = list_member.list_id
      AND list.organization_id = current_setting('app.organization_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM list
    WHERE list.id = list_member.list_id
      AND list.organization_id = current_setting('app.organization_id', true)
  ));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON import_error FOR ALL TO quiksend_app
  USING (EXISTS (
    SELECT 1 FROM import_batch
    WHERE import_batch.id = import_error.batch_id
      AND import_batch.organization_id = current_setting('app.organization_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM import_batch
    WHERE import_batch.id = import_error.batch_id
      AND import_batch.organization_id = current_setting('app.organization_id', true)
  ));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON send_reservation FOR ALL TO quiksend_app
  USING (EXISTS (
    SELECT 1 FROM mailbox
    WHERE mailbox.id = send_reservation.mailbox_id
      AND mailbox.organization_id = current_setting('app.organization_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM mailbox
    WHERE mailbox.id = send_reservation.mailbox_id
      AND mailbox.organization_id = current_setting('app.organization_id', true)
  ));

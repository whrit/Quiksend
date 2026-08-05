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

ALTER TABLE member ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE apikey ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE prospect ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE list ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE list_member ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_batch ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_error ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_connection ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mailbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sequence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sequence_step ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE send_reservation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE value_prop ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE research_profile ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE generation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_endpoint ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_delivery ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_writeback_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE suppression ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE seed_inbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE canary_send ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deliverability_snapshot ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── Direct organization_id policies ────────────────────────────────────────
-- Tables with an organization_id column use a simple equality check.

CREATE POLICY tenant_isolation ON member FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invitation FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON prospect FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON list FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON import_batch FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_connection FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON sync_state FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mailbox FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON message FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON sequence FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON sequence_step FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON enrollment FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON task FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON value_prop FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON research_profile FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON generation FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON api_key_usage FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_endpoint FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_delivery FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON event_outbox FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_writeback_log FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON event FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON suppression FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON seed_inbox FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON canary_send FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON deliverability_snapshot FOR ALL TO quiksend_app
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
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

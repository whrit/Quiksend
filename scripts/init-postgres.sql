-- Initialize PostgreSQL for production: create app-user with limited privileges.
-- Mounted as /docker-entrypoint-initdb.d/10-init-app-user.sql by docker-compose.prod.yml
-- Runs AFTER default Postgres database is created, before app connections.

-- Create non-superuser app account for web/worker connection.
-- Password comes from POSTGRES_APP_PASSWORD environment variable.
CREATE ROLE quiksend WITH LOGIN PASSWORD :'quiksend_password' INHERIT;

-- Grant connect and usage on the public database.
GRANT CONNECT ON DATABASE quiksend TO quiksend;
GRANT USAGE ON SCHEMA public TO quiksend;

-- Grant create for migrations and schema setup.
GRANT CREATE ON SCHEMA public TO quiksend;

-- Comment for audit trail.
COMMENT ON ROLE quiksend IS 'Production app user: limited privileges, no superuser';

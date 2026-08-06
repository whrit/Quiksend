#!/bin/bash
# Initialize PostgreSQL for production: split roles for security.
# quiksend_migrator: DDL/schema owner, runs migrations
# quiksend_app: runtime app role, limited to DML/sequence usage
# 
# Executed by Postgres entrypoint via docker-entrypoint-initdb.d/.
# Reads POSTGRES_MIGRATOR_PASSWORD and POSTGRES_APP_PASSWORD from environment.

set -euo pipefail

# Validate both password environment variables exist and match safety constraints.
# Passwords must be URL-safe: [A-Za-z0-9._~-] and at least 32 characters.
if [ -z "${POSTGRES_MIGRATOR_PASSWORD:-}" ]; then
  echo "ERROR: POSTGRES_MIGRATOR_PASSWORD environment variable required" >&2
  exit 1
fi

if [ -z "${POSTGRES_APP_PASSWORD:-}" ]; then
  echo "ERROR: POSTGRES_APP_PASSWORD environment variable required" >&2
  exit 1
fi

# Validate password format: URL-safe alphabet [A-Za-z0-9._~-], min 32 chars
validate_password() {
  local pwd="$1"
  local name="$2"
  if ! echo "$pwd" | grep -qE '^[A-Za-z0-9._~-]{32,}$'; then
    echo "ERROR: $name must be at least 32 characters, containing only [A-Za-z0-9._~-]" >&2
    exit 1
  fi
}

validate_password "$POSTGRES_MIGRATOR_PASSWORD" "POSTGRES_MIGRATOR_PASSWORD"
validate_password "$POSTGRES_APP_PASSWORD" "POSTGRES_APP_PASSWORD"

# Use psql -v to safely pass passwords without shell exposure.
psql -v ON_ERROR_STOP=1 \
  -v migrator_password="'${POSTGRES_MIGRATOR_PASSWORD}'" \
  -v app_password="'${POSTGRES_APP_PASSWORD}'" <<-EOSQL

  -- Create or replace migrator role (DDL/schema owner).
  DO \$\$ BEGIN
    CREATE ROLE quiksend_migrator WITH LOGIN ENCRYPTED PASSWORD :migrator_password INHERIT;
  EXCEPTION WHEN duplicate_object THEN
    ALTER ROLE quiksend_migrator WITH ENCRYPTED PASSWORD :migrator_password;
  END
  \$\$;

  -- Create or replace app role (runtime, limited privileges).
  DO \$\$ BEGIN
    CREATE ROLE quiksend_app WITH LOGIN ENCRYPTED PASSWORD :app_password INHERIT;
  EXCEPTION WHEN duplicate_object THEN
    ALTER ROLE quiksend_app WITH ENCRYPTED PASSWORD :app_password;
  END
  \$\$;

  -- Grant migrator schema creation and table management.
  GRANT CREATE ON DATABASE quiksend TO quiksend_migrator;
  GRANT USAGE ON SCHEMA public TO quiksend_migrator;
  GRANT CREATE ON SCHEMA public TO quiksend_migrator;

  -- Set default privileges: objects created by migrator are readable/writable by app.
  ALTER DEFAULT PRIVILEGES FOR ROLE quiksend_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quiksend_app;

  ALTER DEFAULT PRIVILEGES FOR ROLE quiksend_migrator IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO quiksend_app;

  -- Grant app role basic access.
  GRANT CONNECT ON DATABASE quiksend TO quiksend_app;
  GRANT USAGE ON SCHEMA public TO quiksend_app;

  -- Audit trail.
  COMMENT ON ROLE quiksend_migrator IS 'Production schema migration role: DDL owner';
  COMMENT ON ROLE quiksend_app IS 'Production app runtime role: limited DML privileges';
EOSQL

echo "Postgres roles setup completed: quiksend_migrator (DDL) and quiksend_app (DML)."

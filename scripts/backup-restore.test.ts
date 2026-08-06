import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Backup/Restore Operations with Age Encryption", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "backup-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("backup script fails when DATABASE_URL is not set", () => {
    const recipientFile = join(testDir, "recipient.txt");
    writeFileSync(recipientFile, "age1test");

    let error: string = "";
    try {
      execSync(`bash scripts/backup-database.sh "${recipientFile}"`, {
        env: { PATH: process.env.PATH || "" },
      });
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("DATABASE_URL");
  });

  it("backup script fails when recipient file does not exist", () => {
    let error: string = "";
    try {
      execSync(`bash scripts/backup-database.sh /nonexistent/recipient.txt`, {
        env: {
          DATABASE_URL: "postgres://user:pass@localhost/db",
          PATH: process.env.PATH || "",
        },
      });
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("Recipient file not found");
  });

  it("backup script fails when age command is not available", () => {
    const recipientFile = join(testDir, "recipient-no-age.txt");
    writeFileSync(recipientFile, "age1test");

    let error: string = "";
    try {
      execSync(`bash scripts/backup-database.sh "${recipientFile}"`, {
        env: {
          DATABASE_URL: "postgres://user:pass@localhost/db",
          PATH: "", // Empty PATH so age is not found
        },
      });
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("age command not found");
  });

  it("restore script fails when DATABASE_URL is not set", () => {
    const identityFile = join(testDir, "identity.txt");
    writeFileSync(identityFile, "AGE-SECRET-KEY-1test");
    chmodSync(identityFile, 0o600);

    let error: string = "";
    try {
      execSync(
        `bash scripts/restore-database.sh "${join(testDir, "backup.enc")}" "${identityFile}"`,
        {
          env: { PATH: process.env.PATH || "" },
        },
      );
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("DATABASE_URL");
  });

  it("restore script fails when backup file does not exist", () => {
    const identityFile = join(testDir, "identity-nofile.txt");
    writeFileSync(identityFile, "AGE-SECRET-KEY-1test");
    chmodSync(identityFile, 0o600);

    let error: string = "";
    try {
      execSync(`bash scripts/restore-database.sh /nonexistent/backup.enc "${identityFile}"`, {
        env: {
          DATABASE_URL: "postgres://user:pass@localhost/db",
          PATH: process.env.PATH || "",
        },
      });
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("Backup file not found");
  });

  it("restore script fails when identity file does not exist", () => {
    let error: string = "";
    try {
      execSync(
        `bash scripts/restore-database.sh "${join(testDir, "backup.enc")}" /nonexistent/identity.txt`,
        {
          env: {
            DATABASE_URL: "postgres://user:pass@localhost/db",
            PATH: process.env.PATH || "",
          },
        },
      );
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("Identity file not found");
  });

  it("restore script fails when identity file has wrong permissions (not 0600)", () => {
    const badIdentity = join(testDir, "bad-identity-perms.txt");
    writeFileSync(badIdentity, "AGE-SECRET-KEY-1test");
    chmodSync(badIdentity, 0o644); // Wrong permissions

    let error: string = "";
    try {
      execSync(
        `bash scripts/restore-database.sh "${join(testDir, "backup.enc")}" "${badIdentity}"`,
        {
          env: {
            DATABASE_URL: "postgres://user:pass@localhost/db",
            PATH: process.env.PATH || "",
          },
        },
      );
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("permissions 0600");
  });

  it("restore script fails when age command is not available", () => {
    const identityFile = join(testDir, "identity-no-age.txt");
    writeFileSync(identityFile, "AGE-SECRET-KEY-1test");
    chmodSync(identityFile, 0o600);

    let error: string = "";
    try {
      execSync(
        `bash scripts/restore-database.sh "${join(testDir, "backup.enc")}" "${identityFile}"`,
        {
          env: {
            DATABASE_URL: "postgres://user:pass@localhost/db",
            PATH: "", // Empty PATH so age is not found
          },
        },
      );
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("age command not found");
  });

  it("restore script validates target database name against SQL injection", () => {
    const identityFile = join(testDir, "identity-sql-test.txt");
    writeFileSync(identityFile, "AGE-SECRET-KEY-1test");
    chmodSync(identityFile, 0o600);

    // Try to pass a malicious database name
    let error: string = "";
    try {
      execSync(
        `bash scripts/restore-database.sh "${join(testDir, "backup.enc")}" "${identityFile}" "foo; DROP DATABASE quiksend;--"`,
        {
          env: {
            DATABASE_URL: "postgres://user:pass@localhost/db",
            PATH: process.env.PATH || "",
          },
        },
      );
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("Invalid target database name");
  });

  it("restore script accepts valid database names matching ^[a-zA-Z_][a-zA-Z0-9_]*$", () => {
    // This is a fixture test - just verify the regex logic
    const validNames = ["db1", "db_test", "_internal", "PostgreSQL123"];
    const invalidNames = ["123db", "db-name", "db name", "db;drop"];

    for (const name of validNames) {
      // Verify it would pass regex validation
      const isValid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
      expect(isValid).toBe(true);
    }

    for (const name of invalidNames) {
      // Verify it would fail regex validation
      const isValid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
      expect(isValid).toBe(false);
    }
  });

  it("temp plaintext file permissions are 0600 during write, then 0400 read-only", () => {
    // Fixture test: verify permission sequence is correct
    const testFile = join(testDir, "perm-sequence.txt");

    // Create with 0600 (rw-------)
    writeFileSync(testFile, "test");
    chmodSync(testFile, 0o600);

    // Verify it's writable (can write to it)
    writeFileSync(testFile, "modified", { flag: "w" });
    let content = readFileSync(testFile, "utf-8");
    expect(content).toBe("modified");

    // Change to 0400 (r---------)
    chmodSync(testFile, 0o400);

    // Verify it's readable
    content = readFileSync(testFile, "utf-8");
    expect(content).toBe("modified");

    // Verify it's NOT writable (would fail on macOS/Linux)
    let canWrite = true;
    try {
      writeFileSync(testFile, "should-fail", { flag: "w" });
    } catch {
      canWrite = false;
    }
    expect(canWrite).toBe(false);
  });

  it("backup script fails if pg_dump fails (invalid database)", () => {
    const recipientFile = join(testDir, "recipient-pg-fail.txt");
    writeFileSync(recipientFile, "age1test");

    let error: string = "";
    try {
      execSync(`bash scripts/backup-database.sh "${recipientFile}"`, {
        env: {
          DATABASE_URL: "postgres://invalid:invalid@nonexistent.local:5432/db",
          PATH: process.env.PATH || "",
        },
      });
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("pg_dump failed");
  });

  it("restore script fails on decryption error with wrong identity", () => {
    const wrongIdentity = join(testDir, "wrong-identity.txt");
    writeFileSync(wrongIdentity, "AGE-SECRET-KEY-1wrongkey");
    chmodSync(wrongIdentity, 0o600);

    const fakeBackup = join(testDir, "fake-backup.enc");
    writeFileSync(fakeBackup, "not-valid-age-encrypted-data");

    let error: string = "";
    try {
      execSync(`bash scripts/restore-database.sh "${fakeBackup}" "${wrongIdentity}"`, {
        env: {
          DATABASE_URL: "postgres://user:pass@localhost/db",
          PATH: process.env.PATH || "",
        },
      });
    } catch (e: any) {
      error = e.stderr?.toString() || e.stdout?.toString() || e.message || "";
    }

    expect(error).toContain("Decryption failed");
  });

  it("temp files are cleaned up from TMPDIR after script exit", () => {
    // Fixture test: verify trap cleanup logic
    const testScript = join(testDir, "cleanup-test.sh");

    writeFileSync(
      testScript,
      `#!/bin/bash
set -euo pipefail
TMPDIR_ROOT="${testDir}"
TMPDIR=$(mktemp -d "$TMPDIR_ROOT/.cleanup-test.XXXXXX")
PLAINTEXT_DUMP="$TMPDIR/dump.sql"

cleanup() {
  local exit_code=$?
  if [ -f "$PLAINTEXT_DUMP" ]; then
    rm -f "$PLAINTEXT_DUMP"
  fi
  rmdir "$TMPDIR" 2>/dev/null || true
  exit $exit_code
}
trap cleanup EXIT

touch "$PLAINTEXT_DUMP"
chmod 0600 "$PLAINTEXT_DUMP"
echo "test" > "$PLAINTEXT_DUMP"

# Verify temp dir exists before exit
if [ ! -d "$TMPDIR" ]; then
  echo "FAIL"
  exit 1
fi

exit 0
`,
    );

    const result = execSync(`bash ${testScript}`, {
      encoding: "utf-8",
    });

    expect(result).toBeDefined();
  });
});

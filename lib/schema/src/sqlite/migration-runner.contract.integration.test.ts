import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migration-runner.js";

// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function openTempDatabase(): { db: Database.Database; dbPath: string } {
  const dir = makeTempDir("docuvia-migration-db-");
  const dbPath = path.join(dir, "local.db");
  return { db: new Database(dbPath), dbPath };
}

function writeMigration(dir: string, filename: string, sql: string): void {
  fs.writeFileSync(path.join(dir, filename), sql, "utf8");
}

function migrationLedger(db: Database.Database): string[] {
  return (
    db.prepare("SELECT filename FROM schema_migrations ORDER BY id").all() as {
      filename: string;
    }[]
  ).map((row) => row.filename);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("applyMigrations contract", () => {
  it("handles an empty migration directory and creates an empty migration ledger", () => {
    const migrationsDir = makeTempDir("docuvia-migrations-empty-");
    const { db } = openTempDatabase();

    try {
      expect(() => applyMigrations(db, migrationsDir)).not.toThrow();
      expect(migrationLedger(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("ignores non-SQL files instead of recording or executing them", () => {
    const migrationsDir = makeTempDir("docuvia-migrations-nonsql-");
    fs.writeFileSync(
      path.join(migrationsDir, "README.md"),
      "CREATE TABLE should_not_exist (id INTEGER);",
      "utf8",
    );
    const { db } = openTempDatabase();

    try {
      applyMigrations(db, migrationsDir);

      expect(migrationLedger(db)).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_exist'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("applies pending migrations in deterministic filename order", () => {
    const migrationsDir = makeTempDir("docuvia-migrations-order-");
    writeMigration(
      migrationsDir,
      "0002_insert.sql",
      "INSERT INTO ordered_items (value) VALUES ('second');",
    );
    writeMigration(
      migrationsDir,
      "0001_create.sql",
      "CREATE TABLE ordered_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO ordered_items (value) VALUES ('first');",
    );
    const { db } = openTempDatabase();

    try {
      applyMigrations(db, migrationsDir);

      expect(migrationLedger(db)).toEqual([
        "0001_create.sql",
        "0002_insert.sql",
      ]);
      expect(
        db.prepare("SELECT value FROM ordered_items ORDER BY id").all(),
      ).toEqual([{ value: "first" }, { value: "second" }]);
    } finally {
      db.close();
    }
  });

  it("rolls back all pending migration effects and ledger writes when a later migration fails", () => {
    const migrationsDir = makeTempDir("docuvia-migrations-rollback-");
    writeMigration(
      migrationsDir,
      "0001_create.sql",
      "CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO rollback_probe (value) VALUES ('created');",
    );
    writeMigration(
      migrationsDir,
      "0002_broken.sql",
      "THIS IS NOT VALID SQLITE;",
    );
    const { db } = openTempDatabase();

    try {
      expect(() => applyMigrations(db, migrationsDir)).toThrow();

      expect(migrationLedger(db)).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("produces the same normalized schema and ledger across identical fresh runs", () => {
    const migrationsDir = makeTempDir("docuvia-migrations-repeat-");
    writeMigration(
      migrationsDir,
      "0001_create.sql",
      "CREATE TABLE stable_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
    );
    writeMigration(
      migrationsDir,
      "0002_insert.sql",
      "INSERT INTO stable_items (value) VALUES ('stable');",
    );

    const run = () => {
      const { db } = openTempDatabase();
      try {
        applyMigrations(db, migrationsDir);
        return {
          ledger: migrationLedger(db),
          tableSql: (
            db
              .prepare(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stable_items'",
              )
              .get() as { sql: string }
          ).sql,
          rows: db.prepare("SELECT * FROM stable_items ORDER BY id").all(),
        };
      } finally {
        db.close();
      }
    };

    expect(run()).toEqual(run());
  });
});

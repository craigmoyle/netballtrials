import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const foundation = readFileSync(new URL('../../prisma/migrations/20261127100000_trials_persistence_foundation/migration.sql', import.meta.url), 'utf8');
const attentionAudit = readFileSync(new URL('../../prisma/migrations/20261127110000_attention_audit_foundation/migration.sql', import.meta.url), 'utf8');

describe('trial persistence migration shape', () => {
  it('removes the event deadline default after backfill and protects policy snapshots', () => {
    const backfill = foundation.indexOf('UPDATE "Event"');
    const dropDefault = foundation.indexOf('ALTER TABLE "Event" ALTER COLUMN "registrationClosesAt" DROP DEFAULT');
    expect(backfill).toBeGreaterThanOrEqual(0);
    expect(dropDefault).toBeGreaterThan(backfill);
    expect(foundation).toContain('"policyDocumentBytes" BYTEA');
    expect(foundation).toContain('"policyDocumentHash" TEXT');
    expect(foundation).toContain('REFERENCES "EventPolicySnapshot"("id") ON DELETE RESTRICT');
  });

  it('keeps legacy roster snapshots free of guardian PII and date of birth', () => {
    const rosterInsert = foundation.slice(
      foundation.indexOf('INSERT INTO "RosterSnapshot"'),
      foundation.indexOf('CREATE TABLE "AuditEvent"'),
    );
    expect(rosterInsert).not.toMatch(/dateOfBirth|parentName|parentEmail|parentMobile/);
    expect(rosterInsert).toMatch(/playerFirstName/);
    expect(rosterInsert).toMatch(/bibNumber/);
  });

  it('preserves audit actors and registration removal invariants', () => {
    expect(foundation).toContain('"actorEmailSnapshot" TEXT');
    expect(foundation).toContain('CREATE TRIGGER "AuditEvent_capture_actor_email_trigger"');
    expect(foundation).toContain('"Registration_removalReason_check"');
    expect(foundation).toContain('"Registration_other_removal_note_check"');
    expect(foundation).toContain('"Registration_duplicate_removal_check"');
  });

  it('nulls registration review links and recreates a non-null partial unique index', () => {
    expect(attentionAudit).toContain('ON DELETE SET NULL');
    expect(attentionAudit).toContain('ON "ReviewItem"("registrationId", "reason")');
    expect(attentionAudit).toContain('WHERE "registrationId" IS NOT NULL');
  });
});

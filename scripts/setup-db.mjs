/**
 * setup-db.mjs  — pure Node.js ESM, no tsx needed
 * Creates the `cap` schema + all tables in Supabase.
 * Run: node scripts/setup-db.mjs
 *
 * Uses port 5432 (direct, not pooler) for DDL which doesn't work over PgBouncer.
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const postgres = require("postgres");

// ── load .env.local manually ──────────────────────────────────────────
const envPath = join(__dirname, "..", ".env.local");
const envRaw = readFileSync(envPath, "utf8");
for (const line of envRaw.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not found in .env.local");
  process.exit(1);
}

// Switch from port 6543 (transaction pooler) to port 5432 (session pooler) for DDL.
// Session pooler supports CREATE TABLE / DDL; transaction pooler does not.
DATABASE_URL = DATABASE_URL.replace(":6543/", ":5432/");
console.log("Using Supabase session pooler (port 5432) for DDL…");

const sql = postgres(DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: "require",
  connect_timeout: 30,
  idle_timeout: 20,
});

const STATEMENTS = [
  `CREATE SCHEMA IF NOT EXISTS cap`,

  `CREATE TABLE IF NOT EXISTS cap.admin_users (
    id          varchar(64)  PRIMARY KEY,
    email       text         NOT NULL UNIQUE,
    name        text         NOT NULL,
    role        text         NOT NULL CHECK (role IN ('super_admin','reviewer','viewer')),
    is_active   boolean      NOT NULL DEFAULT true,
    created_at  timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.participants (
    id              varchar(36)  PRIMARY KEY,
    user_id         varchar(64),
    name            text         NOT NULL,
    email           text         NOT NULL UNIQUE,
    phone           text,
    college         text         NOT NULL,
    branch          text,
    year            text,
    city            text,
    roll_number     text         NOT NULL DEFAULT '',
    social_handles  jsonb,
    status          text         NOT NULL DEFAULT 'Pending Approval',
    total_points    integer      NOT NULL DEFAULT 0,
    rank            integer,
    terms_accepted_at timestamptz,
    deleted_at      timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.tasks (
    id                     varchar(64)  PRIMARY KEY,
    title                  text         NOT NULL,
    description            text,
    type                   text         NOT NULL DEFAULT 'proof_link',
    max_points             integer      NOT NULL CHECK (max_points > 0),
    assigned_to            text         NOT NULL DEFAULT 'all',
    deadline               timestamptz  NOT NULL,
    grace_minutes          integer      NOT NULL DEFAULT 60,
    penalty_rate           integer      NOT NULL DEFAULT 10,
    penalty_cap            integer      NOT NULL DEFAULT 50,
    cutoff_days            integer      NOT NULL DEFAULT 3,
    correction_window_days integer      NOT NULL DEFAULT 3,
    rounding_mode          text         NOT NULL DEFAULT 'half_up',
    is_mandatory           boolean      NOT NULL DEFAULT true,
    state                  text         NOT NULL DEFAULT 'Live',
    created_by             text         NOT NULL DEFAULT 'system',
    created_at             timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.task_assignments (
    task_id               varchar(64)  NOT NULL REFERENCES cap.tasks(id),
    participant_id        varchar(36)  NOT NULL REFERENCES cap.participants(id),
    effective_deadline_at timestamptz  NOT NULL,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, participant_id)
  )`,

  `CREATE TABLE IF NOT EXISTS cap.submissions (
    id                   varchar(64)  PRIMARY KEY,
    task_id              varchar(64)  NOT NULL REFERENCES cap.tasks(id),
    participant_id       varchar(36)  NOT NULL REFERENCES cap.participants(id),
    drive_link           text         NOT NULL,
    link_key             text         NOT NULL,
    notes                text,
    submitted_at         timestamptz  NOT NULL,
    first_submitted_at   timestamptz  NOT NULL,
    version_no           integer      NOT NULL DEFAULT 1,
    rev                  integer      NOT NULL DEFAULT 1 CHECK (rev >= 1),
    is_late              boolean      NOT NULL DEFAULT false,
    penalty_days         integer      NOT NULL DEFAULT 0,
    penalty_points       integer      NOT NULL DEFAULT 0,
    penalty_applied      integer      NOT NULL DEFAULT 0,
    review_status        text         NOT NULL DEFAULT 'pending_review'
                           CHECK (review_status IN ('pending_review','approved','needs_changes','rejected')),
    assigned_reviewer_id varchar(64)  REFERENCES cap.admin_users(id),
    points_awarded       integer,
    final_points         integer      NOT NULL DEFAULT 0,
    correction_deadline  timestamptz,
    policy_snapshot      jsonb        NOT NULL DEFAULT '{}',
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (task_id, participant_id)
  )`,

  `CREATE TABLE IF NOT EXISTS cap.submission_versions (
    id            varchar(64)  PRIMARY KEY,
    submission_id varchar(64)  NOT NULL REFERENCES cap.submissions(id),
    version_no    integer      NOT NULL,
    drive_link    text         NOT NULL,
    link_key      text         NOT NULL,
    notes         text,
    submitted_at  timestamptz  NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (submission_id, version_no)
  )`,

  `CREATE TABLE IF NOT EXISTS cap.reviews (
    id                   varchar(64)  PRIMARY KEY,
    submission_id        varchar(64)  NOT NULL REFERENCES cap.submissions(id),
    version_no           integer      NOT NULL,
    reviewer_id          varchar(64)  NOT NULL REFERENCES cap.admin_users(id),
    decision             text         NOT NULL,
    points_awarded       integer,
    penalty_applied      integer,
    final_points         integer,
    reason_feedback      text,
    supersedes_review_id varchar(64),
    request_id           text         NOT NULL UNIQUE,
    reviewed_at          timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.extensions (
    id                varchar(64)  PRIMARY KEY,
    task_id           varchar(64)  NOT NULL REFERENCES cap.tasks(id),
    participant_id    varchar(36)  NOT NULL REFERENCES cap.participants(id),
    group_label       text,
    original_deadline timestamptz  NOT NULL,
    new_deadline      timestamptz  NOT NULL CHECK (new_deadline > original_deadline),
    reason            text         NOT NULL,
    granted_by        varchar(64)  NOT NULL REFERENCES cap.admin_users(id),
    granted_at        timestamptz  NOT NULL DEFAULT now(),
    revoked_at        timestamptz,
    revoked_by        varchar(64)  REFERENCES cap.admin_users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS cap.score_adjustments (
    id             varchar(64)  PRIMARY KEY,
    participant_id varchar(36)  NOT NULL REFERENCES cap.participants(id),
    submission_id  varchar(64)  REFERENCES cap.submissions(id),
    points_delta   integer      NOT NULL,
    reason         text         NOT NULL CHECK (length(trim(reason)) >= 10),
    adjusted_by    varchar(64)  NOT NULL REFERENCES cap.admin_users(id),
    adjusted_at    timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.leaderboard_state (
    id                   integer      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    status               text         NOT NULL DEFAULT 'live',
    frozen_at            timestamptz,
    frozen_by            varchar(64)  REFERENCES cap.admin_users(id),
    unfrozen_at          timestamptz,
    reason               text,
    published_snapshot   jsonb,
    results_announced_at timestamptz
  )`,

  `INSERT INTO cap.leaderboard_state (id) VALUES (1) ON CONFLICT DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS cap.history_audit_logs (
    id         varchar(64)  PRIMARY KEY,
    entity     text         NOT NULL,
    entity_id  text         NOT NULL,
    action     text         NOT NULL,
    old_value  jsonb,
    new_value  jsonb,
    reason     text,
    changed_by text         NOT NULL,
    request_id text,
    timestamp  timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.quizzes (
    id               varchar(64)  PRIMARY KEY,
    task_id          varchar(64)  NOT NULL REFERENCES cap.tasks(id),
    title            text         NOT NULL,
    description      text,
    duration_minutes integer      NOT NULL DEFAULT 15,
    questions        jsonb        NOT NULL DEFAULT '[]',
    created_at       timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.quiz_responses (
    id             varchar(64)  PRIMARY KEY,
    quiz_id        varchar(64)  NOT NULL REFERENCES cap.quizzes(id),
    task_id        varchar(64)  NOT NULL REFERENCES cap.tasks(id),
    participant_id varchar(36)  NOT NULL REFERENCES cap.participants(id),
    answers        jsonb        NOT NULL DEFAULT '{}',
    score          integer      NOT NULL DEFAULT 0,
    started_at     timestamptz  NOT NULL,
    submitted_at   timestamptz  NOT NULL,
    is_completed   boolean      NOT NULL DEFAULT true,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (task_id, participant_id)
  )`,

  `CREATE TABLE IF NOT EXISTS cap.faqs (
    id                    varchar(64)  PRIMARY KEY,
    "group"               text         NOT NULL,
    question              text         NOT NULL,
    answer                text         NOT NULL,
    display_order         integer      NOT NULL DEFAULT 0,
    status                text         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden')),
    requires_confirmation boolean      NOT NULL DEFAULT false,
    confirmed_by          varchar(64)  REFERENCES cap.admin_users(id),
    confirmed_at          timestamptz,
    updated_by            varchar(64)  REFERENCES cap.admin_users(id),
    updated_at            timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.benefits (
    id                    varchar(64)  PRIMARY KEY,
    title                 text         NOT NULL,
    description           text         NOT NULL,
    icon                  text         NOT NULL DEFAULT 'star',
    tier                  text         NOT NULL DEFAULT 'experience' CHECK (tier IN ('included','experience','merit_based')),
    display_order         integer      NOT NULL DEFAULT 0,
    status                text         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden')),
    requires_confirmation boolean      NOT NULL DEFAULT false,
    confirmed_by          varchar(64)  REFERENCES cap.admin_users(id),
    confirmed_at          timestamptz,
    created_at            timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.program_info_items (
    key          varchar(64)  PRIMARY KEY,
    value        text         NOT NULL,
    status       text         NOT NULL DEFAULT 'placeholder' CHECK (status IN ('confirmed','placeholder')),
    confirmed_by varchar(64)  REFERENCES cap.admin_users(id),
    confirmed_at timestamptz,
    updated_at   timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.milestones (
    id            varchar(64)  PRIMARY KEY,
    label         text         NOT NULL,
    phase         text         NOT NULL,
    start_date    timestamptz,
    end_date      timestamptz,
    is_peak       boolean      NOT NULL DEFAULT false,
    display_order integer      NOT NULL DEFAULT 0,
    status        text         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden'))
  )`,

  `CREATE TABLE IF NOT EXISTS cap.testimonials (
    id                   varchar(64)  PRIMARY KEY,
    participant_name     text         NOT NULL,
    photo_url            text,
    photo_alt            text,
    college              text,
    year                 text,
    role_or_cohort       text,
    source_label         text         NOT NULL CHECK (source_label IN ('alumni','pilot','organising_team')),
    quote                text         NOT NULL,
    verified_achievement text,
    consent_status       text         NOT NULL DEFAULT 'granted' CHECK (consent_status IN ('granted','withdrawn')),
    consent_recorded_at  timestamptz  NOT NULL DEFAULT now(),
    status               text         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden')),
    display_order        integer      NOT NULL DEFAULT 0,
    updated_by           varchar(64)  REFERENCES cap.admin_users(id),
    updated_at           timestamptz  NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cap.announcements (
    id           varchar(64)  PRIMARY KEY,
    title        text         NOT NULL,
    body         text         NOT NULL,
    status       text         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    publish_from timestamptz,
    publish_to   timestamptz,
    updated_by   varchar(64)  REFERENCES cap.admin_users(id),
    created_at   timestamptz  NOT NULL DEFAULT now()
  )`,
];

async function main() {
  try {
    console.log("Running", STATEMENTS.length, "DDL statements…\n");
    for (let i = 0; i < STATEMENTS.length; i++) {
      const stmt = STATEMENTS[i];
      const label = stmt.trim().split("\n")[0].slice(0, 60);
      process.stdout.write(`  [${i + 1}/${STATEMENTS.length}] ${label}… `);
      await sql.unsafe(stmt);
      console.log("✓");
    }

    // Seed super admin
    const adminEmail = process.env.SUPER_ADMIN_EMAIL;
    if (adminEmail) {
      const safe = adminEmail.replace(/'/g, "''");
      await sql.unsafe(
        `INSERT INTO cap.admin_users (id, email, name, role, is_active)
         VALUES ('admin-super-1', '${safe}', 'Super Admin', 'super_admin', true)
         ON CONFLICT (email) DO NOTHING`
      );
      console.log(`\n✓ Super admin seeded: ${adminEmail}`);
    }

    // List tables created
    const tables = await sql.unsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'cap' ORDER BY table_name`
    );
    console.log(`\n✅ Done! ${tables.length} tables in 'cap' schema:`);
    tables.forEach((t) => console.log("  -", t.table_name));
    console.log("\nRegistration data will now be saved to Supabase.");
  } catch (err) {
    console.error("\n❌ Setup failed:", err?.message || err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();

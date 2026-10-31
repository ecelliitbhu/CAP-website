/* eslint-disable @typescript-eslint/no-require-imports */
const postgres = require('postgres');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
let dbUrl = '';
for (const line of env.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) {
    dbUrl = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
    break;
  }
}

if (!dbUrl) {
  console.error('DATABASE_URL not found in .env');
  process.exit(1);
}

async function seed() {
  const sql = postgres(dbUrl, { connection: { search_path: 'cap, public' } });

  try {
    console.log('Connecting to database...');

    // 1. Seed Tasks
    console.log('Seeding tasks...');
    const posterDeadline = new Date('2026-11-24T18:29:00.000Z');
    const quizDeadline = new Date('2026-11-27T18:29:00.000Z');

    await sql`
      INSERT INTO cap.tasks (
        id, title, description, type, max_points, assigned_to, deadline,
        grace_minutes, penalty_rate, penalty_cap, cutoff_days, correction_window_days,
        rounding_mode, is_mandatory, state, created_by
      ) VALUES
      (
        'task-poster',
        'Campus Poster Challenge',
        'Print and put up official CAP posters on campus notice boards. Submit a clear Google Drive photo link.',
        'proof_link',
        100,
        'all',
        ${posterDeadline},
        60, 10, 50, 3, 3, 'half_up', true, 'Live', 'admin-s'
      ),
      (
        'task-quiz-1',
        'Startup & Innovation Quiz',
        'Answer questions regarding startup fundamentals, incubation, and entrepreneurial ecosystems.',
        'quiz',
        50,
        'all',
        ${quizDeadline},
        60, 10, 50, 3, 3, 'half_up', true, 'Live', 'admin-s'
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        deadline = EXCLUDED.deadline,
        max_points = EXCLUDED.max_points,
        state = EXCLUDED.state;
    `;
    console.log('Tasks seeded.');

    // 2. Seed Sample Participants
    console.log('Seeding sample participants...');
    const sampleParticipants = [
      { id: 'CAP-0001', name: 'Aarav Sharma', email: 'aarav.sharma@example.com', college: 'IIT Bombay', rollNumber: '210050001', phone: '+91 98765 43210', branch: 'Computer Science', totalPoints: 0, rank: 1 },
      { id: 'CAP-0002', name: 'Riya Verma', email: 'riya.verma@example.com', college: 'BITS Pilani', rollNumber: '2021A7PS0012P', phone: '+91 98765 43211', branch: 'Electrical', totalPoints: 0, rank: 2 },
      { id: 'CAP-0003', name: 'Kabir Singh', email: 'kabir.singh@example.com', college: 'IIT Delhi', rollNumber: '2021CS10234', phone: '+91 98765 43212', branch: 'Mechanical', totalPoints: 0, rank: 3 },
      { id: 'CAP-0004', name: 'Meera Nair', email: 'meera.nair@example.com', college: 'NIT Trichy', rollNumber: '106121054', phone: '+91 98765 43213', branch: 'Information Technology', totalPoints: 0, rank: 4 },
      { id: 'CAP-0005', name: 'Dev Patel', email: 'dev.patel@example.com', college: 'IIT Roorkee', rollNumber: '21114022', phone: '+91 98765 43214', branch: 'Chemical', totalPoints: 0, rank: 5 },
    ];

    for (const p of sampleParticipants) {
      await sql`
        INSERT INTO cap.participants (
          id, name, email, phone, college, branch, roll_number, status, total_points, rank
        ) VALUES (
          ${p.id}, ${p.name}, ${p.email}, ${p.phone}, ${p.college}, ${p.branch}, ${p.rollNumber}, 'Active', ${p.totalPoints}, ${p.rank}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          college = EXCLUDED.college;
      `;
    }
    console.log('Participants seeded.');

    // 3. Seed Task Assignments
    console.log('Seeding task assignments...');
    for (const p of sampleParticipants) {
      await sql`
        INSERT INTO cap.task_assignments (task_id, participant_id, effective_deadline_at)
        VALUES ('task-poster', ${p.id}, ${posterDeadline})
        ON CONFLICT (task_id, participant_id) DO NOTHING;
      `;
      await sql`
        INSERT INTO cap.task_assignments (task_id, participant_id, effective_deadline_at)
        VALUES ('task-quiz-1', ${p.id}, ${quizDeadline})
        ON CONFLICT (task_id, participant_id) DO NOTHING;
      `;
    }
    console.log('Task assignments seeded.');

    // 4. Seed 1 Test Submission in Pending Review
    console.log('Seeding 1 test submission in Pending Review...');
    const now = new Date();
    const driveLink = 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up00/view';
    const linkKey = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up00';
    const policySnapshot = {
      deadline: posterDeadline.toISOString(),
      graceMinutes: 60,
      penaltyRate: 10,
      penaltyCap: 50,
      cutoffDays: 3,
      correctionWindowDays: 3,
      maxPoints: 100,
    };

    await sql`
      INSERT INTO cap.submissions (
        id, task_id, participant_id, drive_link, link_key, submitted_at, first_submitted_at,
        version_no, rev, is_late, penalty_days, penalty_points, penalty_applied,
        review_status, policy_snapshot
      ) VALUES (
        'sub-test-01',
        'task-poster',
        'CAP-0001',
        ${driveLink},
        ${linkKey},
        ${now},
        ${now},
        1,
        1,
        false,
        0,
        0,
        NULL,
        'pending_review',
        ${sql.json(policySnapshot)}
      )
      ON CONFLICT (id) DO UPDATE SET
        drive_link = EXCLUDED.drive_link,
        link_key = EXCLUDED.link_key,
        review_status = EXCLUDED.review_status,
        penalty_applied = NULL,
        points_awarded = NULL,
        final_points = NULL;
    `;

    // 5. Seed Submission Version
    await sql`
      INSERT INTO cap.submission_versions (
        id, submission_id, version_no, drive_link, link_key, notes, submitted_at
      ) VALUES (
        'sub-test-01-v1',
        'sub-test-01',
        1,
        ${driveLink},
        ${linkKey},
        'Attached photo of official CAP poster on main academic building noticeboard.',
        ${now}
      )
      ON CONFLICT (submission_id, version_no) DO NOTHING;
    `;

    // 6. Seed History Audit Log
    await sql`
      INSERT INTO cap.history_audit_logs (
        id, entity, entity_id, action, changed_by, reason, timestamp
      ) VALUES (
        'audit-sub-test-01',
        'submission',
        'sub-test-01',
        'submit',
        'CAP-0001',
        'Initial Drive link proof submitted by participant.',
        ${now}
      )
      ON CONFLICT (id) DO NOTHING;
    `;

    console.log('Test submission seeded successfully!');

    // Verify row counts
    const tasksCount = await sql`SELECT count(*) FROM cap.tasks`;
    const participantsCount = await sql`SELECT count(*) FROM cap.participants`;
    const submissionsCount = await sql`SELECT count(*) FROM cap.submissions`;
    const assignmentsCount = await sql`SELECT count(*) FROM cap.task_assignments`;
    console.log('\nFinal Database Counts:');
    console.log('  Tasks:', tasksCount[0].count);
    console.log('  Participants:', participantsCount[0].count);
    console.log('  Task Assignments:', assignmentsCount[0].count);
    console.log('  Submissions:', submissionsCount[0].count);

  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    await sql.end();
  }
}

seed();

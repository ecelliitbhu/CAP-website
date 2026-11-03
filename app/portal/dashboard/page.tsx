"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "../portal.module.css";
import type { ParticipantTaskView } from "@/lib/repositories/types";
import type { Participant } from "@/lib/admin/types";

const formatIST = (dateString?: string | null) => {
  if (!dateString) return "N/A";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateString));
};

function isValidDriveUrl(url: string): boolean {
  if (!url) return false;
  return /drive\.google\.com\/(file\/d\/|open\?id=|folderview\?id=|drive\/folders\/)/i.test(url.trim());
}

function resolveTier(rank: number | null, totalParticipants: number = 312): "legend" | "avenger" | "defender" | "recruit" {
  if (!rank || rank <= 0) return "recruit";
  const pct = (rank / totalParticipants) * 100;
  if (pct <= 5) return "legend";
  if (pct <= 20) return "avenger";
  if (pct <= 50) return "defender";
  return "recruit";
}

export default function StudentDashboardPage() {
  const router = useRouter();

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [tasks, setTasks] = useState<ParticipantTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "action" | "review" | "completed">("all");

  // Form states per task: { [taskId]: { driveLink: string, notes: string, error?: string, success?: string } }
  const [formInputs, setFormInputs] = useState<Record<string, { driveLink: string; notes: string; error?: string; success?: string }>>({});

  const loadData = useCallback(async () => {
    try {
      const meRes = await fetch("/api/participant/me");
      const meData = await meRes.json();
      if (!meData.authenticated || !meData.participant) {
        router.replace("/portal/login");
        return;
      }
      // Gate: only Active/Accepted participants can access the dashboard
      const s = (meData.participant.status || "").toLowerCase();
      if (s !== "active" && s !== "accepted") {
        router.replace("/portal/status");
        return;
      }
      setParticipant(meData.participant);

      const tasksRes = await fetch("/api/participant/tasks");
      const tasksData = await tasksRes.json();
      if (tasksData.ok && tasksData.tasks) {
        setTasks(tasksData.tasks);
      }
    } catch {
      router.replace("/portal/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleLogout = async () => {
    try {
      await fetch("/api/participant/logout", { method: "POST" });
    } finally {
      router.push("/portal/login");
    }
  };

  const handleInputChange = (taskId: string, field: "driveLink" | "notes", value: string) => {
    setFormInputs((prev) => ({
      ...prev,
      [taskId]: {
        driveLink: field === "driveLink" ? value : prev[taskId]?.driveLink || "",
        notes: field === "notes" ? value : prev[taskId]?.notes || "",
        error: undefined,
      },
    }));
  };

  const handleSubmitProof = async (taskView: ParticipantTaskView) => {
    const input = formInputs[taskView.task.id] || { driveLink: "", notes: "" };
    const link = input.driveLink.trim();

    if (!link) {
      setFormInputs((prev) => ({
        ...prev,
        [taskView.task.id]: { ...input, error: "Please enter a valid Google Drive link." },
      }));
      return;
    }

    if (!isValidDriveUrl(link)) {
      setFormInputs((prev) => ({
        ...prev,
        [taskView.task.id]: {
          ...input,
          error: "Invalid link format. Must be a valid public Google Drive URL (file or folder).",
        },
      }));
      return;
    }

    setSubmittingTaskId(taskView.task.id);

    try {
      if (taskView.submission && taskView.submission.status === "needs_changes") {
        // Resubmission flow
        const res = await fetch(`/api/submissions/${taskView.submission.id}/resubmit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: participant?.id,
            driveLink: link,
            notes: input.notes.trim() || undefined,
            expectedRev: taskView.submission.rev,
            requestId: crypto.randomUUID(),
          }),
        });

        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error?.message || "Resubmission failed.");
        }

        setFormInputs((prev) => ({
          ...prev,
          [taskView.task.id]: {
            driveLink: "",
            notes: "",
            success: `Resubmission v${body.versionNo} successful! Your changes are now under review.`,
          },
        }));
      } else {
        // First submission flow
        const res = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: taskView.task.id,
            participantId: participant?.id,
            driveLink: link,
            notes: input.notes.trim() || undefined,
            requestId: crypto.randomUUID(),
          }),
        });

        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error?.message || "Submission failed.");
        }

        setFormInputs((prev) => ({
          ...prev,
          [taskView.task.id]: {
            driveLink: "",
            notes: "",
            success: "Task proof submitted successfully! Reviewers will evaluate your work.",
          },
        }));
      }

      // Reload tasks & metrics
      await loadData();
    } catch (err) {
      setFormInputs((prev) => ({
        ...prev,
        [taskView.task.id]: {
          ...input,
          error: err instanceof Error ? err.message : "Failed to submit. Please try again.",
        },
      }));
    } finally {
      setSubmittingTaskId(null);
    }
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const status = t.submission?.status || "missing";
      if (activeTab === "action") {
        return status === "missing" || status === "needs_changes";
      }
      if (activeTab === "review") {
        return status === "pending_review";
      }
      if (activeTab === "completed") {
        return status === "approved" || status === "rejected";
      }
      return true;
    });
  }, [tasks, activeTab]);

  const tier = useMemo(() => {
    return resolveTier(participant?.rank ?? null);
  }, [participant]);

  if (loading || !participant) {
    return (
      <div className={styles.authPage}>
        <div className={styles.badge}>✦</div>
        <p style={{ color: "#9ca3af", fontSize: 14 }}>Loading your ambassador dashboard...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Top Sticky Navigation */}
      <nav className={styles.navBar}>
        <Link href="/" className={styles.navBrand}>
          <div className={styles.badge} style={{ width: 36, height: 36, fontSize: 16, margin: 0, borderRadius: 10 }}>
            ✦
          </div>
          <div>
            <span className={styles.navBrandText}>Campus Ambassador Portal</span>
            <span className={styles.navBrandSub}>/ Earth-616</span>
          </div>
        </Link>

        <div className={styles.navProfile}>
          <div className={styles.profilePill}>
            <span style={{ color: "#fbbf24", fontWeight: 700 }}>{participant.name}</span>
            <span style={{ color: "#6b7280" }}>•</span>
            <span style={{ color: "#9ca3af" }}>{participant.college}</span>
            <span style={{ color: "#6b7280" }}>•</span>
            <span style={{ color: "#d1d5db", fontFamily: "monospace" }}>{participant.rollNumber}</span>
          </div>

          <Link href="/#leaderboard" className={styles.buttonSecondary} style={{ padding: "8px 12px", fontSize: 12 }}>
            Public Leaderboard ↗
          </Link>

          <button
            type="button"
            className={styles.buttonDanger}
            onClick={() => void handleLogout()}
            style={{ padding: "8px 14px", fontSize: 12 }}
          >
            Log Out
          </button>
        </div>
      </nav>

      {/* Main Container */}
      <main className={styles.mainContent}>
        {/* Hero Stats Grid */}
        <section className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Total Points</span>
            <span className={styles.statValue} style={{ color: "#e5ca7e" }}>
              {participant.totalPoints}
            </span>
            <span className={styles.statMeta}>Cumulative score across all approved missions</span>
          </div>

          <div className={styles.statCard}>
            <span className={styles.statLabel}>Leaderboard Rank</span>
            <span className={styles.statValue}>
              {participant.rank ? `#${participant.rank}` : "Unranked"}
            </span>
            <span className={styles.statMeta}>Standard competition ranking (ties share rank)</span>
          </div>

          <div className={styles.statCard}>
            <span className={styles.statLabel}>Ambassador Tier</span>
            <div style={{ marginTop: 6 }}>
              <span
                className={`${styles.tierBadge} ${
                  tier === "legend"
                    ? styles.tierLegend
                    : tier === "avenger"
                    ? styles.tierAvenger
                    : tier === "defender"
                    ? styles.tierDefender
                    : styles.tierRecruit
                }`}
              >
                ✦ {tier.toUpperCase()}
              </span>
            </div>
            <span className={styles.statMeta} style={{ marginTop: 6 }}>
              {tier === "legend"
                ? "Top 5% Tier Elite"
                : tier === "avenger"
                ? "Top 20% Competitive"
                : tier === "defender"
                ? "Top 50% Active"
                : "Recruit Ambassador"}
            </span>
          </div>

          <div className={styles.statCard}>
            <span className={styles.statLabel}>Missions Completed</span>
            <span className={styles.statValue} style={{ color: "#86efac" }}>
              {tasks.filter((t) => t.submission?.status === "approved").length}
              <span style={{ fontSize: 16, color: "#6b7280", fontWeight: 400 }}> / {tasks.length}</span>
            </span>
            <span className={styles.statMeta}>
              {tasks.filter((t) => t.submission?.status === "needs_changes").length} need attention
            </span>
          </div>
        </section>

        {/* Missions Section */}
        <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Program Missions & Submissions</h2>
              <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: 13 }}>
                Review assigned tasks, deadlines, late penalty policies, and reviewer feedback.
              </p>
            </div>

            <div className={styles.filterTabs}>
              <button
                type="button"
                className={`${styles.filterTab} ${activeTab === "all" ? styles.active : ""}`}
                onClick={() => setActiveTab("all")}
              >
                All ({tasks.length})
              </button>
              <button
                type="button"
                className={`${styles.filterTab} ${activeTab === "action" ? styles.active : ""}`}
                onClick={() => setActiveTab("action")}
              >
                Action Needed ({tasks.filter((t) => !t.submission || t.submission.status === "needs_changes").length})
              </button>
              <button
                type="button"
                className={`${styles.filterTab} ${activeTab === "review" ? styles.active : ""}`}
                onClick={() => setActiveTab("review")}
              >
                Under Review ({tasks.filter((t) => t.submission?.status === "pending_review").length})
              </button>
              <button
                type="button"
                className={`${styles.filterTab} ${activeTab === "completed" ? styles.active : ""}`}
                onClick={() => setActiveTab("completed")}
              >
                Completed ({tasks.filter((t) => t.submission?.status === "approved" || t.submission?.status === "rejected").length})
              </button>
            </div>
          </div>

          {filteredTasks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
              No missions found in this category.
            </div>
          ) : (
            <div className={styles.missionList}>
              {filteredTasks.map((t) => {
                const sub = t.submission;
                const input = formInputs[t.task.id] || { driveLink: "", notes: "" };
                const isSubmitting = submittingTaskId === t.task.id;

                const status = sub?.status || "missing";
                const isApproved = status === "approved";
                const isNeedsChanges = status === "needs_changes";
                const isRejected = status === "rejected";
                const isPending = status === "pending_review";

                return (
                  <div key={t.task.id} className={styles.missionCard}>
                    {/* Header */}
                    <div className={styles.missionHeader}>
                      <div className={styles.missionTitleGroup}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <h3 className={styles.missionTitle}>{t.task.title}</h3>
                          <span
                            style={{
                              background: "rgba(212, 173, 97, 0.12)",
                              border: "1px solid rgba(212, 173, 97, 0.3)",
                              padding: "2px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#e5ca7e",
                              textTransform: "uppercase",
                            }}
                          >
                            {t.task.type === "proof_link" ? "Proof Link" : t.task.type === "quiz" ? "Auto-scored Quiz" : "Hybrid Task"}
                          </span>
                          <span style={{ fontSize: 13, color: "#9ca3af" }}>Max: <strong>{t.task.maxPoints} pts</strong></span>
                        </div>

                        <div className={styles.missionMetaRow}>
                          <span className={styles.metaItem}>
                            📅 Deadline: <strong style={{ color: "#d1d5db" }}>{formatIST(sub?.effectiveDeadline || t.task.deadline)}</strong>
                          </span>
                          <span>•</span>
                          <span className={styles.metaItem}>
                            ⏳ Grace Period: {t.task.graceMinutes}m
                          </span>
                          <span>•</span>
                          <span className={styles.metaItem}>
                            📉 Penalty Rate: {t.task.penaltyRate}%/day (max {t.task.penaltyCap}%)
                          </span>
                        </div>
                      </div>

                      {/* Status Badges */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isApproved && <span className={`${styles.statusBadge} ${styles.statusApproved}`}>✓ Approved</span>}
                        {isPending && <span className={`${styles.statusBadge} ${styles.statusPending}`}>⏳ Under Review</span>}
                        {isNeedsChanges && <span className={`${styles.statusBadge} ${styles.statusNeedsChanges}`}>⚠ Needs Changes</span>}
                        {isRejected && <span className={`${styles.statusBadge} ${styles.statusRejected}`}>✕ Rejected</span>}
                        {status === "missing" && <span className={`${styles.statusBadge} ${styles.statusMissing}`}>Not Submitted</span>}

                        {t.timing.isLocked ? (
                          <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, padding: "4px 8px", background: "rgba(239, 68, 68, 0.1)", borderRadius: 6 }}>
                            Cutoff Passed
                          </span>
                        ) : t.timing.isLate ? (
                          <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, padding: "4px 8px", background: "rgba(245, 158, 11, 0.1)", borderRadius: 6 }}>
                            Late: -{t.timing.penaltyPercent}%
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700, padding: "4px 8px", background: "rgba(16, 185, 129, 0.1)", borderRadius: 6 }}>
                            On Time
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Needs Changes Alert Box */}
                    {isNeedsChanges && (
                      <div className={styles.feedbackBox}>
                        <span className={styles.feedbackTitle}>
                          ⚠ Action Required: Reviewer Requested Changes
                        </span>
                        <p className={styles.feedbackText}>
                          &ldquo;{sub?.reviewerFeedback || "Please review and update your submission proof."}&rdquo;
                        </p>
                        {sub?.correctionDeadline && (
                          <span style={{ fontSize: 12, color: "#fdba74", marginTop: 4 }}>
                            ⏰ Correction Window Closes: <strong>{formatIST(sub.correctionDeadline)}</strong>
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                          Rule 6 Invariance: Resubmission does not reset or add to your original submission penalty.
                        </span>
                      </div>
                    )}

                    {/* Rejected Box */}
                    {isRejected && (
                      <div className={styles.errorBanner}>
                        <strong>Submission Rejected:</strong> &ldquo;{sub?.reviewerFeedback || "Did not meet submission criteria."}&rdquo;
                        <span style={{ display: "block", fontSize: 11, marginTop: 4, color: "#fca5a5" }}>
                          Final Points: 0 pts. Contact an admin if you believe this was in error.
                        </span>
                      </div>
                    )}

                    {/* Approved Box */}
                    {isApproved && (
                      <div className={styles.successBanner}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                          <div>
                            <strong>Mission Complete!</strong> Awarded: <strong>{sub?.pointsAwarded} pts</strong>
                            {Number(sub?.penaltyApplied) > 0 && (
                              <span style={{ color: "#f87171", marginLeft: 8 }}>
                                (-{sub?.penaltyApplied} pts late penalty)
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 900, color: "#86efac" }}>
                            +{sub?.finalPoints} Net Points
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Pending Review Notice */}
                    {isPending && (
                      <div className={styles.infoBanner}>
                        Your submission (version {sub?.versionNo}) is in the reviewer queue. You will receive points and feedback once evaluated.
                        {sub?.driveLink && (
                          <div style={{ marginTop: 6, fontSize: 12 }}>
                            Proof link: <a href={sub.driveLink} target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd", textDecoration: "underline" }}>{sub.driveLink}</a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Submission / Resubmission Form */}
                    {(t.canSubmit || t.canResubmit) && (
                      <div className={styles.submitForm}>
                        <div className={styles.submitFormTitle}>
                          <span>{t.canResubmit ? `Resubmit Proof (Version ${(sub?.versionNo || 1) + 1})` : "Submit Mission Proof"}</span>
                          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>Public Google Drive Link required</span>
                        </div>

                        {input.error && <div className={styles.errorBanner}>{input.error}</div>}
                        {input.success && <div className={styles.successBanner}>{input.success}</div>}

                        <div className={styles.formGroup}>
                          <label className={styles.label} htmlFor={`link-${t.task.id}`}>
                            Google Drive Proof Link *
                          </label>
                          <input
                            id={`link-${t.task.id}`}
                            type="url"
                            className={styles.input}
                            placeholder="https://drive.google.com/file/d/..."
                            value={input.driveLink}
                            onChange={(e) => handleInputChange(t.task.id, "driveLink", e.target.value)}
                            disabled={isSubmitting}
                          />
                        </div>

                        <div className={styles.formGroup}>
                          <label className={styles.label} htmlFor={`notes-${t.task.id}`}>
                            Notes / Context for Reviewer (Optional)
                          </label>
                          <textarea
                            id={`notes-${t.task.id}`}
                            className={styles.textarea}
                            placeholder="Add brief details about your submission, event numbers, or proof description..."
                            value={input.notes}
                            onChange={(e) => handleInputChange(t.task.id, "notes", e.target.value)}
                            disabled={isSubmitting}
                          />
                        </div>

                        <div className={styles.policyPreview}>
                          <span>ℹ️ Live Timing Status:</span>
                          <strong style={{ color: t.timing.isLate ? "#f59e0b" : "#10b981" }}>
                            {t.timing.label}
                          </strong>
                          {t.timing.isLate && (
                            <span>(Estimated penalty: -{t.timing.penaltyPercent}%)</span>
                          )}
                        </div>

                        <button
                          type="button"
                          className={styles.buttonPrimary}
                          onClick={() => void handleSubmitProof(t)}
                          disabled={isSubmitting}
                          style={{ alignSelf: "flex-start", width: "auto", minWidth: 180 }}
                        >
                          {isSubmitting
                            ? "Submitting Proof..."
                            : t.canResubmit
                            ? `Submit Version ${(sub?.versionNo || 1) + 1} →`
                            : "Submit Proof Link →"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}


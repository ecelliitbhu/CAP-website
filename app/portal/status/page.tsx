"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "../portal.module.css";

type AppStatus = "loading" | "pending" | "approved" | "rejected" | "unauthenticated";

// Poll every 10 seconds while status is still "pending"
const POLL_INTERVAL_MS = 10_000;

function resolveStatus(status: string | null | undefined): AppStatus {
  if (!status) return "pending";
  const s = status.toLowerCase().trim();
  if (s === "active" || s === "accepted") return "approved";
  if (s === "inactive" || s === "rejected") return "rejected";
  return "pending";
}

export default function ApplicationStatusPage() {
  const router = useRouter();
  const [appStatus, setAppStatus] = useState<AppStatus>("loading");
  const [participantName, setParticipantName] = useState<string>("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (): Promise<AppStatus> => {
    try {
      const res = await fetch("/api/participant/me", { cache: "no-store" });
      const data = await res.json() as { authenticated: boolean; participant?: { name?: string; status?: string } };

      if (!data.authenticated || !data.participant) {
        return "unauthenticated";
      }

      setParticipantName(data.participant.name || "");
      return resolveStatus(data.participant.status);
    } catch {
      return "unauthenticated";
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const status = await fetchStatus();
      if (!cancelled) setAppStatus(status);
    };

    void run();

    intervalRef.current = setInterval(async () => {
      const status = await fetchStatus();
      if (!cancelled) {
        setAppStatus(status);
        if (status !== "pending" && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchStatus]);

  const handleSignOut = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    try {
      await fetch("/api/participant/logout", { method: "POST" });
    } finally {
      router.push("/portal/login?notice=signed_out");
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────
  if (appStatus === "loading") {
    return (
      <div className={styles.authPage}>
        <div className={styles.card} style={{ textAlign: "center" }}>
          <div style={{ color: "#9ca3af", fontSize: 14 }}>Checking your application…</div>
        </div>
      </div>
    );
  }

  // ── Not authenticated ────────────────────────────────────────────────
  if (appStatus === "unauthenticated") {
    return (
      <div className={styles.authPage}>
        <div className={styles.card} style={{ textAlign: "center" }}>
          <p style={{ color: "#9ca3af", marginBottom: 20 }}>Session expired. Please sign in again.</p>
          <Link href="/portal/login" className={styles.buttonPrimary} style={{ display: "inline-block", textDecoration: "none" }}>
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  // ── Status configs ───────────────────────────────────────────────────
  const config = {
    pending: {
      icon: "🕐",
      iconBg: "rgba(234,179,8,0.12)",
      iconBorder: "rgba(234,179,8,0.4)",
      iconColor: "#fde047",
      badge: "UNDER REVIEW",
      badgeBg: "rgba(234,179,8,0.12)",
      badgeBorder: "rgba(234,179,8,0.4)",
      badgeColor: "#fde047",
      headline: "Your application is\nUnder Review",
      headlineColor: "#fde047",
      body: "Our team is currently reviewing your registration. You'll be notified once a decision has been made. This usually takes 1–3 business days.",
      cta: null,
    },
    approved: {
      icon: "✓",
      iconBg: "rgba(34,197,94,0.12)",
      iconBorder: "rgba(34,197,94,0.4)",
      iconColor: "#86efac",
      badge: "APPROVED",
      badgeBg: "rgba(34,197,94,0.12)",
      badgeBorder: "rgba(34,197,94,0.4)",
      badgeColor: "#86efac",
      headline: "Congratulations!\nYour application is Approved",
      headlineColor: "#86efac",
      body: "Welcome to the Campus Ambassador Program! You now have full access to the participant portal where you can view missions, submit tasks, and track your progress on the leaderboard.",
      cta: {
        label: "Go to Student Portal",
        href: "/portal/dashboard",
      },
    },
    rejected: {
      icon: "✕",
      iconBg: "rgba(239,68,68,0.12)",
      iconBorder: "rgba(239,68,68,0.4)",
      iconColor: "#fca5a5",
      badge: "NOT APPROVED",
      badgeBg: "rgba(239,68,68,0.12)",
      badgeBorder: "rgba(239,68,68,0.4)",
      badgeColor: "#fca5a5",
      headline: "Sorry, your application\nwas not approved",
      headlineColor: "#fca5a5",
      body: "Unfortunately your application did not meet the requirements at this time. If you believe this is a mistake or have questions, please reach out to the CAP team.",
      cta: null,
    },
  }[appStatus];

  return (
    <div className={styles.authPage}>
      <div
        className={styles.card}
        style={{
          maxWidth: 480,
          textAlign: "center",
          padding: "44px 36px 36px",
        }}
      >
        {/* Status icon */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: config.iconBg,
            border: `2px solid ${config.iconBorder}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 30,
            color: config.iconColor,
            margin: "0 auto 24px",
            boxShadow: `0 0 24px ${config.iconBg}`,
          }}
        >
          {config.icon}
        </div>

        {/* Status badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 14px",
            borderRadius: 8,
            background: config.badgeBg,
            border: `1px solid ${config.badgeBorder}`,
            color: config.badgeColor,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            marginBottom: 20,
          }}
        >
          {config.badge}
        </div>

        {/* Greeting */}
        {participantName && (
          <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>
            Hi, <strong style={{ color: "#d1d5db" }}>{participantName}</strong>
          </p>
        )}

        {/* Headline */}
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: config.headlineColor,
            margin: "0 0 16px",
            lineHeight: 1.3,
            whiteSpace: "pre-line",
          }}
        >
          {config.headline}
        </h1>

        {/* Body text */}
        <p
          style={{
            fontSize: 14,
            color: "#9ca3af",
            lineHeight: 1.7,
            margin: "0 0 28px",
          }}
        >
          {config.body}
        </p>

        {/* Live polling indicator — only while pending */}
        {appStatus === "pending" && (
          <p style={{ fontSize: 11, color: "#4b5563", marginBottom: 24, letterSpacing: "0.04em" }}>
            <span style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#fde047",
              marginRight: 6,
              verticalAlign: "middle",
              animation: "pulse 2s infinite",
            }} />
            Checking for updates automatically…
          </p>
        )}

        {/* CTA — only for approved */}
        {config.cta && (
          <Link
            href={config.cta.href}
            className={styles.buttonPrimary}
            style={{ display: "block", textDecoration: "none", marginBottom: 20 }}
          >
            {config.cta.label} →
          </Link>
        )}

        {/* Sign out button — styled and visible */}
        <button
          onClick={handleSignOut}
          className={styles.buttonSecondary}
          style={{ width: "100%", justifyContent: "center" }}
        >
          Sign Out
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

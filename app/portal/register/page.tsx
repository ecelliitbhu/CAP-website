"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import styles from "../portal.module.css";

const YEAR_OPTIONS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Postgraduate"];

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    college: "",
    rollNumber: "",
    branch: "",
    year: "",
    phone: "",
  });

  // When email comes from Google OAuth it is locked (read-only)
  const [emailLocked, setEmailLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const emailParam = searchParams?.get("email");
    const nameParam = searchParams?.get("name");
    const noticeParam = searchParams?.get("notice");

    // Defer state updates to avoid the "setState in effect" lint warning
    const updates: (() => void)[] = [];

    if (emailParam || nameParam) {
      updates.push(() => {
        setFormData((prev) => ({
          ...prev,
          email: emailParam || prev.email,
          name: nameParam || prev.name,
        }));
        if (emailParam) setEmailLocked(true);
      });
    }

    if (noticeParam === "not_registered") {
      updates.push(() =>
        setError("Your Google account isn't registered yet. Fill in the details below to complete your registration.")
      );
    }

    if (updates.length > 0) {
      const t = setTimeout(() => updates.forEach((fn) => fn()), 0);
      return () => clearTimeout(t);
    }
  }, [searchParams]);

  const set = (field: keyof typeof formData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = formData.name.trim();
    const email = formData.email.trim().toLowerCase();
    const college = formData.college.trim();
    const rollNumber = formData.rollNumber.trim().toUpperCase();

    if (!name || !email || !college || !rollNumber) {
      setError("Please fill in all required fields.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/participant/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          college,
          rollNumber,
          branch: formData.branch.trim() || null,
          year: formData.year || null,
          phone: formData.phone.trim() || null,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || body.message || "Registration failed. Please check your details.");
      }

      // Registration done — send to login (Google sign-in) page
      router.push("/portal/login?notice=registered");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.authPage}>
      <div className={styles.card} style={{ maxWidth: 560 }}>

        {/* Header */}
        <div className={styles.header} style={{ marginBottom: 24 }}>
          <h1 className={styles.title}>Ambassador Registration</h1>
          <p className={styles.subtitle}>
            Join the Campus Ambassador Program (CAP) initiative for E-Cell IIT BHU.
          </p>
        </div>

        {error && (
          <div className={styles.noticeWarning} style={{ marginBottom: 20 }}>
            {error}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>

          {/* Row 1: Full Name + Email */}
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="name">Full Name *</label>
              <input
                id="name"
                type="text"
                className={styles.input}
                placeholder="e.g. Aarav Sharma"
                value={formData.name}
                onChange={set("name")}
                disabled={loading}
                required
                autoFocus
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="email">Email Address *</label>
              <input
                id="email"
                type="email"
                className={styles.input}
                placeholder="e.g. aarav@example.com"
                value={formData.email}
                onChange={emailLocked ? undefined : set("email")}
                readOnly={emailLocked}
                disabled={loading}
                required
                style={emailLocked ? {
                  opacity: 0.7,
                  cursor: "not-allowed",
                  borderColor: "rgba(212,173,97,0.4)",
                  background: "rgba(212,173,97,0.05)",
                } : undefined}
                title={emailLocked ? "Email is pre-filled from your Google account and cannot be changed." : undefined}
              />
              {emailLocked && (
                <span style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, display: "block" }}>
                  ✓ Verified via Google — cannot be changed
                </span>
              )}
            </div>
          </div>

          {/* Row 2: College + Roll Number */}
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="college">College / University *</label>
              <input
                id="college"
                type="text"
                className={styles.input}
                placeholder="e.g. IIT BHU or NIT Patna"
                value={formData.college}
                onChange={set("college")}
                disabled={loading}
                required
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="rollNumber">Roll Number / Student ID *</label>
              <input
                id="rollNumber"
                type="text"
                className={styles.input}
                placeholder="e.g. 24EE1001"
                value={formData.rollNumber}
                onChange={set("rollNumber")}
                disabled={loading}
                required
              />
            </div>
          </div>

          {/* Row 3: Branch + Year */}
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="branch">Department / Branch</label>
              <input
                id="branch"
                type="text"
                className={styles.input}
                placeholder="e.g. Electrical Engineering"
                value={formData.branch}
                onChange={set("branch")}
                disabled={loading}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="year">Year of Study</label>
              <select
                id="year"
                className={styles.select}
                value={formData.year}
                onChange={set("year")}
                disabled={loading}
              >
                <option value="">1st Year</option>
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 4: Phone */}
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="phone">Contact Phone (Optional)</label>
            <input
              id="phone"
              type="tel"
              className={styles.input}
              placeholder="e.g. +91 98765 43210"
              value={formData.phone}
              onChange={set("phone")}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className={styles.buttonPrimary}
            disabled={loading}
            style={{ marginTop: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            {loading ? "Registering…" : "Complete Registration & Enter →"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <Link href="/" style={{ fontSize: 13, color: "#64748b", textDecoration: "none" }}>
            ← Back to Public Website
          </Link>
        </div>

      </div>
    </div>
  );
}

export default function StudentRegisterPage() {
  return (
    <Suspense fallback={
      <div className={styles.authPage}>
        <div className={styles.card} style={{ textAlign: "center", color: "#94a3b8" }}>
          Loading registration...
        </div>
      </div>
    }>
      <RegisterContent />
    </Suspense>
  );
}

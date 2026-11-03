"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "./portal.module.css";

export default function PortalIndex() {
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/participant/me");
        const data = await res.json();
        if (data.authenticated && data.participant) {
          router.replace("/portal/status");
        } else {
          router.replace("/portal/login");
        }
      } catch {
        router.replace("/portal/login");
      }
    }
    void checkAuth();
  }, [router]);

  return (
    <div className={styles.authPage}>
      <div className={styles.badge}>✦</div>
      <p style={{ color: "#9ca3af", fontSize: 14 }}>Connecting to Campus Ambassador Portal...</p>
    </div>
  );
}


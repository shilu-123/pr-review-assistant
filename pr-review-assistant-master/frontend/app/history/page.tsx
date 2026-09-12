"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ReviewListItem {
  id: number;
  pr_url: string;
  pr_title: string;
  pr_author: string;
  additions: number;
  deletions: number;
  changed_files_count: number;
  created_at: string;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function HistoryPage() {
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/reviews`);
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const data: ReviewListItem[] = await res.json();
        setReviews(data);
      } catch (err: any) {
        setError(err.message || "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <main
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "2rem",
        fontFamily: "sans-serif",
      }}
    >
      <p>
        <Link href="/">&larr; Back</Link>
      </p>
      <h1>Review History</h1>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "#b00020" }}>{error}</p>}
      {!loading && !error && reviews.length === 0 && (
        <p style={{ color: "#555" }}>
          No reviews yet — go generate one from the home page.
        </p>
      )}

      {reviews.map((r) => (
        <Link
          key={r.id}
          href={`/history/${r.id}`}
          style={{
            display: "block",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: "1rem",
            marginBottom: "0.75rem",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <strong>{r.pr_title}</strong>
          <div style={{ color: "#555", fontSize: "0.9rem" }}>
            by {r.pr_author} &middot; +{r.additions}/-{r.deletions} &middot;{" "}
            {r.changed_files_count} file(s)
          </div>
          <div style={{ color: "#888", fontSize: "0.8rem" }}>
            {new Date(r.created_at).toLocaleString()}
          </div>
        </Link>
      ))}
    </main>
  );
}

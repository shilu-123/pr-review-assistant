"use client";

import { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";

interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
}

interface PRDiffResponse {
  title: string;
  author: string;
  body: string | null;
  base_branch: string;
  head_branch: string;
  additions: number;
  deletions: number;
  changed_files_count: number;
  files: ChangedFile[];
}

interface FileReview {
  filename: string;
  review: string;
}

interface ReviewResponse {
  summary: string;
  file_reviews: FileReview[];
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function Home() {
  const { data: session, status } = useSession();
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<PRDiffResponse | null>(null);

  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);

  async function handleFetchDiff(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDiff(null);
    setReview(null);
    setReviewError(null);
    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/fetch-diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pr_url: prUrl,
          github_token: (session as any)?.accessToken ?? null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.detail || `Request failed with status ${res.status}`
        );
      }

      const data: PRDiffResponse = await res.json();
      setDiff(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateReview() {
    if (!diff) return;

    setReviewError(null);
    setReview(null);
    setReviewLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...diff, pr_url: prUrl }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.detail || `Request failed with status ${res.status}`
        );
      }

      const data: ReviewResponse = await res.json();
      setReview(data);
    } catch (err: any) {
      setReviewError(err.message || "Something went wrong");
    } finally {
      setReviewLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "2rem",
        fontFamily: "sans-serif",
      }}
    >
      <h1>PR Review Assistant</h1>
      <p style={{ marginTop: "-0.5rem" }}>
        <Link href="/history">View past reviews &rarr;</Link>
      </p>
      <p style={{ color: "#555" }}>
        Paste a GitHub PR link to fetch its diff. (AI review comes in the
        next step.)
      </p>

      <div
        style={{
          margin: "1.5rem 0",
          padding: "1rem",
          border: "1px solid #eee",
          borderRadius: 8,
        }}
      >
        {status === "loading" && <p>Loading session...</p>}

        {status === "unauthenticated" && (
          <div>
            <p style={{ marginTop: 0 }}>
              Sign in to review PRs on private repos and get higher GitHub
              API rate limits. Public repos work without signing in too.
            </p>
            <button onClick={() => signIn("github")}>
              Sign in with GitHub
            </button>
          </div>
        )}

        {status === "authenticated" && (
          <div>
            <p style={{ marginTop: 0 }}>
              Signed in as{" "}
              <strong>{session?.user?.name || session?.user?.email}</strong>
            </p>
            <button onClick={() => signOut()}>Sign out</button>
          </div>
        )}
      </div>

      <form onSubmit={handleFetchDiff} style={{ marginBottom: "1.5rem" }}>
        <input
          type="text"
          placeholder="https://github.com/owner/repo/pull/123"
          value={prUrl}
          onChange={(e) => setPrUrl(e.target.value)}
          style={{
            width: "100%",
            padding: "0.6rem",
            marginBottom: "0.5rem",
            border: "1px solid #ccc",
            borderRadius: 6,
          }}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Fetching..." : "Fetch PR diff"}
        </button>
      </form>

      {error && (
        <p style={{ color: "#b00020", fontWeight: 600 }}>{error}</p>
      )}

      {diff && (
        <div>
          <h2 style={{ marginBottom: 0 }}>{diff.title}</h2>
          <p style={{ color: "#555", marginTop: "0.25rem" }}>
            by {diff.author} &middot; {diff.head_branch} &rarr;{" "}
            {diff.base_branch}
          </p>
          <p>
            <strong>+{diff.additions}</strong> /{" "}
            <strong style={{ color: "#b00020" }}>-{diff.deletions}</strong>{" "}
            across {diff.changed_files_count} file(s)
          </p>

          <div style={{ marginBottom: "1.5rem" }}>
            <button onClick={handleGenerateReview} disabled={reviewLoading}>
              {reviewLoading ? "Generating review..." : "Generate AI Review"}
            </button>
          </div>

          {reviewError && (
            <p style={{ color: "#b00020", fontWeight: 600 }}>{reviewError}</p>
          )}

          {review && (
            <div
              style={{
                marginBottom: "1.5rem",
                padding: "1rem",
                background: "#eef6ff",
                border: "1px solid #cfe3fb",
                borderRadius: 8,
              }}
            >
              <strong>AI Summary</strong>
              <p style={{ marginBottom: 0 }}>{review.summary}</p>
            </div>
          )}

          {diff.files.map((file) => (
            <div
              key={file.filename}
              style={{
                marginBottom: "1rem",
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: "1rem",
              }}
            >
              <div>
                <strong>{file.filename}</strong>{" "}
                <span style={{ color: "#777" }}>
                  ({file.status}, +{file.additions}/-{file.deletions})
                </span>
              </div>
              {file.patch && (
                <pre
                  style={{
                    overflowX: "auto",
                    background: "#f6f8fa",
                    padding: "0.75rem",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                    marginTop: "0.5rem",
                  }}
                >
                  {file.patch}
                </pre>
              )}

              {review &&
                (() => {
                  const fileReview = review.file_reviews.find(
                    (fr) => fr.filename === file.filename
                  );
                  if (!fileReview) return null;
                  return (
                    <div
                      style={{
                        marginTop: "0.75rem",
                        padding: "0.75rem",
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderRadius: 6,
                        whiteSpace: "pre-wrap",
                        fontSize: "0.9rem",
                      }}
                    >
                      <strong>AI Review</strong>
                      <div>{fileReview.review}</div>
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

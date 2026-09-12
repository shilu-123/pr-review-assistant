"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
}

interface FileReview {
  filename: string;
  review: string;
}

interface ReviewDetail {
  id: number;
  pr_url: string;
  pr_title: string;
  pr_author: string;
  base_branch: string;
  head_branch: string;
  additions: number;
  deletions: number;
  changed_files_count: number;
  created_at: string;
  summary: string;
  file_reviews: FileReview[];
  files: ChangedFile[];
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function ReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    async function load() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/reviews/${id}`);
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const data: ReviewDetail = await res.json();
        setReview(data);
      } catch (err: any) {
        setError(err.message || "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

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
        <Link href="/history">&larr; Back to history</Link>
      </p>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "#b00020" }}>{error}</p>}

      {review && (
        <div>
          <h1 style={{ marginBottom: 0 }}>{review.pr_title}</h1>
          <p style={{ color: "#555" }}>
            by {review.pr_author} &middot; {review.head_branch} &rarr;{" "}
            {review.base_branch} &middot;{" "}
            <a href={review.pr_url} target="_blank" rel="noreferrer">
              View on GitHub
            </a>
          </p>
          <p>
            <strong>+{review.additions}</strong> /{" "}
            <strong style={{ color: "#b00020" }}>-{review.deletions}</strong>{" "}
            across {review.changed_files_count} file(s) &middot;{" "}
            {new Date(review.created_at).toLocaleString()}
          </p>

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

          {review.files.map((file) => {
            const fileReview = review.file_reviews.find(
              (fr) => fr.filename === file.filename
            );
            return (
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
                {fileReview && (
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

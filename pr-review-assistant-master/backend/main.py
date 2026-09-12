import json
import os
import re
from datetime import datetime
from typing import Optional, List

import httpx
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()  # must run before importing database/models, which read env vars at import time

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from database import get_db, init_db

app = FastAPI(title="PR Review Assistant - Backend")


@app.on_event("startup")
async def on_startup():
    await init_db()


app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GITHUB_API = "https://api.github.com"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
MAX_PATCH_CHARS = 6000  # truncate huge diffs to keep cost/latency reasonable

PR_URL_PATTERN = re.compile(
    r"github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)"
)


class FetchDiffRequest(BaseModel):
    pr_url: str
    github_token: Optional[str] = None  # user's OAuth token from NextAuth session


class ChangedFile(BaseModel):
    filename: str
    status: str
    additions: int
    deletions: int
    changes: int
    patch: Optional[str] = None


class PRDiffResponse(BaseModel):
    title: str
    author: str
    body: Optional[str]
    base_branch: str
    head_branch: str
    additions: int
    deletions: int
    changed_files_count: int
    files: List[ChangedFile]


class FileReview(BaseModel):
    filename: str
    review: str


class ReviewRequest(PRDiffResponse):
    pr_url: str  # needed so we can store/link back to the original PR


class ReviewListItem(BaseModel):
    id: int
    pr_url: str
    pr_title: str
    pr_author: str
    additions: int
    deletions: int
    changed_files_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class ReviewDetail(ReviewListItem):
    base_branch: str
    head_branch: str
    summary: str
    file_reviews: List[FileReview]
    files: List[ChangedFile]


REVIEW_SYSTEM_PROMPT = """You are an experienced senior software engineer doing a code review.
Given a GitHub PR's title, description, and per-file diffs, produce a code review.

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{
  "summary": "2-4 sentence plain-English summary of what this PR does and your overall assessment",
  "file_reviews": [
    {"filename": "path/to/file", "review": "2-5 bullet points as a single string, each starting with '- ' and separated by newlines, covering bugs, style issues, edge cases, or good patterns worth praising. If a file looks fine, say so briefly."}
  ]
}

Be specific and reference concrete details from the diff. Do not invent issues the diff doesn't support."""


def build_review_prompt(pr: "PRDiffResponse") -> str:
    parts = [
        f"PR Title: {pr.title}",
        f"PR Description: {pr.body or '(no description provided)'}",
        f"Branch: {pr.head_branch} -> {pr.base_branch}",
        "",
        "Changed files:",
    ]
    for f in pr.files:
        patch = f.patch or "(no diff available - binary file or too large)"
        if len(patch) > MAX_PATCH_CHARS:
            patch = patch[:MAX_PATCH_CHARS] + "\n... (truncated)"
        parts.append(
            f"\n--- {f.filename} ({f.status}, +{f.additions}/-{f.deletions}) ---\n{patch}"
        )
    return "\n".join(parts)


def parse_pr_url(pr_url: str):
    match = PR_URL_PATTERN.search(pr_url.strip())
    if not match:
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not parse a PR URL. Expected format: "
                "https://github.com/{owner}/{repo}/pull/{number}"
            ),
        )
    return match.group("owner"), match.group("repo"), int(match.group("number"))


async def github_get(client: httpx.AsyncClient, url: str, token: Optional[str]):
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    resp = await client.get(url, headers=headers)

    if resp.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail="PR not found (or repo is private and no valid token was provided).",
        )
    if resp.status_code == 403:
        raise HTTPException(
            status_code=403,
            detail="GitHub API rate limit hit or access forbidden. Try signing in with GitHub.",
        )
    resp.raise_for_status()
    return resp.json()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/fetch-diff", response_model=PRDiffResponse)
async def fetch_diff(payload: FetchDiffRequest):
    owner, repo, number = parse_pr_url(payload.pr_url)

    async with httpx.AsyncClient(timeout=20.0) as client:
        pr_data = await github_get(
            client,
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{number}",
            payload.github_token,
        )
        files_data = await github_get(
            client,
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{number}/files",
            payload.github_token,
        )

    files = [
        ChangedFile(
            filename=f["filename"],
            status=f["status"],
            additions=f["additions"],
            deletions=f["deletions"],
            changes=f["changes"],
            patch=f.get("patch"),
        )
        for f in files_data
    ]

    return PRDiffResponse(
        title=pr_data["title"],
        author=pr_data["user"]["login"],
        body=pr_data.get("body"),
        base_branch=pr_data["base"]["ref"],
        head_branch=pr_data["head"]["ref"],
        additions=pr_data["additions"],
        deletions=pr_data["deletions"],
        changed_files_count=pr_data["changed_files"],
        files=files,
    )


@app.post("/api/review", response_model=ReviewDetail)
async def review_pr(payload: ReviewRequest, db: AsyncSession = Depends(get_db)):
    """
    Takes a ReviewRequest (a PRDiffResponse plus the original pr_url),
    sends it to the LLM for an AI code review, saves the result to
    Postgres, and returns the saved review (now with an id + timestamp).
    Kept as a separate step from fetch-diff so the frontend can show the
    diff immediately and only pay for/wait on the LLM call when the user
    asks for a review.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500, detail="GEMINI_API_KEY is not set on the server."
        )

    prompt = build_review_prompt(payload)

    try:
        model = genai.GenerativeModel(
            model_name=MODEL_NAME,
            system_instruction=REVIEW_SYSTEM_PROMPT,
        )
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
            ),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e}")

    raw_text = response.text or ""

    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=502,
            detail="Model did not return valid JSON. Try again, or check server logs.",
        )

    summary = parsed.get("summary", "")
    file_reviews = [
        FileReview(filename=fr.get("filename", ""), review=fr.get("review", ""))
        for fr in parsed.get("file_reviews", [])
    ]

    review_row = models.Review(
        pr_url=payload.pr_url,
        pr_title=payload.title,
        pr_author=payload.author,
        base_branch=payload.base_branch,
        head_branch=payload.head_branch,
        additions=payload.additions,
        deletions=payload.deletions,
        changed_files_count=payload.changed_files_count,
        summary=summary,
        file_reviews=[fr.model_dump() for fr in file_reviews],
        files=[f.model_dump() for f in payload.files],
    )
    db.add(review_row)
    await db.commit()
    await db.refresh(review_row)

    return ReviewDetail(
        id=review_row.id,
        pr_url=review_row.pr_url,
        pr_title=review_row.pr_title,
        pr_author=review_row.pr_author,
        additions=review_row.additions,
        deletions=review_row.deletions,
        changed_files_count=review_row.changed_files_count,
        created_at=review_row.created_at,
        base_branch=review_row.base_branch,
        head_branch=review_row.head_branch,
        summary=review_row.summary,
        file_reviews=file_reviews,
        files=payload.files,
    )


@app.get("/api/reviews", response_model=List[ReviewListItem])
async def list_reviews(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Review).order_by(models.Review.created_at.desc()))
    return result.scalars().all()


@app.get("/api/reviews/{review_id}", response_model=ReviewDetail)
async def get_review(review_id: int, db: AsyncSession = Depends(get_db)):
    row = await db.get(models.Review, review_id)
    if not row:
        raise HTTPException(status_code=404, detail="Review not found")

    return ReviewDetail(
        id=row.id,
        pr_url=row.pr_url,
        pr_title=row.pr_title,
        pr_author=row.pr_author,
        additions=row.additions,
        deletions=row.deletions,
        changed_files_count=row.changed_files_count,
        created_at=row.created_at,
        base_branch=row.base_branch,
        head_branch=row.head_branch,
        summary=row.summary,
        file_reviews=[FileReview(**fr) for fr in row.file_reviews],
        files=[ChangedFile(**f) for f in row.files],
    )

# PR Review Assistant — Architecture Notes

A short write-up of the design decisions behind this project, and why I made
them. Written to double as documentation and as a prepped answer for "walk
me through a project you built."

## What it does

Paste a GitHub PR link, and it fetches the real diff, runs it through an LLM
for a code review (a summary plus per-file comments), and saves the result
so it's browsable later in a history view. Three pieces: a Next.js frontend,
a FastAPI backend, and Postgres for storage.

## Why fetch-diff and review are separate calls

The obvious version of this app is one button: paste a link, get a review.
I split it into two steps instead — fetch the diff first, review it on a
second click — for a reason that matters more once you're not on a free
tier: **every LLM call costs money and time, but fetching a diff doesn't.**
If someone pastes three PR links just to browse them, that's free. The
review only fires when they actually want one. It also makes the UI feel
faster — the diff shows up almost instantly, instead of the whole page
waiting on an LLM round-trip before showing anything.

The trade-off is one extra click for the user. For a tool where reviews are
the expensive part, that felt like the right side to land on.

## Why structured JSON output instead of parsing free text

Early on I had two options for getting the model's review back in a usable
shape: ask it to write a review and parse the prose with regex/string
matching, or ask it to return structured data directly. I went with
structured output — Gemini's `response_mime_type: "application/json"`
forces the response into valid JSON, so the backend can deserialize it
directly into a Pydantic model instead of guessing at where one file's
comments end and the next one's begin.

I kept a markdown-fence-stripping fallback in the code even though it's not
needed for this response mode — model behavior isn't guaranteed to be
identical across model versions, and it's a five-line safety net against a
response that arrives wrapped in ` ```json ` fences anyway.

## Database design

Each review is stored as one row with the PR metadata (title, author,
branches, +/- counts), the AI-generated summary, the per-file reviews, and
the diff files themselves — all in the same row, with the per-file reviews
and files stored as JSON columns rather than normalized into their own
tables.

That's a deliberate simplification, not an oversight. A review is written
once and read as a whole — nobody queries "give me all reviews that
mentioned file X," at least not at this project's scale. Normalizing into
`reviews` / `files` / `file_reviews` tables would mean three joins to
reconstruct something that's always read together anyway. If this grew into
a real product — searching across reviews, analytics on what kinds of
issues get flagged most — that's exactly the trigger to revisit and
normalize. Denormalized-until-you-need-otherwise felt like the right
default for a v1.

Storing the diff files alongside the review (not just re-fetching from
GitHub each time) also means the history page keeps working even if the
original PR is later merged, deleted, or made private.

## Auth

GitHub OAuth via NextAuth, requesting the `repo` scope so the tool works on
private repos too, not just public ones. The access token lives in the
NextAuth session and gets passed to the backend per-request rather than
stored server-side — the backend is stateless with respect to auth, it just
forwards whatever token the frontend hands it to GitHub's API.

## Deployment shape

Frontend on Vercel, backend on Railway/Render, Postgres on Neon or
Supabase — three separate free-tier services rather than one bundled
platform. That mirrors how a real product would actually be deployed (each
piece scales and gets billed independently), which is a more honest
practice run than something like a single all-in-one platform that hides
those seams.

One real-world wrinkle worth mentioning here: Supabase's **direct**
Postgres connection is IPv6-only, which fails outright on networks that
don't route IPv6 properly. Fix was switching to Supabase's connection
pooler host, which is IPv4-compatible — a small thing, but it's the kind of
infra detail that only shows up once you're running against a real hosted
service instead of localhost.

## What I'd do differently at scale

- **Rate limiting** — right now nothing stops someone from spamming the
  review endpoint and burning through API quota. A simple per-user or
  per-IP limit would be the first thing I'd add before sharing this
  publicly.
- **Streaming the review** — right now the UI waits for the full LLM
  response before showing anything. Streaming tokens as they arrive would
  make long reviews feel much faster, at the cost of more complex frontend
  state handling.
- **Background jobs for large PRs** — very large diffs get truncated per
  file to keep the prompt a reasonable size. A queue-based approach
  (review each file as a separate job) would scale better for genuinely
  huge PRs, at the cost of needing a job runner and more moving parts.

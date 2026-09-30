# Undate — Agentic Dating Site: Draft & End-to-End Plan

## 1. What we are building (one breath)

> Paste someone's LinkedIn + public Instagram. An AI agent reads both, builds their profile (needs, hobbies, interests), then goes on real dates with every other agent. Each person gets a ranked list of who fits best.

(~200 chars, this is the "overall explanation" draft.)

## 2. The pipeline

```
LinkedIn URL ─┐
              ├─► Scrape (Apify) ─► Raw sources (stored, shown) ─► Analyst agent ─► Profile page
Instagram URL ┘                                                                        │
                                                                                       ▼
                                      Ranking ◄── Debriefs ◄── Dates (agent ↔ agent) ◄── Persona agent
```

Hard rule, enforced in code: an agent's context contains **only** the scraped LinkedIn + Instagram data for its person. No web search tool, no extra fields. Every trait in the profile cites the post / role / caption it came from, which proves the two-source rule on screen.

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router, TypeScript) + Tailwind | One repo for UI + API routes |
| Hosting | Vercel (Fluid compute, `maxDuration` 300–800s) | Live URL fast; long enough for a 25-date run |
| DB + live updates | Supabase Postgres + Realtime | Date transcripts stream into the UI as they're written |
| LinkedIn scraping | Apify `harvestapi/linkedin-profile-scraper` (no cookies needed) | Name, headline, about, experience, education, skills, posts |
| Instagram scraping | Apify `apify/instagram-profile-scraper` (+ `instagram-post-scraper` for last ~12 posts) | Bio, follower counts, captions, hashtags, locations, image URLs; `private: true` flag → reject |
| LLM provider | **Groq** via `groq-sdk` (OpenAI-compatible API) | Very fast inference → dates stream near-instantly, 300 dates finish quickly |
| Image reading | `meta-llama/llama-4-scout-17b-16e-instruct` (vision, ≤5 images per request) | Reads IG photos for hobbies / lifestyle |
| Analysis synthesis + debriefs | `openai/gpt-oss-120b` (fallback `llama-3.3-70b-versatile`) | Strongest reasoning on Groq; supports strict `json_schema` output |
| Speed-date turns | `llama-3.1-8b-instant` (or `openai/gpt-oss-20b`) | Cheap, fast, high rate limits for ~5k calls |
| Second-date turns | `llama-3.3-70b-versatile` | Better voice / depth for the footage in the video |
| Structured output | Zod schemas → Groq `response_format: { type: "json_schema" }` (or `json_object` + Zod validate + 1 retry) | Profile & debrief always parse |

Model IDs are centralized in `lib/llm/models.ts` so they can be swapped if Groq changes its catalog (check console.groq.com/docs/models on day one).

Fallback if an Apify actor fails for a profile: cache every successful scrape to `sources` table and `data/raw/*.json`; the demo never re-scrapes.

## 4. Finding the 25 people

Rules from the brief: real people, official LinkedIn + the Instagram that belongs to them, IG must be public.

- **Source:** people who agree to it (friends, classmates, colleagues, community members). Send a one-line consent message; this also makes the video safe to publish. Avoid scraping strangers into a *dating* site without their knowledge.
- **Ownership check:** IG bio links to LinkedIn / same name + same face / LinkedIn "contact info" lists the IG. Record which check passed in a `verification` field.
- **Mix:** varied professions, cities, and hobbies so rankings are interesting (not 25 software engineers).
- Keep a `people.csv` (name, linkedin_url, instagram_url, verification). The seed script reads it.
- Add a **"remove me"** link on every profile page (deletes the row). Cheap, and it shows judgment.

## 5. The analyst agent (reading a person)

Input: normalized LinkedIn JSON + IG profile + last 12 posts (captions, hashtags, locations, timestamps) + up to 5 images.

Three passes (all shown in the UI as "the agent reading"):
1. **Look** (Llama 4 Scout, vision): describe each of 5 IG images → activities, settings, objects, vibe, each tagged `ig:post[n]`. Download images server-side and send as base64 (IG CDN URLs expire and can block Groq's fetcher; keep each under 4 MB).
2. **Observations** (gpt-oss-120b): concrete facts from LinkedIn + captions + image notes, each with a source ref (`li:experience[2]`, `ig:post[5]`).
3. **Synthesis** (gpt-oss-120b, `json_schema`): a structured profile built only from the observations.

Profile schema:
```ts
{
  summary: string,                 // 2–3 sentences, their voice
  needs: Trait[],                  // what they need in a partner (e.g. "someone who respects a 60-hour startup week")
  hobbies: Trait[],
  interests: Trait[],
  values: Trait[],
  personality: { openness, conscientiousness, extraversion, agreeableness, neuroticism }, // 1–10 + one-line reason each
  lifestyle: { schedule, social_energy, travel, fitness, city },
  love_language_guess: Trait,
  green_flags: Trait[], possible_friction: Trait[],
  ideal_first_date: string,
  conversation_hooks: string[],    // what the agent will bring up on dates
  confidence: "low" | "medium" | "high"
}
Trait = { label: string, detail: string, evidence: SourceRef[], confidence: number }
```

We do **not** infer gender, orientation, religion, or ethnicity from photos. Everyone is dated/ranked against everyone on compatibility; the UI states this.

## 6. The dating harness (the core, and what the video grades)

Each person gets a **persona agent**: system prompt = their profile + raw evidence + a private goal: *"You represent {name}. Find out if this person meets {name}'s needs. Be honest, don't oversell. Stay in character."* Agents never see each other's profiles, only what is said on the date.

### Round 1 — Speed dates (all 300 pairs)
1. **Plan the date:** agent A proposes a venue from its person's interests; B accepts or counters (1 exchange). Venue is shown on the date card ("climbing gym in Bandra", "record store + coffee").
2. **Conversation:** 6 turns each, `llama-3.1-8b-instant`. A small "scene" prompt injects a moment halfway ("the waiter brings the wrong order", "a song comes on") so conversations don't all feel the same and to show how each agent reacts.
3. **Private debrief** (each side, separately, `gpt-oss-120b` with `json_schema`): scores 1–10 on `values`, `lifestyle`, `interests`, `humor/chemistry`, `needs_met`; `would_see_again: yes/maybe/no`; `best_moment` (a quote); `concern`; one-paragraph reasoning.

### Round 2 — Second dates (top 3 per person, mutual interest required)
- Longer date (10 turns each, `llama-3.3-70b-versatile`), a different activity, and agents are told what they learned last time, so they go deeper on the concerns from round 1.
- New debrief updates the scores. This is the "real date" footage for the video.

### Scoring
- `own_score(A→B)` = weighted debrief of A's agent about B (needs_met weighted 2×).
- `mutual(A,B)` = geometric mean of both directions (one-sided interest is penalized).
- `rank_score(A→B)` = 0.6·own + 0.3·mutual + 0.1·round-2 bonus.
- Each person's ranking = the other 24 sorted by `rank_score`, with the reason from the debrief.

### Cost / time / Groq rate limits
300 speed dates × ~16 calls ≈ 4.8k calls, mostly `llama-3.1-8b-instant`, plus 600 debriefs on `gpt-oss-120b`.

**Rate limits are the real constraint, not speed.** Groq's free tier caps requests/min and tokens/min per model (low for the 70B/120B models), so:
- Upgrade the Groq org to the **Developer (pay-as-you-go) tier** before the batch run; cost is a few dollars at most.
- `lib/llm/groq.ts` wraps every call with a per-model token-bucket limiter (`p-limit` + read `x-ratelimit-remaining-*` headers) and retries on 429 using `retry-after`.
- Spread load across models (speed dates on 8b, debriefs on 120b) so no single model's quota is the bottleneck.
- Keep prompts lean: persona prompt = compact profile + ~10 top evidence lines, not the raw scrape.

Expected: ~10–20 min for the full offline run with `scripts/run-all.ts`, results saved in the DB. A visitor's person does 25 speed dates + 3 second dates live (~1–3 min, Groq's speed makes the live streaming look good in the video).

## 7. Website features (every one must work)

| Route | What it does |
|---|---|
| `/` | Hero + "Add a person": paste LinkedIn + Instagram → validates URLs → creates a job |
| `/p/[id]` | **Profile page.** Live progress while running (Scraping LinkedIn ✓ → Instagram ✓ → Reading → Profile). Then: photo, headline, summary, needs / hobbies / interests / values cards with evidence chips (click → the actual post/role), personality radar, "raw sources" tab |
| `/p/[id]` "Send on dates" | Kicks off dates against the pool; date cards appear live |
| `/date/[id]` | **Date view.** Venue, chat transcript played back like messages (typing animation, speed toggle), the mid-date scene, both private debriefs side by side, scores |
| `/p/[id]/ranking` | **Ranking.** Ordered list of 24 with score bars, "why" line, link to the date |
| `/rankings` | All 25 people, top 3 each + a compatibility heatmap (25×25) |
| `/demo` | The finished 25-person run, read-only (the "demo link" deliverable) |

Guardrails: private IG → clear error; bad URL → inline error; rate limit (e.g. 5 runs/IP/day); visitor runs date against the demo pool and don't modify it.

## 8. Data model (Supabase)

```
people(id, name, linkedin_url, instagram_url, photo_url, verification, pool: 'demo'|'visitor', created_at)
sources(person_id, kind: 'linkedin'|'instagram', raw jsonb, fetched_at)
profiles(person_id, observations jsonb, profile jsonb, model, created_at)
dates(id, a_id, b_id, round: 1|2, venue, scene, transcript jsonb, debrief_a jsonb, debrief_b jsonb, score_ab, score_ba, status)
jobs(id, person_id, step, status, log jsonb)       -- drives the live progress UI via Realtime
```
Rankings are a SQL view over `dates`.

## 9. Repo layout

```
app/                 routes above
lib/scrape/          linkedin.ts, instagram.ts, normalize.ts
lib/llm/             groq.ts (client, limiter, retry, JSON helper), models.ts
lib/agents/          analyst.ts, persona.ts, date.ts, debrief.ts, prompts/
lib/rank.ts
scripts/seed.ts      reads people.csv → scrape + analyze
scripts/run-all.ts   runs round 1 + round 2 for the demo pool
data/people.csv
README.md            how it works + diagram + tech section + run locally
```

## 10. Three-hour timeline

| Time | Work |
|---|---|
| 0:00–0:20 | Scaffold Next.js + Supabase, env keys (Groq, Apify), upgrade Groq tier, test both scrapers + one Groq vision call on 1 person |
| 0:20–0:45 | Collect 25 people into `people.csv` (in parallel: start seeding scrapes as rows come in) |
| 0:45–1:15 | Analyst agent + profile page with evidence chips |
| 1:15–1:55 | Dating harness (plan → talk → scene → debrief) + date view |
| 1:55–2:10 | Ranking logic + ranking pages + heatmap; start `run-all` on the 25 |
| 2:10–2:25 | Deploy to Vercel, test visitor flow end to end with a fresh pair of links |
| 2:25–2:50 | Record + edit the video, README, submission text |
| 2:50–3:00 | Buffer: make GitHub repo public, check every link |

Cut first if late: round 2 → heatmap → personality radar. Never cut: live paste-to-profile, date view, rankings.

## 11. Video script (≤ 3:00)

| t | Shot |
|---|---|
| 0:00–0:15 | Hook: "25 real people. 25 agents. 300 first dates. Here's who fits whom." Grid of 25 faces |
| 0:15–0:50 | Paste a LinkedIn + Instagram live → progress steps → the agent's observations streaming with source refs |
| 0:50–1:20 | Profile page: needs, hobbies, interests, values; click an evidence chip → the IG post it came from |
| 1:20–2:15 | **Dates.** Agent picks venue, conversation plays, the mid-date scene, the two private debriefs disagreeing. Then a round-2 date going deeper on a concern |
| 2:15–2:45 | Rankings for one person, "why" lines; then the all-25 view + heatmap |
| 2:45–3:00 | Stack in one line, links to site / demo / repo |

## 12. Technical section (submission draft)

> LinkedIn: Apify `harvestapi/linkedin-profile-scraper` (public profile, no login cookies). Instagram: Apify `apify/instagram-profile-scraper` + `instagram-post-scraper` (public profiles only, bio + last 12 posts, captions, hashtags, images). Raw JSON is stored per person and is the only context the agents get. LLMs on Groq: Llama 4 Scout reads Instagram photos, gpt-oss-120b builds the profile and date debriefs, Llama 3.1 8B / 3.3 70B run the agent-to-agent dates. Next.js on Vercel, Supabase Postgres + Realtime.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Apify LinkedIn actor blocked / slow | Try a second actor (`dev_fusion/Linkedin-Profile-Scraper`); cache everything; seed ahead of time |
| IG returns few posts | Analyst lowers confidence and says so on the profile |
| Dates all sound the same | Venue negotiation, random scene events, persona voice drawn from their captions, debriefs that are allowed to say "no" |
| Vercel timeout on visitor run | Chunk: one function call per date, orchestrated by a job row; UI resumes from DB |
| Cost of public visitors | Rate limit per IP, 8B model for speed dates, cap at pool of 25 |
| Groq 429s / a model removed from the catalog | Central limiter + retry; model IDs in one file with a fallback per role |
| Small models break character or produce thin dates | Short, strict persona prompts; 70B for round-2 dates shown in the video; debriefs on 120B |
| JSON output fails on a model | `json_schema` where supported, else `json_object` + Zod validation + one repair retry |

# Undate: your agent dates for you

> Paste someone's LinkedIn and public Instagram. An AI agent reads both, builds their profile, then goes on real dates with every other agent on their behalf. Each person gets a ranked list of who fits them best.


---

## Contents

1. [The idea](#1-the-idea)
2. [The two-sources rule](#2-the-two-sources-rule)
3. [End-to-end pipeline](#3-end-to-end-pipeline)
4. [Scraping: how LinkedIn and Instagram are read](#4-scraping-how-linkedin-and-instagram-are-read)
5. [The analyst agent: reading a person](#5-the-analyst-agent-reading-a-person)
6. [The dating harness](#6-the-dating-harness)
7. [Ranking](#7-ranking)
8. [The website](#8-the-website)
9. [Architecture](#9-architecture)
10. [Data model](#10-data-model)
11. [API reference](#11-api-reference)
12. [Project structure](#12-project-structure)
13. [Running it locally](#13-running-it-locally)
14. [Building the 25-person demo](#14-building-the-25-person-demo)
15. [Deploying](#15-deploying)
16. [Models, rate limits and cost](#16-models-rate-limits-and-cost)
17. [Privacy, safety and fairness](#17-privacy-safety-and-fairness)
18. [Design decisions](#18-design-decisions)
19. [Limitations and future work](#19-limitations-and-future-work)
20. [Troubleshooting](#20-troubleshooting)

---

## 1. The idea

Every person on undate is represented by an **agent**. The agent:

1. **reads** its person from two public sources (LinkedIn + Instagram),
2. **builds a profile** of what it found: needs, hobbies, interests, values, personality and lifestyle, each backed by evidence,
3. **goes on dates** with the other agents on its person's behalf, speaking as them,
4. **writes a private debrief** after every date,
5. and together these debriefs produce a **ranking** for every person: who fits them best.

The demo pool is 25 real people, which means 300 first dates (25 × 24 / 2) plus second dates for each person's top matches. A visitor can paste any public LinkedIn + Instagram pair and send that person's agent on dates with the whole pool.

---

## 2. The two-sources rule

For every person and every agent there are exactly two sources of information: the person's **LinkedIn** and the person's **Instagram**. Nothing else. The code enforces this:

- The agents have **no tools**: no web search, no browsing. Their only context is the scraped, normalized data for their person.
- Every analysis prompt includes the rule *"use ONLY the LinkedIn and Instagram data below; do not use outside knowledge about this person, even if you recognise them"*.
- Every observation must cite a **source tag** (`li:experience[2]`, `ig:post[5]`, `ig:bio`, …). Every trait on the profile carries the tags it came from, and the UI turns them into links to the actual Instagram post or LinkedIn profile, so a reviewer can check any claim.
- During dates, an agent only knows **its own** person's profile. It learns about the other person only from what the other agent says on the date, plus the other person's name and LinkedIn headline (what a dating app would show).

---

## 3. End-to-end pipeline

```
 ┌──────────────┐   ┌───────────────┐
 │ LinkedIn URL │   │ Instagram URL │        user pastes two links
 └──────┬───────┘   └──────┬────────┘
        │   Apify actors (parallel)
        ▼                  ▼
 ┌─────────────────────────────────────┐
 │ sources: raw JSON + normalized JSON │     cached per person, never re-scraped
 └──────────────────┬──────────────────┘
                    ▼
 ┌─────────────────────────────────────┐
 │ ANALYST AGENT                       │
 │  pass 1  look   (vision, 6 photos)  │
 │  pass 2  observe (20-35 cited facts)│
 │  pass 3  profile (only from facts)  │
 └──────────────────┬──────────────────┘
                    ▼
 ┌─────────────────────────────────────┐
 │ PROFILE PAGE                        │     needs · hobbies · interests · values ·
 │                                     │     Big Five · lifestyle · flags · hooks
 └──────────────────┬──────────────────┘
                    ▼
 ┌─────────────────────────────────────┐
 │ DATES (agent ↔ agent)               │
 │  round 1: everyone × everyone       │     venue negotiation → talk → random event
 │  round 2: top-3 mutual matches      │     → two private debriefs
 └──────────────────┬──────────────────┘
                    ▼
 ┌─────────────────────────────────────┐
 │ RANKING per person                  │     0.6·own + 0.3·mutual + 0.1·second-date
 └─────────────────────────────────────┘
```

Every step writes to Postgres as it goes. The UI polls, so you watch the agent read the person live, and dates appear message by message while they happen.

---

## 4. Scraping: how LinkedIn and Instagram are read

Both scrapers run on **[Apify](https://apify.com)** through the official `apify-client` SDK ([`lib/scrape/apify.ts`](lib/scrape/apify.ts)). The two actor calls run **in parallel**.

### LinkedIn: [`harvestapi/linkedin-profile-scraper`](https://apify.com/harvestapi/linkedin-profile-scraper)

- Input: `{ urls: [profileUrl] }`. It scrapes the public profile and needs no LinkedIn login or cookies, so no account is at risk.
- Fields used: name, headline, location, about, profile photo, experience (title, company, duration, description), education, skills, languages, volunteering, certifications, featured posts, the **"interests" section** (people, companies and groups they follow), causes, projects, honours, organisations and publications.
- A different actor can be used with `APIFY_LINKEDIN_ACTOR` (e.g. `dev_fusion/Linkedin-Profile-Scraper`). The normalizer reads field names defensively, so several actors' output shapes work.

### Instagram: [`apify/instagram-profile-scraper`](https://apify.com/apify/instagram-profile-scraper)

- Input: `{ usernames: [username] }`.
- Fields used: username, full name, bio, external link, follower/following/post counts, business category, verified flag, **private flag**, HD profile picture, and the **latest 12 posts** (caption, hashtags, location name, timestamp, type, likes, image URL, permalink).
- **Private accounts are rejected** with a clear error: *"@x is a private Instagram account. Only public profiles are supported."*

### Normalization

Raw actor output is stored as-is in `sources.raw` for auditing. A normalized, actor-independent shape (`LinkedInData`, `InstagramData` in [`lib/scrape/types.ts`](lib/scrape/types.ts)) goes in `sources.normalized`. Everything downstream uses only the normalized shape.

URL parsing ([`lib/scrape/urls.ts`](lib/scrape/urls.ts)) accepts `linkedin.com/in/<slug>` (with or without `https://`, `www`, query strings) and `instagram.com/<user>`, a bare `@user`, or `user`. It rejects post/reel/explore URLs.

---

## 5. The analyst agent: reading a person

Implemented in [`lib/agents/analyst.ts`](lib/agents/analyst.ts). It runs three passes, and every step is written to the person's live log, which the UI shows as *"The agent is reading this person"*.

### Pass 1: Look (vision)

- Picks up to **6 Instagram post images**, downloads them server-side (Instagram CDN links expire and block third-party fetchers), and uses `sharp` to **downscale them to 512 px JPEG**, which cuts vision-token cost a lot.
- Sends them to `qwen/qwen3.8-27b` in **two parallel batches of 3** (Groq's per-request image limit).
- For each image it returns: `scene`, `activity`, and `signals` (sports, travel, food, pets, music, nightlife, nature, work, friends…). The prompt forbids guessing gender, orientation, religion, ethnicity or health.
- If images fail (expired URL, rate limit), analysis continues from text alone.

### Pass 2: Observe

- The LinkedIn and Instagram data are turned into a **tagged digest**, one line per fact, each with its source tag:
  ```
  [li:headline] Product designer at …
  [li:experience[1]] Senior Designer @ Acme (2 yrs) …
  [li:follows[3]] Companies: Patagonia (…)
  [ig:bio] coffee, climbing, bad puns
  [ig:post[4]] 2025-06-02 · Image · 📍Hampi · "sunrise send on …" #bouldering
  [ig:post[4] photo] person on a boulder at sunrise; climbing; signals: climbing, travel, outdoors
  ```
- `openai/gpt-oss-120b` writes **20–35 concrete observations**, each with `fact`, `source` (exact tag) and `kind` (career, education, hobby, interest, value, lifestyle, social, personality, other). The prompt pushes for specifics ("ran the Mumbai marathon 2024" beats "likes fitness") and personality cues from caption tone, humour and what the person celebrates.

### Pass 3: Profile

The profile is built **only from the observations** (not the raw data), so every claim traces back to a cited fact. Schema ([`lib/agents/schemas.ts`](lib/agents/schemas.ts)):

| Field | What it is |
|---|---|
| `summary` | 2–3 sentence portrait |
| `voice` | how the person talks and writes (used by their dating agent) |
| `needs[]` | what they need **from a partner**: emotional, practical, lifestyle |
| `hobbies[]`, `interests[]`, `values[]` | 3–6 traits each |
| `personality` | Big Five (openness, conscientiousness, extraversion, agreeableness, neuroticism), each 1–10 with a one-line reason |
| `lifestyle` | schedule, social energy, travel, fitness, base city |
| `love_language_guess` | a trait, clearly labelled as a guess |
| `green_flags[]`, `possible_friction[]` | 2–4 each |
| `ideal_first_date` | a sentence |
| `conversation_hooks[]` | 5 specific things the agent can bring up on dates |
| `confidence`, `confidence_note` | low/medium/high, plus why (e.g. "only 4 Instagram posts") |

Each **trait** is `{ label, detail, evidence: [source tags], confidence: 0–1 }`.

### Reliable structured output

All JSON steps go through `chatJson()` ([`lib/llm/groq.ts`](lib/llm/groq.ts)):

1. Call Groq in `json_object` mode.
2. Extract the JSON object and validate it with **Zod**.
3. If validation fails, send the error back to the model and ask for a corrected object (one repair retry).
4. If that also fails, try the **fallback model**.

Reading one person takes roughly **10–20 s** of LLM time on a paid Groq tier, plus 10–60 s for the Apify scrapes.

---

## 6. The dating harness

Implemented in [`lib/agents/date.ts`](lib/agents/date.ts) and orchestrated by [`lib/pipeline.ts`](lib/pipeline.ts).

### The persona agent

Each person's agent gets a system prompt built from its own profile:

- who they are, **how they talk** (`voice`), needs, hobbies, interests, values, lifestyle, possible friction, conversation hooks,
- up to 12 **real cited facts** (hobbies and values first) so it talks about real things,
- a **private goal**: *find out honestly whether this person would be good for {name}, especially whether they meet {name}'s needs*,
- honesty rules: ask real questions, react honestly, it may be unimpressed, disagree or notice a mismatch, **don't flatter**, **never invent** jobs, places or events not supported by the facts,
- conversation rules: respond to what was just said, **never repeat a question**, move somewhere new every turn (values, how they spend a Sunday, what they want in a partner, a story),
- style: 1–3 sentences (≤55 words), spoken language, an occasional `*action*`.

The agent speaks **as** its person, in the first person.

### A date, step by step

```
1. PLAN     A's agent proposes a venue + activity its person would enjoy       (gpt-oss-120b, JSON)
            B's agent accepts, or counters with something its person prefers   (gpt-oss-120b, JSON)
2. TALK     alternating turns, A first                                          (gpt-oss-20b in round 1)
3. EVENT    halfway through, a random scene is injected, e.g.
              "It suddenly starts raining and you both have to dash for cover."
              "The bill arrives and there's an awkward pause about who pays."
              "One of your phones buzzes with a work message mid-sentence."
            both agents must react in character
4. WRAP UP  the last two turns are told the date is ending: wrap up honestly,
            say whether you'd like to meet again
5. DEBRIEF  each agent privately writes a debrief for its own person           (gpt-oss-120b, JSON, in parallel)
```

Twelve possible scene events ([`SCENES`](lib/agents/date.ts)) make conversations differ and show how each agent handles pressure and awkwardness.

### The private debrief

Each agent scores the date **from its own person's point of view**:

```json
{
  "scores": { "values": 6, "lifestyle": 4, "interests": 7, "chemistry": 6, "needs_met": 5 },
  "would_see_again": "maybe",
  "best_moment": "When the rain started and they both ran into the record shop",
  "concern": "Their 6am work schedule clashes with Sam's late nights",
  "verdict": "Fun and curious, but lifestyles pull in opposite directions.",
  "reasoning": "..."
}
```

Calibration is in the prompt: **5 is neutral, 8+ must be earned, below 4 is a real mismatch, most dates are 4–7.** The two debriefs are independent, so A can love the date while B is lukewarm, and that asymmetry matters for the ranking.

Debrief → score (0–1):

```
score = (values + lifestyle + interests + chemistry + 2 × needs_met) / 60
        + 0.05 if would_see_again = "yes"
        − 0.10 if would_see_again = "no"
clamped to [0, 1]
```

`needs_met` counts double: the point of an agent is to find someone who meets its person's needs.

### Round 1: everyone dates everyone

- **Demo pool:** `npm run run-all` runs all `n(n−1)/2` pairs (300 for 25 people) with bounded concurrency. Who initiates alternates across pairs, so the same side doesn't always propose the venue. It is resumable: finished dates are skipped, half-finished ones cleaned up.
- **Visitor:** "Send their agent on dates" runs the new agent against every ready person in the demo pool (concurrency 8) in the background. Dates appear live on the profile.
- 5 turns each, so 10 messages + 2 venue lines + 1 event.

### Round 2: second dates

For each person, take round-1 partners where **neither agent said "no"**, sort by mutual score `√(own × theirs)`, and pick the **top 3** (pairs already on a second date are skipped). Second dates:

- run on the larger `gpt-oss-120b` for deeper conversation, with **8 turns each**,
- start with a **new venue**: the proposer is told where they went last time and asked for something different and more personal,
- give each agent a **memory** of its own first-date debrief (verdict, best moment, concern) and tell it to go deeper, **especially on the concern**.

### Live streaming

`runDate()` creates the `dates` row first (`status: running`), writes the transcript after **every message**, then writes both debriefs and scores (`status: done`). The date page polls every 1.5 s. A date opened while running shows lines live; a finished date replays message by message with typing delays (1×/2×/4×, skip, replay).

---

## 7. Ranking

Implemented in [`lib/rank.ts`](lib/rank.ts), computed on read from the `dates` table (never stale).

For person **A** and each person **B** they dated:

```
own(A→B)    = mean of A's agent's debrief scores about B across rounds    (0–1)
their(B→A)  = mean of B's agent's debrief scores about A across rounds    (0–1)
mutual      = √(own × their)                    geometric mean: one-sided interest is penalised
bonus       = 1   if they had a 2nd date and both agents said "yes" after it
              0.5 if they had a 2nd date
              0   otherwise

rank(A→B)   = round(100 × (0.6·own + 0.3·mutual + 0.1·bonus))
```

**Why this formula:** A's ranking should mostly reflect **what A's own agent concluded** (60%). A great match also has to be mutual (30%): someone who loves you but whom you're lukewarm about, or the reverse, shouldn't top your list. The 10% second-date bonus rewards a pairing that survived a longer, deeper date.

Rankings are **asymmetric**: B can be A's #1 while A is B's #7. Each row shows the score, A's agent's one-line verdict, whether they went on a second date, and links to the dates.

---

## 8. The website

| Route | What you see |
|---|---|
| `/` | Hero, the **paste form** (LinkedIn + Instagram), the grid of the 25, recently added visitors |
| `/p/[id]` while reading | A live **agent log**: scrape results, what it saw in each photo, observations as they're made |
| `/p/[id]` → **Profile** | Summary and voice, needs / hobbies / interests / values with **evidence chips** (click → the source post), Big Five bars, lifestyle, love language, green flags and friction, ideal first date, conversation hooks |
| `/p/[id]` → **How the agent read them** | Both sources side by side, pass 1 photo notes, all pass 2 observations with source tags, the full agent log |
| `/p/[id]` → **Dates** | Every date: partner, venue, 1st/2nd date, live "on the date now" indicator, verdict, both scores |
| `/p/[id]` → **Ranking** | The full ranked list with score bars, verdicts and links to the dates |
| `/date/[id]` | Both people, the negotiated venue (proposed / countered), the conversation as chat bubbles with the event highlighted, both **private debriefs** side by side with score breakdowns |
| `/rankings` | **Top 3 for everyone** (filterable) and a **25×25 heatmap** (rows = person, columns = their date, outlined = second date; click a cell to open the date) |
| `/how` | The pipeline explained in-product |

Visitor flow: **paste links → watch the agent read → profile page → "Send their agent on dates" → watch dates appear → ranking tab**.

---

## 9. Architecture

```
Browser (React client components, polling)
   │
   ▼
Next.js 16 on Vercel
   ├── Server components (home)  ─────────────┐
   ├── Route handlers /api/*                   │ service-role key (server only)
   │     └── after(): background work ─────────┤
   │           ├── analyzePerson()             ▼
   │           └── datePerson()           Supabase Postgres + Storage (photos)
   │                  │
   │                  ├── Apify (LinkedIn, Instagram actors)
   │                  └── Groq (qwen vision, gpt-oss-120b, gpt-oss-20b)
   │
scripts/ (local, long-running): seed.ts, run-all.ts
```

- **Background work** uses Next's `after()`: the POST returns an id at once, and the work continues in the same function invocation (`maxDuration = 300`).
- **Progress** is persisted, not streamed over a socket: the person's `log` column and the date's `transcript` column update step by step, and the UI polls. This is simple, survives page reloads, and works on serverless.
- **The large batch** (300 dates) runs from a local script, not a serverless function. It is resumable, and the results land in the same DB the site reads.
- **Supabase is only accessed server-side** with the service role key. RLS is enabled with no public policies, so the browser can't read or write the DB directly.

---

## 10. Data model

Full SQL: [`supabase/schema.sql`](supabase/schema.sql).

| Table | Key columns | Purpose |
|---|---|---|
| `people` | `id`, `name`, `headline`, `photo_url`, `linkedin_url`, `instagram_url`, `verification`, `pool` (`demo`/`visitor`), `status`, `error`, `log` (jsonb) | One row per person; `status` is `queued → scraping → reading → ready → dating → done` or `error` |
| `sources` | `(person_id, kind)`, `raw`, `normalized` | Raw actor output + normalized shape per source |
| `profiles` | `person_id`, `image_notes`, `observations`, `profile`, `models` | The three analyst passes + which models produced them |
| `dates` | `a_id`, `b_id`, `round`, `status`, `venue`, `scene`, `transcript`, `debrief_a`, `debrief_b`, `score_ab`, `score_ba` | One row per date; `debrief_a` is A's agent about B |

Profile photos are copied into a public Supabase Storage bucket `photos` (Instagram/LinkedIn image URLs expire).

---

## 11. API reference

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/api/people` | all people (id, name, headline, photo, pool, status) |
| `POST` | `/api/people` | `{ linkedin, instagram }` → `{ id }`. Validates URLs, dedupes (re-analyzes if a previous attempt failed), rate-limits to 40 new visitor people/hour, starts analysis in the background |
| `GET` | `/api/people/:id` | person, profile, normalized sources, dates, the people they dated, computed ranking |
| `DELETE` | `/api/people/:id` | "remove me": deletes a **visitor** person and their photo. Demo-pool people are removed on request |
| `POST` | `/api/people/:id/dates` | sends the agent on dates with the demo pool (409 if the profile isn't ready) |
| `GET` | `/api/dates/:id` | the date + both people |
| `GET` | `/api/rankings` | demo-pool people, every person's full ranking, date counts |

---

## 12. Project structure

```
app/
  page.tsx                 home: hero, paste form, the pool
  add-form.tsx             client form → POST /api/people
  p/[id]/person-view.tsx   profile, reading log, dates, ranking tabs
  date/[id]/date-view.tsx  date replay + debriefs
  rankings/page.tsx        top-3 grid + heatmap
  how/page.tsx             explainer
  ui.tsx                   Avatar, usePoll, ScoreBar, Dots
  api/…                    route handlers (see §11)
lib/
  scrape/apify.ts          Apify calls + tolerant normalizers
  scrape/urls.ts           LinkedIn / Instagram URL parsing
  scrape/types.ts          normalized source types
  agents/analyst.ts        look → observe → synthesize
  agents/date.ts           persona prompt, venue, conversation, debrief, scoring
  agents/schemas.ts        Zod schemas for every LLM output
  llm/groq.ts              Groq client, per-model concurrency, JSON + repair + fallback
  llm/models.ts            all model IDs in one place
  pipeline.ts              analyzePerson, runDate, datePerson, secondDates
  rank.ts                  ranking formula
  db.ts                    Supabase client + progress logging
scripts/
  check.ts                 verify Groq, Supabase tables, Apify token
  seed.ts                  data/people.csv → scrape + analyze the demo pool
  run-all.ts               all first dates + second dates for the demo pool
  test-scrape.ts           scrape one person, print what was found (no DB)
  test-analyze.ts          run the analyst on the test scrape (no DB)
  test-date.ts             run one date end to end (no DB)
supabase/schema.sql
data/people.csv            the 25 (name, linkedin_url, instagram_url, verification)
PLAN.md                    original design + plan
```

---

## 13. Running it locally

**Requirements:** Node 20+, a Supabase project, a Groq API key, an Apify account.

```bash
git clone https://github.com/rohanjain1648/undate.git
cd undate
npm install
cp .env.example .env.local
```

Fill `.env.local`:

| Variable | Where to get it |
|---|---|
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → `service_role` / secret (server only, never expose) |
| `APIFY_TOKEN` | [console.apify.com](https://console.apify.com) → Settings → API & Integrations → Personal API tokens |
| `APIFY_LINKEDIN_ACTOR` _(optional)_ | defaults to `harvestapi/linkedin-profile-scraper` |
| `APIFY_INSTAGRAM_ACTOR` _(optional)_ | defaults to `apify/instagram-profile-scraper` |
| `NEXT_PUBLIC_CONTACT_EMAIL` _(optional)_ | shows a "remove me" mail link on demo profiles |

Create the tables: **Supabase dashboard → SQL Editor → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.**

```bash
npm run check    # groq: ready · supabase people/sources/profiles/dates: ok · apify token: set
npm run dev      # http://localhost:3000
```

Quick tests without touching the DB:

```bash
npx tsx scripts/test-scrape.ts https://www.linkedin.com/in/<slug>/ https://www.instagram.com/<user>/
npx tsx scripts/test-analyze.ts   # uses data/raw/test-*.json from test-scrape
npx tsx scripts/test-date.ts      # one full date with debriefs
```

Set `DEBUG_LLM=1` to log every failed JSON attempt and its timing.

---

## 14. Building the 25-person demo

1. **Pick 25 real people**, ideally people who agreed to take part. Each needs a LinkedIn profile and an Instagram that **belongs to them** and is **public**.
2. Add them to [`data/people.csv`](data/people.csv):
   ```csv
   name,linkedin_url,instagram_url,verification
   Full Name,https://www.linkedin.com/in/<slug>/,https://www.instagram.com/<username>/,ig bio links linkedin
   ```
   `verification` records how you confirmed the Instagram is theirs (IG bio links LinkedIn, same name + photo, they confirmed, …).
3. **Scrape + analyze** (concurrency 3, cached, safe to re-run: already-ready people are skipped, failed ones retried):
   ```bash
   npm run seed
   ```
4. **Run the dates** (300 first dates, then second dates for each person's top 3):
   ```bash
   npm run run-all                    # default concurrency 8
   npm run run-all -- --concurrency 12
   npm run run-all -- --no-second     # first dates only
   ```
   Progress prints every 10 dates. If interrupted, run it again: finished dates are kept, half-finished ones are removed and re-run.
5. Open `/rankings`.

---

## 15. Deploying

**Vercel**

1. Push to GitHub, then import the repo in Vercel (framework: Next.js; the build command in `package.json` is `next build --webpack`).
2. Add the same environment variables as `.env.local`.
3. Deploy. The background routes set `maxDuration = 300`, which fits Vercel's Fluid compute limits. A visitor's 25 first dates + 3 second dates take ~1–3 minutes on a paid Groq tier.

The demo pool is built from your machine with `npm run seed` / `npm run run-all` against the same Supabase project, so the deployed site shows it straight away.

---

## 16. Models, rate limits and cost

All model IDs live in [`lib/llm/models.ts`](lib/llm/models.ts). Change them there if Groq's catalog changes (`GET https://api.groq.com/openai/v1/models`).

| Role | Model | Why |
|---|---|---|
| Photos (pass 1) | `qwen/qwen3.8-27b` | multimodal; reasoning turned off for speed |
| Observations, profile, venue planning, debriefs, second dates | `openai/gpt-oss-120b` | strongest reasoning on Groq; `reasoning_effort: low` |
| First-date turns | `openai/gpt-oss-20b` | ~0.5 s per turn, cheap enough for 3,000+ turns |
| JSON fallback | `qwen/qwen3.8-27b` | used if the primary model's JSON fails twice |

**Rate limits matter more than speed.** Groq's free tier is about 1,000 requests/day and 8,000 tokens/minute per model, far below the ~4,000 requests and several million tokens of a full 25-person run. Use the **Developer (pay-as-you-go) tier**. The client also:

- caps in-flight requests per model (`CONCURRENCY`: vision 3, 120b 6, 20b 12),
- relies on the Groq SDK's automatic retry with `retry-after` on 429/5xx (`maxRetries: 8`),
- keeps prompts lean (persona = compact profile + 12 facts, not the raw scrape) and images at 512 px.

**Rough volume for 25 people:** 25 analyses (~4 calls each) + 300 first dates (~14 calls each) + ~40 second dates (~20 calls each) ≈ **5,000 LLM calls**. On Groq's paid tier this costs a few dollars and takes roughly 10–20 minutes at the default concurrency. Apify: 25 LinkedIn + 25 Instagram profile scrapes, well within Apify's free monthly credit.

---

## 17. Privacy, safety and fairness

- **Public data only.** Private Instagram accounts are rejected. The LinkedIn scraper reads the public profile without logging in.
- **No sensitive inference.** Every analysis prompt forbids inferring gender, sexual orientation, religion, ethnicity, health or politics from photos or names, and profiles refer to people by first name or "they".
- **No orientation filter by guesswork.** Since orientation isn't inferred, **everyone dates and is ranked against everyone** on compatibility. The site says so.
- **Consent and removal.** The demo pool should be people who agreed to take part. Visitors can delete people they added ("remove me"). Demo removals go through the contact email so a visitor can't wipe the demo.
- **Honest agents.** Agents are told not to flatter, not to invent facts, and that saying no is allowed. Scores are calibrated so most dates land at 4–7.
- **Secrets** stay server-side. The browser never gets a Supabase key, and RLS blocks direct access.

---

## 18. Design decisions

- **Observations before profile.** Asking a model to "write a dating profile" directly gives generic fluff. Forcing it to first list cited facts, then build the profile only from those facts, gives specific, checkable traits, and the evidence chips come for free.
- **Agents talk turn by turn**, each with only its own person's context. One model writing a whole "conversation" would know both profiles and produce a fake-harmonious script. Separate agents can misunderstand, dodge, disagree and discover mismatches.
- **Venue negotiation + random events** make 300 dates different from each other and reveal character (who adapts, who complains, who makes a joke when the power goes out).
- **Two private debriefs per date**, not one shared score: compatibility is asymmetric, and the ranking uses that.
- **Second dates with memory** turn "they seemed nice" into "last time I worried about X; let's see", which is closer to how people actually decide.
- **Small model for first-date turns, big model for judgement.** First-date turns are many and short, so `gpt-oss-20b` handles them. Everything that decides the ranking (profiles, debriefs, second dates) uses `gpt-oss-120b`.
- **Polling over websockets.** Progress lives in the DB, so it survives reloads and serverless cold starts, and the demo can be reopened later with no live connection.

---

## 19. Limitations and future work

- **Thin profiles give thin agents.** People with few posts or a sparse LinkedIn get lower-confidence profiles (flagged on the page) and blander dates.
- **Scrapers can break.** Apify actors depend on LinkedIn/Instagram markup. The actor is configurable and the normalizer is tolerant, but a scrape can still fail; failures show on the profile with a retry path (paste again).
- **LLM judges are noisy.** One date is one sample. Second dates and the mutual term help; running 2–3 first dates per pair with different events and averaging would give more stable rankings.
- **Serverless time limits.** A visitor run must finish within `maxDuration`. For bigger pools, move dating to a queue (Inngest / Trigger.dev / a worker).
- **Future:** preference filters the person sets themselves (age range, city, orientation, entered by them, never inferred), group dates, and letting the real person read the debriefs and give feedback that tunes their agent.

---

## 20. Troubleshooting

| Symptom | Fix |
|---|---|
| `npm run check` → `Could not find the table 'public.people'` | Run `supabase/schema.sql` in the Supabase SQL Editor |
| `model_not_found` from Groq | The model was retired; update [`lib/llm/models.ts`](lib/llm/models.ts) from `GET /openai/v1/models` |
| Everything is slow / 429 "Rate limit reached … TPM" | Groq free tier; upgrade to the Developer tier or lower `CONCURRENCY` |
| `Too many images provided` | The vision model's per-request image limit changed; adjust the batch size in `lookAtImages` |
| "@x is a private Instagram account" | Expected; only public accounts are supported |
| LinkedIn scrape returns nothing | Check the URL is `linkedin.com/in/<slug>`; try `APIFY_LINKEDIN_ACTOR=dev_fusion/Linkedin-Profile-Scraper` |
| Local `next build` crashes with "memory allocation failed" | Turbopack OOM on low-RAM machines; the build script already uses `--webpack` |
| A date stuck on "on the date now" | The function was cut off; re-run `npm run run-all` (it cleans up and re-runs unfinished dates) |

---

Built with Next.js, Supabase, Apify and Groq.

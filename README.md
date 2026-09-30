# undate: your agent dates for you

Paste someone's LinkedIn and public Instagram. An AI agent reads both, builds their profile (needs, hobbies, interests, values, personality), then goes on real dates with every other agent on their behalf. Each person gets a ranked list of who fits them best.

**Two sources only.** For every person and every agent, the only information is the person's public LinkedIn and public Instagram. The agents have no web search, and every trait on a profile links back to the post or role it came from.

## How it works

```
LinkedIn URL ─┐
              ├─► Apify scrapers ─► raw + normalized sources (Supabase)
Instagram URL ┘                            │
                                           ▼
                 Analyst agent: 1) look at 6 IG photos (vision)
                                2) 20–35 cited observations
                                3) profile built only from those observations
                                           │
                                           ▼
                 Profile page: needs · hobbies · interests · values · Big Five · lifestyle · flags
                                           │
                                           ▼
                 Persona agents date: venue negotiation → conversation → random mid-date event
                                      → two private debriefs (scores + yes/maybe/no)
                 Top-3 mutual matches → longer second date (agents remember date 1 and probe their concern)
                                           │
                                           ▼
                 Ranking per person: 0.6·own agent's score + 0.3·mutual (geometric mean) + 0.1·second-date bonus
```

- Agents speak **as** their person, in their voice (inferred from caption style), grounded in cited facts, and are told to be honest rather than flattering. They never see the other person's profile, only what is said on the date.
- Debriefs are private and calibrated (5 = neutral, 8+ must be earned), so dates can fail and one-sided interest ranks lower.
- The agents never infer gender, orientation, religion or ethnicity. Everyone is ranked against everyone on compatibility.

## Tech stack

| Part | Tech |
|---|---|
| App | Next.js 16 (App Router) + Tailwind v4, deployed on Vercel |
| DB | Supabase Postgres (+ Storage for profile photos) |
| LinkedIn scraping | Apify [`harvestapi/linkedin-profile-scraper`](https://apify.com/harvestapi/linkedin-profile-scraper) (public profile, no cookies) |
| Instagram scraping | Apify [`apify/instagram-profile-scraper`](https://apify.com/apify/instagram-profile-scraper) (public profiles only: bio + latest 12 posts with captions, hashtags, locations, images) |
| LLMs (Groq) | `qwen/qwen3.8-27b` reads photos · `openai/gpt-oss-120b` builds observations/profiles, plans venues, runs second dates, writes debriefs · `openai/gpt-oss-20b` runs first-date turns |

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill GROQ_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APIFY_TOKEN
# Supabase dashboard → SQL Editor → run supabase/schema.sql
npm run check                # verifies Groq, Supabase tables, Apify token
npm run dev
```

Build the demo pool of 25:

```bash
# data/people.csv: name,linkedin_url,instagram_url,verification
npm run seed                 # scrape + analyze everyone (cached; safe to re-run)
npm run run-all              # 300 first dates + second dates for each person's top 3
```

Useful for debugging: `npx tsx scripts/test-scrape.ts <linkedin> <instagram>`, `scripts/test-analyze.ts`, `scripts/test-date.ts`.

## Pages

- `/`: paste links, see the pool of 25
- `/p/[id]`: live reading log → profile (with source links) · how the agent read them · dates · ranking
- `/date/[id]`: the date played back message by message, the mid-date event, both private debriefs
- `/rankings`: top 3 for everyone + a 25×25 compatibility heatmap
- `/how`: the pipeline explained

## Privacy

Public profiles only; private Instagram accounts are rejected. Visitors can delete a person they added ("remove me"). Scraped data is used only to build the profile shown on the site.

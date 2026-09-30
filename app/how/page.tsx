const STEPS = [
  { t: "LinkedIn + Instagram", d: "Public profiles only, scraped with Apify. These are the only two sources any agent ever sees." },
  { t: "The analyst agent reads", d: "Pass 1: a vision model looks at 6 Instagram photos. Pass 2: a reasoning model writes 20–35 observations, each citing its source (li:experience[1], ig:post[4]). Pass 3: the profile is built only from those observations." },
  { t: "Profile page", d: "Needs, hobbies, interests, values, Big Five personality, lifestyle, green flags and friction. Every trait links back to the post or role it came from." },
  { t: "The agents date", d: "Each person gets a persona agent that speaks as them. Agent A proposes a venue that suits its person; B accepts or counters. They talk; halfway through something happens (rain, wrong order, an ex walks in) and both react. Agents never see each other's profiles, only what is said." },
  { t: "Private debriefs", d: "After every date each agent privately scores the other on values, lifestyle, interests, chemistry and whether they meet its person's needs, and says yes / maybe / no to a second date." },
  { t: "Second dates", d: "Each person's top 3 mutual matches go on a longer second date. The agents remember their first-date notes and dig into the concern they had." },
  { t: "Ranking", d: "For every person: 60% how their own agent rated the date, 30% mutual interest (geometric mean of both sides, so one-sided crushes rank lower), 10% second-date bonus." },
];

export default function How() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pt-4">
      <div>
        <h1 className="font-serif text-4xl">How it works</h1>
        <p className="mt-2 text-muted">Each person is represented by an agent. That agent dates on the person&apos;s behalf. The agents date each other.</p>
      </div>
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.t} className="card flex gap-4 p-5">
            <span className="font-serif text-3xl text-gold">{i + 1}</span>
            <div>
              <h2 className="font-semibold text-gold">{s.t}</h2>
              <p className="text-sm text-cream/85">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="card space-y-2 p-5 text-sm">
        <h2 className="font-semibold text-gold">Stack</h2>
        <p className="text-cream/85">
          Next.js on Vercel · Supabase Postgres · Apify (<code>harvestapi/linkedin-profile-scraper</code>, <code>apify/instagram-profile-scraper</code>) · Groq:
          <code> qwen/qwen3.8-27b</code> reads photos, <code>openai/gpt-oss-120b</code> builds profiles, plans dates, runs second dates and writes debriefs, <code>openai/gpt-oss-20b</code> runs first-date conversations.
        </p>
        <p className="text-muted">
          Guardrails: private Instagram accounts are rejected; agents never infer gender, orientation, religion or ethnicity; everyone is ranked against everyone on compatibility.
        </p>
      </div>
    </div>
  );
}

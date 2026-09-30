"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Profile, Trait, Observations, ImageNotes, Debrief } from "@/lib/agents/schemas";
import type { InstagramData, LinkedInData } from "@/lib/scrape/types";
import type { RankRow } from "@/lib/rank";
import { Avatar, Dots, ScoreBar, seeAgainLabel, usePoll } from "../../ui";

type LogLine = { t: string; step: string; msg: string };
type Person = { id: string; name: string | null; headline: string | null; photo_url: string | null; linkedin_url: string; instagram_url: string; pool: string; status: string; error: string | null; log: LogLine[] };
type DateRow = { id: string; a_id: string; b_id: string; round: number; status: string; score_ab: number | null; score_ba: number | null; debrief_a: Debrief | null; debrief_b: Debrief | null; venue: { name: string; activity: string } | null };
type Mini = { id: string; name: string | null; headline: string | null; photo_url: string | null };
type Data = {
  person: Person;
  profile: { profile: Profile; observations: Observations; image_notes: ImageNotes | null } | null;
  sources: { linkedin?: LinkedInData; instagram?: InstagramData };
  dates: DateRow[];
  people: Mini[];
  ranking: RankRow[];
};

const BUSY = ["queued", "scraping", "reading", "dating"];
const TABS = ["profile", "reading", "dates", "ranking"] as const;
type Tab = (typeof TABS)[number];

export function PersonView({ id }: { id: string }) {
  const { data, error } = usePoll<Data>(`/api/people/${id}`, 2000, (d) => !d || BUSY.includes(d.person.status) || d.dates.some((x) => x.status === "running"));
  // Initial tab from the URL hash (e.g. /p/123#ranking). The first render is the loading state on both server and client, so no hydration mismatch.
  const [tab, setTab] = useState<Tab>(() => {
    const h = (typeof window === "undefined" ? "" : window.location.hash.slice(1)) as Tab;
    return TABS.includes(h) ? h : "profile";
  });
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  if (!data) return <div className="py-20 text-center text-muted">{error ?? <Dots />}</div>;
  const { person, profile } = data;
  const reading = ["queued", "scraping", "reading"].includes(person.status);

  return (
    <div className="space-y-6">
      <Header data={data} />
      {person.status === "error" && (
        <div className="card border-rose/60 p-4 text-sm text-rose">
          The agent couldn&apos;t read this person: {person.error}. <Link href="/" className="underline">Try other links</Link>
        </div>
      )}
      {reading || !profile ? (
        <ReadingLog log={person.log} live={reading} />
      ) : (
        <>
          <div className="flex gap-1 border-b border-line">
            {TABS.map((t) => (
              <button key={t} onClick={() => go(t)} className={`-mb-px border-b-2 px-4 py-2 text-sm capitalize ${tab === t ? "border-gold text-gold" : "border-transparent text-muted hover:text-cream"}`}>
                {t === "reading" ? "How the agent read them" : t === "dates" ? `Dates (${data.dates.length})` : t}
              </button>
            ))}
          </div>
          {tab === "profile" && <ProfileTab data={data} />}
          {tab === "reading" && <ReadingTab data={data} />}
          {tab === "dates" && <DatesTab data={data} />}
          {tab === "ranking" && <RankingTab data={data} />}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ header
function Header({ data }: { data: Data }) {
  const { person } = data;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canDate = person.pool === "visitor" && ["ready", "done"].includes(person.status) && data.dates.length === 0;

  async function sendOnDates() {
    setBusy(true);
    const res = await fetch(`/api/people/${person.id}/dates`, { method: "POST" });
    const json = await res.json();
    setMsg(res.ok ? `Dating ${json.partners ?? ""} agents…` : json.error);
    setBusy(false);
    if (res.ok) {
      window.location.hash = "dates";
      window.location.reload();
    }
  }
  async function removeMe() {
    if (!confirm("Delete this person and all their data from Undate?")) return;
    await fetch(`/api/people/${person.id}`, { method: "DELETE" });
    router.push("/");
  }

  return (
    <div className="card flex flex-col gap-5 p-6 md:flex-row md:items-center">
      <Avatar src={person.photo_url} name={person.name} size={96} />
      <div className="flex-1 space-y-2">
        <h1 className="font-serif text-4xl">{person.name ?? "Reading…"}</h1>
        {person.headline && <p className="text-muted">{person.headline}</p>}
        <div className="flex flex-wrap gap-2">
          <a className="chip" href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a>
          <a className="chip" href={person.instagram_url} target="_blank" rel="noreferrer">Instagram ↗</a>
          <span className="chip">{person.pool === "demo" ? "in the 25" : "added by a visitor"}</span>
          {data.profile && <span className="chip">analysis confidence: {data.profile.profile.confidence}</span>}
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-2">
        {canDate && (
          <button className="btn" onClick={sendOnDates} disabled={busy}>
            {busy ? "Sending…" : "Send their agent on dates →"}
          </button>
        )}
        {person.status === "dating" && (
          <span className="chip justify-center text-gold">
            on dates now <Dots />
          </span>
        )}
        {msg && <span className="text-xs text-muted">{msg}</span>}
        {person.pool === "visitor" ? (
          <button onClick={removeMe} className="text-xs text-muted underline hover:text-rose">remove me</button>
        ) : process.env.NEXT_PUBLIC_CONTACT_EMAIL ? (
          <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL}?subject=Remove%20me%20from%20Undate&body=${encodeURIComponent(person.linkedin_url)}`} className="text-center text-xs text-muted underline hover:text-rose">
            remove me
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ live reading
const STEP_LABEL: Record<string, string> = { scrape: "Scraping", look: "Looking at photos", observe: "Observing", profile: "Profiling", done: "Done", error: "Error", dates: "Dating" };

function ReadingLog({ log, live }: { log: LogLine[]; live: boolean }) {
  return (
    <div className="card p-6">
      <h2 className="mb-4 font-serif text-2xl">{live ? "The agent is reading this person" : "Agent log"} {live && <Dots />}</h2>
      <ol className="space-y-2 font-mono text-sm">
        {log.length === 0 && <li className="text-muted">Queued…</li>}
        {log.map((l, i) => (
          <li key={i} className="rise flex gap-3">
            <span className={`w-36 shrink-0 text-xs uppercase tracking-wide ${l.step === "error" ? "text-rose" : "text-gold-dim"}`}>{STEP_LABEL[l.step] ?? l.step}</span>
            <span className={l.step === "error" ? "text-rose" : "text-cream/90"}>{l.msg}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ evidence refs → links
function resolveRef(ref: string, s: Data["sources"], person: Person): { href: string; label: string } {
  const m = ref.match(/^(li|ig):([a-z_]+)(?:\[(\d+)\])?/i);
  if (!m) return { href: person.linkedin_url, label: ref };
  const [, src, field, idx] = m;
  if (src === "ig") {
    const post = idx !== undefined ? s.instagram?.posts[Number(idx)] : undefined;
    return { href: post?.url || person.instagram_url, label: field === "post" ? `IG post ${Number(idx) + 1}` : `IG ${field}` };
  }
  return { href: person.linkedin_url, label: `LinkedIn ${field}${idx !== undefined ? ` ${Number(idx) + 1}` : ""}` };
}

function Evidence({ refs, data }: { refs: string[]; data: Data }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {refs.slice(0, 4).map((r) => {
        const { href, label } = resolveRef(r, data.sources, data.person);
        return (
          <a key={r} href={href} target="_blank" rel="noreferrer" className="chip" title={r}>
            {r.startsWith("ig") ? "◎" : "in"} {label}
          </a>
        );
      })}
    </div>
  );
}

function TraitList({ title, items, data, accent = "text-gold" }: { title: string; items: Trait[]; data: Data; accent?: string }) {
  return (
    <div className="card p-5">
      <h3 className={`mb-3 font-serif text-xl ${accent}`}>{title}</h3>
      <ul className="space-y-4">
        {items.map((t, i) => (
          <li key={i}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{t.label}</span>
              <span className="text-xs text-muted">{Math.round(t.confidence * 100)}%</span>
            </div>
            <p className="text-sm text-cream/80">{t.detail}</p>
            <Evidence refs={t.evidence} data={data} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ tabs
function ProfileTab({ data }: { data: Data }) {
  const p = data.profile!.profile;
  const big5 = Object.entries(p.personality) as [string, { score: number; why: string }][];
  return (
    <div className="space-y-4">
      <div className="card p-6">
        <p className="font-serif text-xl leading-relaxed">{p.summary}</p>
        <p className="mt-3 text-sm text-muted">
          <span className="text-gold-dim">How they talk:</span> {p.voice}
        </p>
        {p.confidence_note && <p className="mt-1 text-xs text-muted">Note: {p.confidence_note}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TraitList title="Needs" items={p.needs} data={data} accent="text-rose" />
        <TraitList title="Hobbies" items={p.hobbies} data={data} />
        <TraitList title="Interests" items={p.interests} data={data} />
        <TraitList title="Values" items={p.values} data={data} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-5 md:col-span-2">
          <h3 className="mb-3 font-serif text-xl text-gold">Personality (Big Five)</h3>
          <div className="space-y-3">
            {big5.map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-sm">
                  <span className="capitalize">{k}</span>
                  <span className="text-muted">{v.score}/10</span>
                </div>
                <ScoreBar value={v.score} max={10} />
                <p className="mt-1 text-xs text-muted">{v.why}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="card space-y-3 p-5">
          <h3 className="font-serif text-xl text-gold">Lifestyle</h3>
          {Object.entries(p.lifestyle).map(([k, v]) => (
            <div key={k} className="text-sm">
              <span className="text-xs uppercase tracking-wide text-muted">{k.replace("_", " ")}</span>
              <div>{v}</div>
            </div>
          ))}
          <div className="text-sm">
            <span className="text-xs uppercase tracking-wide text-muted">love language (guess)</span>
            <div>{p.love_language_guess.label}</div>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TraitList title="Green flags" items={p.green_flags} data={data} accent="text-sage" />
        <TraitList title="Possible friction" items={p.possible_friction} data={data} accent="text-rose" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-2 font-serif text-xl text-gold">Ideal first date</h3>
          <p className="text-sm">{p.ideal_first_date}</p>
        </div>
        <div className="card p-5">
          <h3 className="mb-2 font-serif text-xl text-gold">What the agent will bring up</h3>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {p.conversation_hooks.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ReadingTab({ data }: { data: Data }) {
  const obs = data.profile!.observations.observations;
  const imgs = data.profile!.image_notes?.images ?? [];
  const li = data.sources.linkedin;
  const ig = data.sources.instagram;
  return (
    <div className="space-y-4">
      <div className="card p-5 text-sm text-muted">
        The agent reads in three passes, using <b className="text-cream">only</b> these two sources: (1) a vision model looks at Instagram photos, (2) a reasoning model writes cited observations from
        LinkedIn + Instagram, (3) the profile is built only from those observations. Every trait links back to its source.
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 font-serif text-xl text-gold">Source 1 · LinkedIn</h3>
          {li ? (
            <div className="space-y-2 text-sm">
              <div>{li.headline}</div>
              <div className="text-muted">{li.location}</div>
              {li.about && <p className="line-clamp-4 text-cream/80">{li.about}</p>}
              <div className="text-xs text-muted">
                {li.experience.length} roles · {li.education.length} schools · {li.skills.length} skills · {li.follows.length} follows
              </div>
              <ul className="space-y-1 text-xs">
                {li.experience.slice(0, 5).map((e, i) => (
                  <li key={i}>
                    <b>{e.title}</b> @ {e.company} <span className="text-muted">{e.duration}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted">—</p>
          )}
        </div>
        <div className="card p-5">
          <h3 className="mb-3 font-serif text-xl text-gold">Source 2 · Instagram</h3>
          {ig ? (
            <div className="space-y-2 text-sm">
              <div>
                @{ig.username} · {ig.followers?.toLocaleString() ?? "?"} followers
              </div>
              {ig.bio && <p className="text-cream/80">{ig.bio}</p>}
              <div className="text-xs text-muted">{ig.posts.length} recent posts read</div>
              <ul className="space-y-1 text-xs">
                {ig.posts.slice(0, 5).map((p, i) => (
                  <li key={i} className="line-clamp-1">
                    <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-gold">
                      post {i + 1}: {p.caption || "(no caption)"}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted">—</p>
          )}
        </div>
      </div>
      {imgs.length > 0 && (
        <div className="card p-5">
          <h3 className="mb-3 font-serif text-xl text-gold">Pass 1 · What the agent saw in the photos</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {imgs.map((im, i) => (
              <div key={i} className="rounded-xl border border-line/60 p-3 text-sm">
                <Evidence refs={[im.ref]} data={data} />
                <p className="mt-1">{im.scene}</p>
                {im.activity && <p className="text-xs text-muted">{im.activity}</p>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {im.signals.map((s) => (
                    <span key={s} className="chip">{s}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="card p-5">
        <h3 className="mb-3 font-serif text-xl text-gold">Pass 2 · Observations ({obs.length})</h3>
        <ul className="grid gap-2 md:grid-cols-2">
          {obs.map((o, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="chip mt-0.5 shrink-0">{o.kind}</span>
              <span>
                {o.fact} <span className="text-xs text-muted">({o.source})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ReadingLog log={data.person.log.filter((l) => l.step !== "dates")} live={false} />
    </div>
  );
}

function other(d: DateRow, me: string) {
  return d.a_id === me ? d.b_id : d.a_id;
}

function DatesTab({ data }: { data: Data }) {
  const me = data.person.id;
  const byId = Object.fromEntries(data.people.map((p) => [p.id, p]));
  const dates = [...data.dates].sort((x, y) => y.round - x.round);
  if (!dates.length)
    return <div className="card p-6 text-muted">{data.person.pool === "visitor" ? "No dates yet. Hit “Send their agent on dates” above." : "No dates yet."}</div>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {dates.map((d) => {
        const o = byId[other(d, me)];
        const iAmA = d.a_id === me;
        const mine = iAmA ? d.debrief_a : d.debrief_b;
        const own = iAmA ? d.score_ab : d.score_ba;
        const their = iAmA ? d.score_ba : d.score_ab;
        return (
          <Link key={d.id} href={`/date/${d.id}`} className="card rise flex gap-3 p-4 hover:border-gold-dim">
            <Avatar src={o?.photo_url} name={o?.name} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{o?.name}</span>
                <span className={`chip ${d.round === 2 ? "text-rose" : ""}`}>{d.round === 2 ? "2nd date" : "1st date"}</span>
              </div>
              <div className="truncate text-xs text-muted">{d.venue ? `📍 ${d.venue.name}` : "planning the date…"}</div>
              {d.status === "running" ? (
                <div className="mt-2 text-xs text-gold">
                  on the date now <Dots />
                </div>
              ) : d.status === "error" ? (
                <div className="mt-2 text-xs text-rose">date failed</div>
              ) : (
                <>
                  <p className="mt-2 line-clamp-2 text-sm">{mine?.verdict}</p>
                  <div className="mt-2 flex gap-3 text-xs text-muted">
                    <span>my agent: {Math.round((own ?? 0) * 100)}</span>
                    <span>their agent: {Math.round((their ?? 0) * 100)}</span>
                  </div>
                </>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function RankingTab({ data }: { data: Data }) {
  const byId = Object.fromEntries(data.people.map((p) => [p.id, p]));
  if (!data.ranking.length) return <div className="card p-6 text-muted">The ranking appears after the dates.</div>;
  return (
    <div className="space-y-3">
      <div className="card p-4 text-sm text-muted">
        Score = 60% how {data.person.name?.split(" ")[0]}&apos;s agent rated the date · 30% mutual interest (both sides) · 10% second-date bonus.
      </div>
      {data.ranking.map((r, i) => {
        const o = byId[r.otherId];
        return (
          <div key={r.otherId} className="card rise flex items-center gap-4 p-4" style={{ animationDelay: `${i * 30}ms` }}>
            <div className={`w-8 text-center font-serif text-2xl ${i < 3 ? "text-gold" : "text-muted"}`}>{i + 1}</div>
            <Avatar src={o?.photo_url} name={o?.name} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/p/${r.otherId}`} className="font-semibold hover:text-gold">{o?.name}</Link>
                {r.secondDate && <span className="chip text-rose">went on a 2nd date</span>}
                <span className="chip">{seeAgainLabel[r.seeAgain]}</span>
              </div>
              <p className="text-sm text-cream/80">{r.verdict}</p>
              <div className="mt-1 flex items-center gap-3">
                <div className="w-40"><ScoreBar value={r.score} /></div>
                {r.dateIds.map((d, j) => (
                  <Link key={d} href={`/date/${d}`} className="text-xs text-gold-dim hover:text-gold">
                    date {j + 1} →
                  </Link>
                ))}
              </div>
            </div>
            <div className="font-serif text-3xl text-gold">{r.score}</div>
          </div>
        );
      })}
    </div>
  );
}

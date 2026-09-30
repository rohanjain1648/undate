"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Debrief } from "@/lib/agents/schemas";
import { Avatar, Dots, ScoreBar, seeAgainLabel, usePoll } from "../../ui";

type Line = { speaker: "a" | "b" | "scene"; text: string };
type Mini = { id: string; name: string | null; headline: string | null; photo_url: string | null };
type Data = {
  date: {
    id: string;
    a_id: string;
    b_id: string;
    round: number;
    status: string;
    scene: string;
    venue: { name: string; activity: string; why: string; accepted: boolean } | null;
    transcript: Line[];
    debrief_a: Debrief | null;
    debrief_b: Debrief | null;
    score_ab: number | null;
    score_ba: number | null;
    error: string | null;
  };
  people: Mini[];
};

export function DateView({ id }: { id: string }) {
  const { data } = usePoll<Data>(`/api/dates/${id}`, 1500, (d) => !d || d.date.status === "running");
  // Replay: finished dates play back message by message; live dates show lines as they arrive.
  const [shown, setShown] = useState(0);
  const [speed, setSpeed] = useState(1);
  // A date that was already running when the page opened is shown live (every line as it arrives).
  const [openedLive, setOpenedLive] = useState<boolean | null>(null);
  if (data && openedLive === null) setOpenedLive(data.date.status === "running");
  const bottom = useRef<HTMLDivElement>(null);
  const total = data?.date.transcript.length ?? 0;
  const visible = openedLive ? total : Math.min(shown, total);
  const typing = !openedLive && visible < total;

  useEffect(() => {
    if (!data || openedLive !== false || shown >= total) return;
    const next = data.date.transcript[shown];
    const delay = next.speaker === "scene" ? 1200 : Math.min(2600, 500 + next.text.length * 18);
    const t = setTimeout(() => setShown((s) => s + 1), delay / speed);
    return () => clearTimeout(t);
  }, [data, openedLive, shown, total, speed]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [visible]);

  if (!data) return <div className="py-20 text-center text-muted"><Dots /></div>;
  const { date } = data;
  const A = data.people.find((p) => p.id === date.a_id);
  const B = data.people.find((p) => p.id === date.b_id);
  const first = (p?: Mini) => p?.name?.split(" ")[0] ?? "?";
  const lines = date.transcript.slice(0, visible);
  const done = date.status === "done" && visible >= total;
  const live = date.status === "running";

  return (
    <div className="space-y-6">
      <div className="card flex flex-col items-center gap-4 p-6 md:flex-row md:justify-between">
        <PersonTag p={A} />
        <div className="text-center">
          <div className="chip mx-auto mb-2 text-rose">{date.round === 2 ? "second date" : "first date"}</div>
          <div className="font-serif text-2xl">{date.venue ? date.venue.name : "Planning the date…"}</div>
          {date.venue && <div className="text-sm text-muted">{date.venue.activity}</div>}
          {date.venue && (
            <div className="mt-1 text-xs text-muted">
              {first(A)}&apos;s agent proposed it · {first(B)}&apos;s agent {date.venue.accepted ? "accepted" : "countered"}
            </div>
          )}
        </div>
        <PersonTag p={B} right />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="card flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-xl text-gold">{live ? "Live now" : "The date"}</h2>
            {!live && (
              <div className="flex items-center gap-2 text-xs">
                {[1, 2, 4].map((s) => (
                  <button key={s} onClick={() => setSpeed(s)} className={`chip ${speed === s ? "text-gold" : ""}`}>{s}×</button>
                ))}
                <button onClick={() => { setOpenedLive(false); setShown(total); }} className="chip">skip</button>
                <button onClick={() => { setOpenedLive(false); setShown(0); }} className="chip">replay</button>
              </div>
            )}
          </div>
          <div className="max-h-[60vh] min-h-[300px] space-y-3 overflow-y-auto pr-1">
            {lines.map((l, i) =>
              l.speaker === "scene" ? (
                <div key={i} className="rise mx-auto max-w-md rounded-xl border border-dashed border-rose/50 px-4 py-2 text-center text-sm italic text-rose">
                  ✦ {l.text}
                </div>
              ) : (
                <Bubble key={i} line={l} who={l.speaker === "a" ? A : B} isA={l.speaker === "a"} />
              )
            )}
            {(typing || live) && !done && (
              <div className="text-xs text-muted">
                {live ? "agents are talking" : `${first(date.transcript[visible]?.speaker === "b" ? B : A)}'s agent is typing`} <Dots />
              </div>
            )}
            <div ref={bottom} />
          </div>
          {date.status === "error" && <p className="mt-3 text-sm text-rose">This date broke off: {date.error}</p>}
        </div>

        <div className="space-y-4">
          <h2 className="font-serif text-xl text-gold">Private debriefs</h2>
          {date.status === "done" ? (
            <>
              <DebriefCard d={date.debrief_a} score={date.score_ab} me={A} other={B} />
              <DebriefCard d={date.debrief_b} score={date.score_ba} me={B} other={A} />
            </>
          ) : (
            <div className="card p-5 text-sm text-muted">Each agent writes a private debrief for its person after the date. <Dots /></div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonTag({ p, right }: { p?: Mini; right?: boolean }) {
  return (
    <Link href={p ? `/p/${p.id}` : "#"} className={`flex items-center gap-3 ${right ? "md:flex-row-reverse md:text-right" : ""}`}>
      <Avatar src={p?.photo_url} name={p?.name} size={64} />
      <div>
        <div className="font-semibold">{p?.name}</div>
        <div className="max-w-[220px] text-xs text-muted line-clamp-2">{p?.headline}</div>
        <div className="text-xs text-gold-dim">represented by their agent</div>
      </div>
    </Link>
  );
}

function Bubble({ line, who, isA }: { line: Line; who?: Mini; isA: boolean }) {
  const parts = line.text.split(/(\*[^*]+\*)/g);
  return (
    <div className={`rise flex items-end gap-2 ${isA ? "" : "flex-row-reverse"}`}>
      <Avatar src={who?.photo_url} name={who?.name} size={30} />
      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${isA ? "rounded-bl-sm bg-card2" : "rounded-br-sm bg-gold/15"}`}>
        {parts.map((p, i) => (p.startsWith("*") && p.endsWith("*") ? <em key={i} className="text-muted">{p.slice(1, -1)}</em> : <span key={i}>{p}</span>))}
      </div>
    </div>
  );
}

function DebriefCard({ d, score, me, other }: { d: Debrief | null; score: number | null; me?: Mini; other?: Mini }) {
  if (!d) return null;
  const f = (p?: Mini) => p?.name?.split(" ")[0];
  return (
    <div className="card rise space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Avatar src={me?.photo_url} name={me?.name} size={32} />
        <div className="flex-1 text-sm">
          <b>{f(me)}&apos;s agent</b> <span className="text-muted">on {f(other)}</span>
        </div>
        <span className={`chip ${d.would_see_again === "yes" ? "text-sage" : d.would_see_again === "no" ? "text-rose" : ""}`}>{seeAgainLabel[d.would_see_again]}</span>
        <span className="font-serif text-2xl text-gold">{Math.round((score ?? 0) * 100)}</span>
      </div>
      <p className="font-serif text-lg">&ldquo;{d.verdict}&rdquo;</p>
      <div className="grid grid-cols-5 gap-2 text-center text-[11px] text-muted">
        {Object.entries(d.scores).map(([k, v]) => (
          <div key={k}>
            <ScoreBar value={v} max={10} />
            <div className="mt-1">{k.replace("_", " ")}</div>
            <div className="text-cream">{v}</div>
          </div>
        ))}
      </div>
      <p className="text-sm"><span className="text-sage">Best moment:</span> {d.best_moment}</p>
      <p className="text-sm"><span className="text-rose">Concern:</span> {d.concern}</p>
      <p className="text-xs text-muted">{d.reasoning}</p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, Dots, ScoreBar, usePoll } from "../ui";

type Mini = { id: string; name: string; headline: string; photo_url: string | null };
type Row = { otherId: string; score: number; mutual: number; secondDate: boolean; verdict: string; seeAgain: string; theySeeAgain: string; dateIds: string[] };
type Data = { people: Mini[]; rankings: Record<string, Row[]>; stats: { dates: number; firstDates: number; secondDates: number } };

export default function RankingsPage() {
  const { data } = usePoll<Data>("/api/rankings", 10000, () => false);
  const [view, setView] = useState<"top" | "matrix">("top");
  const [q, setQ] = useState("");
  const byId = useMemo(() => Object.fromEntries((data?.people ?? []).map((p) => [p.id, p])), [data]);

  if (!data) return <div className="py-20 text-center text-muted"><Dots /></div>;
  const people = data.people.filter((p) => p.name?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-4xl">Rankings</h1>
          <p className="text-muted">
            {data.people.length} agents · {data.stats.firstDates} first dates · {data.stats.secondDates} second dates. For every person: who fits them best.
          </p>
        </div>
        <div className="flex gap-2">
          <input className="input !w-48 !py-2" placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={() => setView("top")} className={`chip !px-4 !py-2 ${view === "top" ? "text-gold" : ""}`}>Top 3 each</button>
          <button onClick={() => setView("matrix")} className={`chip !px-4 !py-2 ${view === "matrix" ? "text-gold" : ""}`}>Heatmap</button>
        </div>
      </div>

      {view === "top" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {people.map((p, i) => (
            <div key={p.id} className="card rise p-4" style={{ animationDelay: `${i * 20}ms` }}>
              <Link href={`/p/${p.id}#ranking`} className="mb-3 flex items-center gap-3 hover:text-gold">
                <Avatar src={p.photo_url} name={p.name} size={44} />
                <div className="min-w-0">
                  <div className="font-semibold">{p.name}</div>
                  <div className="truncate text-xs text-muted">{p.headline}</div>
                </div>
              </Link>
              <ol className="space-y-3">
                {(data.rankings[p.id] ?? []).slice(0, 3).map((r, j) => {
                  const o = byId[r.otherId];
                  return (
                    <li key={r.otherId} className="flex items-start gap-2">
                      <span className="w-4 font-serif text-gold">{j + 1}</span>
                      <Avatar src={o?.photo_url} name={o?.name} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <Link href={`/date/${r.dateIds.at(-1)}`} className="truncate font-medium hover:text-gold">{o?.name}</Link>
                          <span className="font-serif text-gold">{r.score}</span>
                        </div>
                        <ScoreBar value={r.score} />
                        <p className="mt-1 line-clamp-2 text-xs text-muted">{r.verdict}</p>
                      </div>
                    </li>
                  );
                })}
                {!(data.rankings[p.id] ?? []).length && <li className="text-sm text-muted">No dates yet.</li>}
              </ol>
              <Link href={`/p/${p.id}#ranking`} className="mt-3 block text-right text-xs text-gold-dim hover:text-gold">full ranking →</Link>
            </div>
          ))}
        </div>
      ) : (
        <Matrix data={data} people={people} />
      )}
    </div>
  );
}

function Matrix({ data, people }: { data: Data; people: Mini[] }) {
  const all = data.people;
  const score = (a: string, b: string) => data.rankings[a]?.find((r) => r.otherId === b);
  const first = (p: Mini) => p.name?.split(" ")[0] ?? "?";
  return (
    <div className="card overflow-x-auto p-4">
      <p className="mb-3 text-xs text-muted">Row = the person, column = their date. Cell = how well the column person fits the row person (0–100). Brighter = better fit; outlined = second date.</p>
      <table className="border-separate border-spacing-[2px] text-[10px]">
        <thead>
          <tr>
            <th />
            {all.map((c) => (
              <th key={c.id} className="h-20 w-7 align-bottom font-normal text-muted">
                <div className="w-7 origin-bottom-left translate-x-3 -rotate-60 whitespace-nowrap">{first(c)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap pr-2 text-right text-muted">
                <Link href={`/p/${r.id}#ranking`} className="hover:text-gold">{r.name}</Link>
              </td>
              {all.map((c) => {
                const s = score(r.id, c.id);
                if (r.id === c.id) return <td key={c.id} className="h-7 w-7 rounded bg-ink" />;
                const v = s?.score ?? 0;
                // single-hue sequential scale: gold with opacity by score, rescaled from the typical 30-80 range
                const t = Math.max(0, Math.min(1, (v - 30) / 50));
                return (
                  <td key={c.id} className="h-7 w-7 rounded text-center" style={{ background: s ? `rgba(232,192,125,${0.06 + t * 0.9})`: "transparent", color: t > 0.55 ? "#1a140b" : "#a89c86", outline: s?.secondDate ? "1px solid #e58a8a" : undefined }}>
                    {s ? (
                      <Link href={`/date/${s.dateIds.at(-1)}`} title={`${r.name} ← ${c.name}: ${v}\n${s.verdict}`} className="block leading-7">
                        {v}
                      </Link>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

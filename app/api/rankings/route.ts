import { NextResponse } from "next/server";
import { db, must } from "@/lib/db";
import { rankFor, type DateLite } from "@/lib/rank";

/** Rankings for the whole demo pool + a compatibility matrix. */
export async function GET() {
  const people = (await must(
    db().from("people").select("id,name,headline,photo_url").eq("pool", "demo").order("name", { ascending: true })
  )) as { id: string; name: string; headline: string; photo_url: string | null }[];
  const ids = people.map((p) => p.id);
  if (!ids.length) return NextResponse.json({ people: [], rankings: {}, stats: { dates: 0 } });

  // Page through dates (Supabase caps a select at 1000 rows).
  const dates: DateLite[] = [];
  for (let from = 0; ; from += 1000) {
    const page = (await must(
      db().from("dates").select("id,a_id,b_id,round,status,score_ab,score_ba,debrief_a,debrief_b,venue").in("a_id", ids).in("b_id", ids).eq("status", "done").range(from, from + 999)
    )) as DateLite[];
    dates.push(...page);
    if (page.length < 1000) break;
  }
  const rankings = Object.fromEntries(ids.map((id) => [id, rankFor(id, dates).map(({ otherId, score, mutual, secondDate, verdict, seeAgain, theySeeAgain, dateIds }) => ({ otherId, score, mutual, secondDate, verdict, seeAgain, theySeeAgain, dateIds }))]));
  return NextResponse.json({
    people,
    rankings,
    stats: { dates: dates.length, firstDates: dates.filter((d) => d.round === 1).length, secondDates: dates.filter((d) => d.round === 2).length },
  });
}

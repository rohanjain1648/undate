import type { Debrief } from "./agents/schemas";

export type DateLite = {
  id: string;
  a_id: string;
  b_id: string;
  round: number;
  status: string;
  score_ab: number | null;
  score_ba: number | null;
  debrief_a: Debrief | null;
  debrief_b: Debrief | null;
  venue: { name: string; activity: string } | null;
};

export type RankRow = {
  otherId: string;
  score: number; // 0-100
  own: number; // how my agent rated them, 0-1
  their: number; // how their agent rated me, 0-1
  mutual: number;
  secondDate: boolean;
  seeAgain: string;
  theySeeAgain: string;
  verdict: string;
  concern: string;
  dateIds: string[];
};

/**
 * rank(A→B) = 0.6·own + 0.3·mutual + 0.1·second-date bonus
 *   own    = A's agent's debrief score about B (round 1 and round 2 averaged if both exist)
 *   mutual = geometric mean of both directions (one-sided interest is penalised)
 */
export function rankFor(personId: string, dates: DateLite[]): RankRow[] {
  const byOther = new Map<string, DateLite[]>();
  for (const d of dates) {
    if (d.status !== "done") continue;
    if (d.a_id !== personId && d.b_id !== personId) continue;
    const other = d.a_id === personId ? d.b_id : d.a_id;
    byOther.set(other, [...(byOther.get(other) ?? []), d]);
  }
  const rows: RankRow[] = [];
  for (const [otherId, ds] of byOther) {
    const sides = ds
      .sort((x, y) => x.round - y.round)
      .map((d) => {
        const iAmA = d.a_id === personId;
        return {
          d,
          own: (iAmA ? d.score_ab : d.score_ba) ?? 0,
          their: (iAmA ? d.score_ba : d.score_ab) ?? 0,
          mine: iAmA ? d.debrief_a : d.debrief_b,
          theirs: iAmA ? d.debrief_b : d.debrief_a,
        };
      });
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const own = avg(sides.map((s) => s.own));
    const their = avg(sides.map((s) => s.their));
    const mutual = Math.sqrt(own * their);
    const last = sides[sides.length - 1];
    const second = sides.some((s) => s.d.round === 2);
    const bothYes = second && last.mine?.would_see_again === "yes" && last.theirs?.would_see_again === "yes";
    rows.push({
      otherId,
      score: Math.round((0.6 * own + 0.3 * mutual + 0.1 * (bothYes ? 1 : second ? 0.5 : 0)) * 100),
      own,
      their,
      mutual,
      secondDate: second,
      seeAgain: last.mine?.would_see_again ?? "maybe",
      theySeeAgain: last.theirs?.would_see_again ?? "maybe",
      verdict: last.mine?.verdict ?? "",
      concern: last.mine?.concern ?? "",
      dateIds: sides.map((s) => s.d.id),
    });
  }
  return rows.sort((x, y) => y.score - x.score);
}

// Usage: npx tsx scripts/test-date.ts — runs one date between the test profile and a stub persona, without the DB.
import "./env";
import { readFileSync } from "node:fs";
import { converse, debrief, debriefScore, planVenue, SCENES, type Line, type Persona } from "../lib/agents/date";
import type { Profile } from "../lib/agents/schemas";

async function main() {
  const t = JSON.parse(readFileSync("data/raw/test-profile.json", "utf8"));
  const a: Persona = { id: "a", name: "Bill Gates", first: "Bill", headline: "Chair, Gates Foundation", profile: t.profile as Profile, evidence: t.obs.observations.map((o: { fact: string }) => o.fact) };
  const trait = (label: string, detail: string) => ({ label, detail, evidence: [], confidence: 0.7 });
  const b: Persona = {
    id: "b",
    name: "Test Person",
    first: "Sam",
    headline: "Pastry chef & weekend trail runner",
    evidence: ["Runs a small bakery", "Posts trail-running photos most weekends", "Loves jazz records"],
    profile: {
      ...(t.profile as Profile),
      summary: "A warm, hands-on pastry chef who lives for early mornings, trail runs and slow Sunday jazz.",
      voice: "Playful, short sentences, food puns.",
      needs: [trait("Presence", "Wants a partner who switches off work at dinner"), trait("Adventure buddy", "Someone who'll come on a 6am trail run")],
      hobbies: [trait("Trail running", "weekend runs"), trait("Vinyl", "collects jazz records")],
      interests: [trait("Food", "baking, local produce")],
      values: [trait("Craft", "doing things by hand, slowly")],
      conversation_hooks: ["the sourdough starter named Gerald", "last weekend's trail run", "favourite jazz record"],
    },
  };
  let t0 = Date.now();
  const plan = await planVenue(a, b, 1);
  console.log(`VENUE (${Date.now() - t0}ms):`, plan.venue);
  const lines: Line[] = plan.lines;
  t0 = Date.now();
  await converse({ a, b, round: 1, venue: plan.venue, scene: SCENES[0], turnsEach: 5, memoryA: null, memoryB: null, lines, onLine: async () => {} });
  console.log(`CONVERSATION (${Date.now() - t0}ms):`);
  for (const l of lines) console.log(l.speaker === "scene" ? `  ✦ ${l.text}` : `  ${l.speaker === "a" ? a.first : b.first}: ${l.text}`);
  t0 = Date.now();
  const [da, dbf] = await Promise.all([debrief(a, b, "a", lines, a, b, plan.venue.name), debrief(b, a, "b", lines, a, b, plan.venue.name)]);
  console.log(`DEBRIEFS (${Date.now() - t0}ms):`);
  console.log(" A:", debriefScore(da).toFixed(2), da.would_see_again, "-", da.verdict, "| concern:", da.concern);
  console.log(" B:", debriefScore(dbf).toFixed(2), dbf.would_see_again, "-", dbf.verdict, "| concern:", dbf.concern);
}

main().then(() => process.exit(0));

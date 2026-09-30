// Usage: npx tsx scripts/run-all.ts [--concurrency 8] [--no-second]
// Every demo-pool agent speed-dates every other one (n·(n-1)/2 dates), then each gets second dates with its top 3 mutual matches.
import "./env";
import pLimit from "p-limit";
import { db, must } from "../lib/db";
import { loadPersona, runDate, secondDates } from "../lib/pipeline";
import type { Persona } from "../lib/agents/date";

async function main() {
  const ci = process.argv.indexOf("--concurrency");
  const concurrency = ci > 0 ? Number(process.argv[ci + 1]) : 8;
  const people = (await must(db().from("people").select("id,name").eq("pool", "demo").in("status", ["ready", "done", "dating"]))) as { id: string; name: string }[];
  console.log(`${people.length} agents in the demo pool`);
  const personas = new Map<string, Persona>();
  for (const p of people) personas.set(p.id, await loadPersona(p.id));

  const done = (await must(db().from("dates").select("a_id,b_id").eq("round", 1).eq("status", "done"))) as { a_id: string; b_id: string }[];
  const key = (x: string, y: string) => [x, y].sort().join(":");
  const have = new Set(done.map((d) => key(d.a_id, d.b_id)));
  // Clean up dates left half-finished by a previous interrupted run.
  await db().from("dates").delete().neq("status", "done").in("a_id", people.map((p) => p.id)).in("b_id", people.map((p) => p.id));

  const pairs: [string, string][] = [];
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) {
      // Alternate who initiates so it's not always the same side proposing the venue.
      const [a, b] = (i + j) % 2 ? [people[i].id, people[j].id] : [people[j].id, people[i].id];
      if (!have.has(key(a, b))) pairs.push([a, b]);
    }
  console.log(`${pairs.length} speed dates to run (concurrency ${concurrency})`);

  const limit = pLimit(concurrency);
  let n = 0;
  const t0 = Date.now();
  await Promise.all(
    pairs.map(([a, b]) =>
      limit(async () => {
        try {
          await runDate(personas.get(a)!, personas.get(b)!, 1);
        } catch (e) {
          console.error(`✗ ${personas.get(a)!.first} × ${personas.get(b)!.first}:`, e instanceof Error ? e.message : e);
        }
        n++;
        if (n % 10 === 0 || n === pairs.length) console.log(`  ${n}/${pairs.length} dates · ${Math.round((Date.now() - t0) / 1000)}s`);
      })
    )
  );

  if (!process.argv.includes("--no-second")) {
    console.log("second dates …");
    for (const p of people) {
      await secondDates(p.id, 3);
      console.log(`  ✓ ${p.name}`);
    }
  }
  await db().from("people").update({ status: "done" }).eq("pool", "demo").in("status", ["ready", "dating"]);
  console.log("all done");
}

main().then(() => process.exit(0));

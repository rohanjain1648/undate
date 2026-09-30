// Usage: npx tsx scripts/seed.ts [data/people.csv]
// Reads name,linkedin_url,instagram_url,verification rows, adds them to the demo pool, scrapes + analyzes each.
import "./env";
import { readFileSync } from "node:fs";
import pLimit from "p-limit";
import { db, must } from "../lib/db";
import { analyzePerson } from "../lib/pipeline";
import { parseInstagram, parseLinkedIn } from "../lib/scrape/urls";

function parseCsv(text: string): Record<string, string>[] {
  const [head, ...rows] = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const cols = head.split(",").map((c) => c.trim());
  return rows.map((r) => {
    const cells = r.split(",").map((c) => c.trim());
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

async function main() {
  const file = process.argv[2] ?? "data/people.csv";
  const rows = parseCsv(readFileSync(file, "utf8"));
  console.log(`${rows.length} people in ${file}`);
  const ids: string[] = [];
  for (const r of rows) {
    const li = parseLinkedIn(r.linkedin_url);
    const ig = parseInstagram(r.instagram_url);
    if (!li || !ig) {
      console.warn("skip (bad url):", r);
      continue;
    }
    const existing = await must(db().from("people").select("id,status").eq("linkedin_url", li).limit(1));
    if (existing.length) {
      const p = existing[0] as { id: string; status: string };
      await db().from("people").update({ pool: "demo", instagram_url: ig.url, verification: r.verification || null }).eq("id", p.id);
      if (!["ready", "done", "dating"].includes(p.status)) ids.push(p.id);
      continue;
    }
    const row = await must(
      db().from("people").insert({ linkedin_url: li, instagram_url: ig.url, pool: "demo", verification: r.verification || null, name: r.name || null }).select("id").single()
    );
    ids.push((row as { id: string }).id);
  }
  console.log(`analyzing ${ids.length} people …`);
  const limit = pLimit(3);
  let ok = 0;
  await Promise.all(
    ids.map((id) =>
      limit(async () => {
        try {
          await analyzePerson(id);
          ok++;
          console.log(`✓ ${id} (${ok}/${ids.length})`);
        } catch (e) {
          console.error(`✗ ${id}`, e instanceof Error ? e.message : e);
        }
      })
    )
  );
  console.log(`done: ${ok}/${ids.length} analyzed`);
}

main().then(() => process.exit(0));

// Usage: npx tsx scripts/test-analyze.ts — runs the analyst on data/raw/test-*.json (from test-scrape) without the DB.
import "./env";
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeInstagram, normalizeLinkedIn } from "../lib/scrape/apify";
import { lookAtImages, observe, sourceDigest, synthesize } from "../lib/agents/analyst";

async function main() {
  const li = normalizeLinkedIn("test", JSON.parse(readFileSync("data/raw/test-linkedin.json", "utf8")));
  const ig = normalizeInstagram("test", JSON.parse(readFileSync("data/raw/test-instagram.json", "utf8")));
  let t = Date.now();
  const images = await lookAtImages(ig);
  console.log(`images (${Date.now() - t}ms):`, images.images.map((i) => `${i.ref}: ${i.scene}`));
  t = Date.now();
  const obs = await observe(sourceDigest(li, ig), images);
  console.log(`observations (${Date.now() - t}ms): ${obs.observations.length}`, obs.observations.slice(0, 5));
  t = Date.now();
  const profile = await synthesize(li.name, obs);
  console.log(`profile (${Date.now() - t}ms)`);
  writeFileSync("data/raw/test-profile.json", JSON.stringify({ images, obs, profile }, null, 2));
  console.log(JSON.stringify({ summary: profile.summary, needs: profile.needs, hobbies: profile.hobbies.map((h) => h.label) }, null, 2));
}

main().then(() => process.exit(0));

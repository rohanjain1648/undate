// Usage: npx tsx scripts/test-scrape.ts <linkedin_url> <instagram_url>
// Scrapes one person and prints the normalized data (nothing is saved).
import "./env";
import { writeFileSync, mkdirSync } from "node:fs";
import { scrapeInstagram, scrapeLinkedIn } from "../lib/scrape/apify";
import { parseInstagram, parseLinkedIn } from "../lib/scrape/urls";

async function main() {
  const li = parseLinkedIn(process.argv[2] ?? "");
  const ig = parseInstagram(process.argv[3] ?? "");
  if (!li || !ig) throw new Error("usage: test-scrape <linkedin_url> <instagram_url>");
  mkdirSync("data/raw", { recursive: true });
  const [l, i] = await Promise.allSettled([scrapeLinkedIn(li), scrapeInstagram(ig.url, ig.username)]);
  if (l.status === "fulfilled") {
    writeFileSync("data/raw/test-linkedin.json", JSON.stringify(l.value.raw, null, 2));
    const d = l.value.data;
    console.log("LINKEDIN ok:", { name: d.name, headline: d.headline, location: d.location, about: d.about.slice(0, 80), exp: d.experience.length, edu: d.education.length, skills: d.skills.length, posts: d.posts.length, photo: !!d.photo });
    console.log("  raw keys:", Object.keys(l.value.raw).join(", "));
  } else console.log("LINKEDIN FAIL:", l.reason?.message ?? l.reason);
  if (i.status === "fulfilled") {
    writeFileSync("data/raw/test-instagram.json", JSON.stringify(i.value.raw, null, 2));
    const d = i.value.data;
    console.log("INSTAGRAM ok:", { user: d.username, name: d.fullName, bio: d.bio.slice(0, 80), followers: d.followers, posts: d.posts.length, withImages: d.posts.filter((p) => p.imageUrl).length, private: d.isPrivate });
    console.log("  first caption:", d.posts[0]?.caption.slice(0, 100));
  } else console.log("INSTAGRAM FAIL:", i.reason?.message ?? i.reason);
}

main().then(() => process.exit(0));

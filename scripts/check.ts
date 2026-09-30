// Usage: npx tsx scripts/check.ts — verifies Groq, Supabase schema, and Apify token.
import "./env";
import { db } from "../lib/db";
import { ping } from "../lib/agents/analyst";

async function main() {
  try {
    console.log("groq:", await ping());
  } catch (e) {
    console.log("groq: FAIL", e instanceof Error ? e.message : e);
  }
  for (const t of ["people", "sources", "profiles", "dates"]) {
    const { error, data } = await db().from(t).select("*").limit(1);
    console.log(`supabase ${t}:`, error ? `FAIL ${error.message}` : `ok (${data?.length ? "has rows" : "empty"})`);
  }
  console.log("apify token:", process.env.APIFY_TOKEN ? "set" : "MISSING");
}

main().then(() => process.exit(0));

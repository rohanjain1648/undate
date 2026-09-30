import { after, NextResponse } from "next/server";
import { db, must } from "@/lib/db";
import { analyzePerson } from "@/lib/pipeline";
import { parseInstagram, parseLinkedIn } from "@/lib/scrape/urls";

export const maxDuration = 300;

export async function GET() {
  const people = await must(
    db().from("people").select("id,name,headline,photo_url,pool,status,created_at").order("created_at", { ascending: true })
  );
  return NextResponse.json({ people });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const linkedin = parseLinkedIn(String(body.linkedin ?? ""));
  const ig = parseInstagram(String(body.instagram ?? ""));
  if (!linkedin) return NextResponse.json({ error: "That doesn't look like a LinkedIn profile URL (linkedin.com/in/…)." }, { status: 400 });
  if (!ig) return NextResponse.json({ error: "That doesn't look like an Instagram profile URL (instagram.com/username)." }, { status: 400 });

  // Same person already on the site → reuse (and retry if it failed before).
  const existing = await must(db().from("people").select("id,status").eq("linkedin_url", linkedin).eq("instagram_url", ig.url).limit(1));
  if (existing.length) {
    const p = existing[0] as { id: string; status: string };
    if (p.status === "error") {
      await db().from("people").update({ status: "queued", log: [] }).eq("id", p.id);
      after(() => analyzePerson(p.id).catch(() => undefined));
    }
    return NextResponse.json({ id: p.id });
  }

  // Simple abuse guard: max 40 new visitor people per hour across the site.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db().from("people").select("id", { count: "exact", head: true }).eq("pool", "visitor").gte("created_at", since);
  if ((count ?? 0) >= 40) return NextResponse.json({ error: "The site is busy, please try again in a few minutes." }, { status: 429 });

  const row = await must(
    db().from("people").insert({ linkedin_url: linkedin, instagram_url: ig.url, pool: "visitor", status: "queued" }).select("id").single()
  );
  const id = (row as { id: string }).id;
  after(() => analyzePerson(id).catch(() => undefined));
  return NextResponse.json({ id });
}

import { NextResponse } from "next/server";
import { db, must } from "@/lib/db";
import { rankFor, type DateLite } from "@/lib/rank";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: person } = await db().from("people").select("*").eq("id", id).maybeSingle();
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ data: profile }, { data: sources }, dates] = await Promise.all([
    db().from("profiles").select("*").eq("person_id", id).maybeSingle(),
    db().from("sources").select("kind, normalized").eq("person_id", id),
    must(
      db()
        .from("dates")
        .select("id,a_id,b_id,round,status,score_ab,score_ba,debrief_a,debrief_b,venue,created_at")
        .or(`a_id.eq.${id},b_id.eq.${id}`)
        .order("created_at", { ascending: true })
    ),
  ]);

  const others = Array.from(new Set((dates as DateLite[]).flatMap((d) => [d.a_id, d.b_id]).filter((x) => x !== id)));
  const people = others.length ? await must(db().from("people").select("id,name,headline,photo_url").in("id", others)) : [];

  return NextResponse.json({
    person,
    profile,
    sources: Object.fromEntries(((sources ?? []) as { kind: string; normalized: unknown }[]).map((s) => [s.kind, s.normalized])),
    dates,
    people,
    ranking: rankFor(id, dates as DateLite[]),
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: person } = await db().from("people").select("pool").eq("id", id).maybeSingle();
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Demo-pool removals go through the contact link so a visitor can't wipe the demo.
  if (person.pool !== "visitor") return NextResponse.json({ error: "Demo profiles are removed on request." }, { status: 403 });
  await db().from("people").delete().eq("id", id);
  await db().storage.from("photos").remove([`${id}.jpg`]).catch(() => undefined);
  return NextResponse.json({ ok: true });
}

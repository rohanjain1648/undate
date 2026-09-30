import { after, NextResponse } from "next/server";
import { db, must } from "@/lib/db";
import { datePerson } from "@/lib/pipeline";

export const maxDuration = 300;

/** Send this person's agent on dates with everyone in the demo pool. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: person } = await db().from("people").select("status,pool").eq("id", id).maybeSingle();
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (person.status === "dating") return NextResponse.json({ ok: true, already: true });
  if (!["ready", "done"].includes(person.status)) return NextResponse.json({ error: "The profile isn't ready yet." }, { status: 409 });

  const pool = (await must(db().from("people").select("id").eq("pool", "demo").in("status", ["ready", "done"]))) as { id: string }[];
  const partners = pool.map((p) => p.id).filter((x) => x !== id);
  if (!partners.length) return NextResponse.json({ error: "No one in the dating pool yet." }, { status: 409 });

  await db().from("people").update({ status: "dating" }).eq("id", id);
  after(() => datePerson(id, partners, 8).catch(async () => {
    await db().from("people").update({ status: "done" }).eq("id", id);
  }));
  return NextResponse.json({ ok: true, partners: partners.length });
}

import pLimit from "p-limit";
import { db, logStep, must } from "./db";
import { scrapeInstagram, scrapeLinkedIn } from "./scrape/apify";
import type { InstagramData, LinkedInData } from "./scrape/types";
import { parseInstagram } from "./scrape/urls";
import { lookAtImages, observe, sourceDigest, synthesize } from "./agents/analyst";
import { converse, debrief, debriefScore, planVenue, SCENES, type Line, type Persona } from "./agents/date";
import type { Debrief, Observations, Profile } from "./agents/schemas";
import { MODELS } from "./llm/models";

// ---------------------------------------------------------------- photos
async function storePhoto(personId: string, url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const storage = db().storage;
    await storage.createBucket("photos", { public: true }).catch(() => undefined);
    const path = `${personId}.jpg`;
    const { error } = await storage.from("photos").upload(path, buf, { contentType: res.headers.get("content-type") || "image/jpeg", upsert: true });
    if (error) return null;
    return storage.from("photos").getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- read a person
export async function analyzePerson(personId: string) {
  const person = await must(db().from("people").select("*").eq("id", personId).single());
  try {
    await db().from("people").update({ status: "scraping", error: null }).eq("id", personId);

    const cached = await must(db().from("sources").select("kind, normalized").eq("person_id", personId));
    let li = cached.find((c: { kind: string }) => c.kind === "linkedin")?.normalized as LinkedInData | undefined;
    let ig = cached.find((c: { kind: string }) => c.kind === "instagram")?.normalized as InstagramData | undefined;

    const igRef = parseInstagram(person.instagram_url)!;
    await logStep(personId, "scrape", `Reading LinkedIn ${person.linkedin_url} and Instagram @${igRef.username} …`);
    const [liRes, igRes] = await Promise.all([
      li ? null : scrapeLinkedIn(person.linkedin_url),
      ig ? null : scrapeInstagram(igRef.url, igRef.username),
    ]);
    if (liRes) {
      li = liRes.data;
      await db().from("sources").upsert({ person_id: personId, kind: "linkedin", raw: liRes.raw, normalized: li });
    }
    if (igRes) {
      ig = igRes.data;
      await db().from("sources").upsert({ person_id: personId, kind: "instagram", raw: igRes.raw, normalized: ig });
    }
    li = li!;
    ig = ig!;
    await logStep(personId, "scrape", `LinkedIn: ${li.experience.length} roles, ${li.education.length} schools, ${li.skills.length} skills.`);
    await logStep(personId, "scrape", `Instagram: ${ig.posts.length} recent posts, ${ig.followers ?? "?"} followers, public ✓`);

    const name = li.name || ig.fullName || ig.username;
    const photo = await storePhoto(personId, ig.profilePic || li.photo);
    await db().from("people").update({ name, headline: li.headline, photo_url: photo, status: "reading" }).eq("id", personId);

    await logStep(personId, "look", `Looking at ${Math.min(5, ig.posts.filter((p) => p.imageUrl).length)} Instagram photos (${MODELS.vision}) …`);
    const images = await lookAtImages(ig);
    for (const im of images.images) await logStep(personId, "look", `${im.ref}: ${im.scene}${im.activity ? ` — ${im.activity}` : ""}`);

    await logStep(personId, "observe", `Writing cited observations (${MODELS.reason}) …`);
    const obs = await observe(sourceDigest(li, ig), images);
    for (const o of obs.observations.slice(0, 14)) await logStep(personId, "observe", `(${o.source}) ${o.fact}`);
    if (obs.observations.length > 14) await logStep(personId, "observe", `… and ${obs.observations.length - 14} more observations.`);

    await logStep(personId, "profile", "Building the profile: needs, hobbies, interests, values, personality …");
    const profile = await synthesize(name, obs);
    await db().from("profiles").upsert({
      person_id: personId,
      image_notes: images,
      observations: obs,
      profile,
      models: { vision: MODELS.vision, reason: MODELS.reason },
    });
    await logStep(personId, "done", "Profile ready.", "ready");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logStep(personId, "error", msg, "error");
    await db().from("people").update({ error: msg }).eq("id", personId);
    throw e;
  }
}

// ---------------------------------------------------------------- dating
export async function loadPersona(personId: string): Promise<Persona> {
  const p = await must(db().from("people").select("id, name, headline").eq("id", personId).single());
  const pr = await must(db().from("profiles").select("profile, observations").eq("person_id", personId).single());
  const obs = (pr.observations as Observations).observations;
  const priority = ["hobby", "interest", "value", "lifestyle", "personality", "career", "social", "education", "other"];
  const evidence = [...obs].sort((x, y) => priority.indexOf(x.kind) - priority.indexOf(y.kind)).map((o) => o.fact);
  return { id: p.id, name: p.name ?? "Someone", first: (p.name ?? "Someone").split(" ")[0], headline: p.headline ?? "", profile: pr.profile as Profile, evidence };
}

function memoryFrom(d: Debrief | null): string | null {
  if (!d) return null;
  return `verdict: ${d.verdict}; best moment: ${d.best_moment}; concern: ${d.concern}`;
}

export async function runDate(a: Persona, b: Persona, round: 1 | 2, prev?: { venue: string; memA: Debrief | null; memB: Debrief | null }) {
  const scene = SCENES[Math.floor(Math.random() * SCENES.length)];
  const row = await must(db().from("dates").insert({ a_id: a.id, b_id: b.id, round, scene, status: "running" }).select("id").single());
  const id = row.id as string;
  try {
    const plan = await planVenue(a, b, round, prev?.venue);
    let lines: Line[] = plan.lines;
    await db().from("dates").update({ venue: plan.venue, transcript: lines }).eq("id", id);
    lines = await converse({
      a,
      b,
      round,
      venue: plan.venue,
      scene,
      turnsEach: round === 2 ? 8 : 5,
      memoryA: memoryFrom(prev?.memA ?? null),
      memoryB: memoryFrom(prev?.memB ?? null),
      lines,
      onLine: async (ls) => {
        await db().from("dates").update({ transcript: ls }).eq("id", id);
      },
    });
    const where = `${plan.venue.name} (${plan.venue.activity})`;
    const [da, dbf] = await Promise.all([debrief(a, b, "a", lines, a, b, where), debrief(b, a, "b", lines, a, b, where)]);
    await db()
      .from("dates")
      .update({ debrief_a: da, debrief_b: dbf, score_ab: debriefScore(da), score_ba: debriefScore(dbf), status: "done" })
      .eq("id", id);
    return id;
  } catch (e) {
    await db().from("dates").update({ status: "error", error: e instanceof Error ? e.message : String(e) }).eq("id", id);
    throw e;
  }
}

type DateRow = { id: string; a_id: string; b_id: string; round: number; status: string; score_ab: number | null; score_ba: number | null; venue: { name: string } | null; debrief_a: Debrief | null; debrief_b: Debrief | null };

/** Speed-date `personId` against everyone in `partnerIds`, then second dates with their top 3 mutual matches. */
export async function datePerson(personId: string, partnerIds: string[], concurrency = 6) {
  await logStep(personId, "dates", `Going on ${partnerIds.length} speed dates …`, "dating");
  const me = await loadPersona(personId);
  const existing = (await must(db().from("dates").select("a_id,b_id,round,status").or(`a_id.eq.${personId},b_id.eq.${personId}`))) as DateRow[];
  const done = new Set(existing.filter((d) => d.round === 1 && d.status === "done").map((d) => (d.a_id === personId ? d.b_id : d.a_id)));
  const limit = pLimit(concurrency);
  await Promise.all(
    partnerIds
      .filter((id) => id !== personId && !done.has(id))
      .map((pid) =>
        limit(async () => {
          try {
            const other = await loadPersona(pid);
            await runDate(me, other, 1);
          } catch (e) {
            console.error("date failed", personId, pid, e);
          }
        })
      )
  );
  await secondDates(personId, 3);
  await logStep(personId, "done", "All dates finished. Rankings are ready.", "done");
}

/** Second dates with the top-N partners where neither side said "no". */
export async function secondDates(personId: string, n: number) {
  const rows = (await must(db().from("dates").select("*").or(`a_id.eq.${personId},b_id.eq.${personId}`).eq("status", "done"))) as DateRow[];
  const r2 = new Set(rows.filter((d) => d.round === 2).map((d) => (d.a_id === personId ? d.b_id : d.a_id)));
  const candidates = rows
    .filter((d) => d.round === 1)
    .map((d) => {
      const iAmA = d.a_id === personId;
      const mine = iAmA ? d.debrief_a : d.debrief_b;
      const theirs = iAmA ? d.debrief_b : d.debrief_a;
      const own = (iAmA ? d.score_ab : d.score_ba) ?? 0;
      const their = (iAmA ? d.score_ba : d.score_ab) ?? 0;
      return { d, other: iAmA ? d.b_id : d.a_id, mine, theirs, score: Math.sqrt(own * their) };
    })
    .filter((c) => c.mine?.would_see_again !== "no" && c.theirs?.would_see_again !== "no" && !r2.has(c.other))
    .sort((x, y) => y.score - x.score)
    .slice(0, Math.max(0, n - r2.size));
  if (!candidates.length) return;
  await logStep(personId, "dates", `Second dates with top ${candidates.length} mutual matches …`);
  const me = await loadPersona(personId);
  await Promise.all(
    candidates.map(async (c) => {
      try {
        const other = await loadPersona(c.other);
        await runDate(me, other, 2, { venue: c.d.venue?.name ?? "", memA: c.mine ?? null, memB: c.theirs ?? null });
      } catch (e) {
        console.error("second date failed", e);
      }
    })
  );
}

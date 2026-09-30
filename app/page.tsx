import Link from "next/link";
import { db } from "@/lib/db";
import { AddForm } from "./add-form";
import { Avatar } from "./ui";

export const dynamic = "force-dynamic";

type P = { id: string; name: string | null; headline: string | null; photo_url: string | null; pool: string; status: string };

export default async function Home() {
  const { data } = await db().from("people").select("id,name,headline,photo_url,pool,status").order("name", { ascending: true });
  const people = (data ?? []) as P[];
  const demo = people.filter((p) => p.pool === "demo");
  const visitors = people.filter((p) => p.pool === "visitor" && ["ready", "dating", "done"].includes(p.status)).slice(-8);
  const { count } = await db().from("dates").select("id", { count: "exact", head: true }).eq("status", "done");

  return (
    <div className="space-y-14">
      <section className="grid items-center gap-10 pt-6 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <h1 className="font-serif text-5xl leading-tight md:text-6xl">
            Your agent goes on the dates.
            <br />
            <span className="text-gold">You get the ranking.</span>
          </h1>
          <p className="max-w-xl text-lg text-muted">
            Paste someone&apos;s LinkedIn and public Instagram. Their AI agent reads both, works out their needs, hobbies and interests, then goes on real dates with
            every other agent on their behalf, and ranks who fits them best.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="chip">{demo.length} real people</span>
            <span className="chip">{count ?? 0} dates so far</span>
            <span className="chip">2 sources only</span>
          </div>
          <div className="flex gap-3">
            <Link href="/rankings" className="btn">See the rankings</Link>
            <Link href="/how" className="btn btn-ghost">How it works</Link>
          </div>
        </div>
        <AddForm />
      </section>

      <section id="pool" className="space-y-4">
        <div className="flex items-end justify-between">
          <h2 className="font-serif text-3xl">The dating pool</h2>
          <span className="text-sm text-muted">click anyone for their agent&apos;s analysis, dates and ranking</span>
        </div>
        {demo.length === 0 ? (
          <p className="card p-6 text-muted">No one in the pool yet. Run <code>npm run seed</code> with data/people.csv.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {demo.map((p, i) => (
              <Link key={p.id} href={`/p/${p.id}`} className="card rise flex flex-col items-center gap-2 p-4 text-center hover:border-gold-dim" style={{ animationDelay: `${i * 25}ms` }}>
                <Avatar src={p.photo_url} name={p.name} size={72} />
                <div className="font-semibold leading-tight">{p.name ?? "…"}</div>
                <div className="line-clamp-2 text-xs text-muted">{p.headline}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {visitors.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-serif text-2xl">Recently added by visitors</h2>
          <div className="flex flex-wrap gap-3">
            {visitors.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} className="card flex items-center gap-2 px-3 py-2 text-sm hover:border-gold-dim">
                <Avatar src={p.photo_url} name={p.name} size={28} />
                {p.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

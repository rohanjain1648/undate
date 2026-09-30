import sharp from "sharp";
import { chat, chatJson, type Msg } from "../llm/groq";
import { MODELS } from "../llm/models";
import type { InstagramData, LinkedInData } from "../scrape/types";
import { ImageNotes, Observations, Profile } from "./schemas";

const TWO_SOURCES_RULE =
  "You may ONLY use the LinkedIn and Instagram data given below. Do not use outside knowledge about this person, even if you think you recognise them. " +
  "Do NOT infer gender, sexual orientation, religion, ethnicity, health, or politics from photos or names. Refer to the person by first name or 'they', never he/she.";

export function sourceDigest(li: LinkedInData, ig: InstagramData): string {
  const lines: string[] = [];
  lines.push("=== LINKEDIN ===");
  lines.push(`[li:name] ${li.name}`);
  if (li.headline) lines.push(`[li:headline] ${li.headline}`);
  if (li.location) lines.push(`[li:location] ${li.location}`);
  if (li.about) lines.push(`[li:about] ${li.about.slice(0, 1500)}`);
  li.experience.forEach((e, i) => lines.push(`[li:experience[${i}]] ${e.title} @ ${e.company} (${e.duration}) ${e.description}`.trim()));
  li.education.forEach((e, i) => lines.push(`[li:education[${i}]] ${[e.degree, e.field].filter(Boolean).join(", ")} @ ${e.school}`));
  if (li.skills.length) lines.push(`[li:skills] ${li.skills.join(", ")}`);
  if (li.languages.length) lines.push(`[li:languages] ${li.languages.join(", ")}`);
  li.volunteering.forEach((v, i) => lines.push(`[li:volunteering[${i}]] ${v}`));
  if (li.certifications.length) lines.push(`[li:certifications] ${li.certifications.join(", ")}`);
  li.posts.forEach((p, i) => lines.push(`[li:post[${i}]] ${p}`));
  li.follows.forEach((f, i) => lines.push(`[li:follows[${i}]] ${f}`));
  li.extras.forEach((x, i) => lines.push(`[li:extra[${i}]] ${x}`));
  lines.push("", "=== INSTAGRAM ===");
  lines.push(`[ig:profile] @${ig.username} (${ig.fullName}) · ${ig.followers ?? "?"} followers · ${ig.postsCount ?? "?"} posts${ig.category ? ` · ${ig.category}` : ""}`);
  if (ig.bio) lines.push(`[ig:bio] ${ig.bio}`);
  if (ig.externalUrl) lines.push(`[ig:link] ${ig.externalUrl}`);
  ig.posts.forEach((p, i) =>
    lines.push(
      `[ig:post[${i}]] ${p.timestamp ? p.timestamp.slice(0, 10) + " · " : ""}${p.type}${p.location ? ` · 📍${p.location}` : ""} · "${p.caption.replace(/\s+/g, " ")}"${p.hashtags.length ? ` #${p.hashtags.join(" #")}` : ""}`
    )
  );
  return lines.join("\n");
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36", Referer: "https://www.instagram.com/" },
    });
    if (!res.ok) return null;
    // Downscale to 512px: far fewer vision tokens → stays under Groq's tokens-per-minute limit.
    const small = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    return `data:image/jpeg;base64,${small.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Pass 1: look at up to 6 Instagram photos (Groq vision takes max 3 images per request → 2 parallel batches). */
export async function lookAtImages(ig: InstagramData): Promise<ImageNotes> {
  const picks = ig.posts.map((p, i) => ({ p, i })).filter(({ p }) => p.imageUrl).slice(0, 6);
  const loaded = (await Promise.all(picks.map(async ({ p, i }) => ({ i, data: await toDataUrl(p.imageUrl!) })))).filter((x) => x.data);
  if (!loaded.length) {
    console.error(`vision: 0/${picks.length} images downloadable`);
    return { images: [] };
  }
  const batches = [loaded.slice(0, 3), loaded.slice(3, 6)].filter((b) => b.length);
  const results = await Promise.all(batches.map(lookBatch));
  return { images: results.flatMap((r) => r.images) };
}

async function lookBatch(loaded: { i: number; data: string | null }[]): Promise<ImageNotes> {
  const content: Exclude<Msg["content"], string | null | undefined> = [
    {
      type: "text",
      text:
        `These are ${loaded.length} photos from one person's public Instagram, in order: ${loaded.map((l) => `ig:post[${l.i}]`).join(", ")}. ` +
        "For each photo describe the scene, the activity, and lifestyle/hobby signals (sports, travel, food, pets, music, art, nightlife, nature, work, friends, family). " +
        "Describe what is visible, never guess gender, orientation, religion, ethnicity, or health. " +
        'Reply as JSON: {"images":[{"ref":"ig:post[N]","scene":"...","activity":"...","signals":["..."]}]}',
    },
    ...loaded.map((l) => ({ type: "image_url" as const, image_url: { url: l.data! } })),
  ];
  try {
    return await chatJson({ model: MODELS.vision, schema: ImageNotes, messages: [{ role: "user", content } as Msg], maxTokens: 1500 });
  } catch (e) {
    console.error("vision failed:", e instanceof Error ? e.message : e);
    return { images: [] }; // images are a bonus, text sources still work
  }
}

/** Pass 2: concrete, cited observations. */
export async function observe(digest: string, images: ImageNotes): Promise<Observations> {
  const imgText = images.images.map((im) => `[${im.ref} photo] ${im.scene}; ${im.activity}; signals: ${im.signals.join(", ")}`).join("\n");
  return chatJson({
    model: MODELS.reason,
    fallbackModel: MODELS.reasonFallback,
    schema: Observations,
    maxTokens: 4000,
    messages: [
      {
        role: "system",
        content:
          `You are the analyst agent of an agentic dating site. You read one person from exactly two sources and write down concrete observations. ${TWO_SOURCES_RULE} ` +
          "Write each fact without pronouns (e.g. 'Ran the Mumbai marathon'). Every observation must cite its source tag exactly as written, e.g. li:experience[1] or ig:post[4]. Prefer specific facts over generic ones ('ran the Mumbai marathon 2024' beats 'likes fitness'). " +
          "Include 20-35 observations covering career, education, hobbies, interests, values, lifestyle, social life and personality cues (tone of captions, humour, what they celebrate). " +
          'Reply as JSON: {"observations":[{"fact":"...","source":"li:... or ig:...","kind":"career|education|hobby|interest|value|lifestyle|social|personality|other"}]}',
      },
      { role: "user", content: `${digest}\n\n=== INSTAGRAM PHOTOS (seen by vision model) ===\n${imgText || "(no photos readable)"}` },
    ],
  });
}

/** Pass 3: the dating profile, built only from the observations. */
export async function synthesize(name: string, obs: Observations): Promise<Profile> {
  const obsText = obs.observations.map((o) => `- (${o.source}) [${o.kind}] ${o.fact}`).join("\n");
  return chatJson({
    model: MODELS.reason,
    fallbackModel: MODELS.reasonFallback,
    schema: Profile,
    maxTokens: 6000,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          `You turn cited observations about ${name} into a dating profile that their AI agent will use to date on their behalf. ${TWO_SOURCES_RULE}\n` +
          "Be specific and human, never generic. 'needs' = what this person needs from a partner (emotional, practical, lifestyle), inferred from how they live and work. " +
          "Each trait: label (2-5 words), detail (one sentence explaining the inference), evidence (list of source tags from the observations), confidence 0-1. " +
          "3-6 items for needs, hobbies, interests, values; 2-4 green_flags and possible_friction. Personality: Big Five 1-10 with a short why. " +
          "voice: 1-2 sentences on how they talk (e.g. dry humour, lots of emojis, formal, hype). conversation_hooks: 5 specific things their agent can bring up on a date. " +
          "If data is thin, say so in confidence_note and lower confidence.\n" +
          "Reply as JSON with keys: summary, voice, needs, hobbies, interests, values, personality{openness,conscientiousness,extraversion,agreeableness,neuroticism each {score,why}}, " +
          "lifestyle{schedule,social_energy,travel,fitness,base}, love_language_guess (trait), green_flags, possible_friction, ideal_first_date, conversation_hooks, confidence (low|medium|high), confidence_note.",
      },
      { role: "user", content: `Observations about ${name}:\n${obsText}` },
    ],
  });
}

/** Plain-text fallback check used by scripts: quick smoke test of the Groq key. */
export async function ping(): Promise<string> {
  return chat({ model: MODELS.speedDate, messages: [{ role: "user", content: "Say 'ready' and nothing else." }], maxTokens: 200 });
}

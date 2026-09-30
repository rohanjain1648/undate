import { chat, chatJson } from "../llm/groq";
import { MODELS } from "../llm/models";
import { Debrief, VenueProposal, VenueReply, type Profile } from "./schemas";

export type Persona = {
  id: string;
  name: string;
  first: string;
  headline: string;
  profile: Profile;
  evidence: string[]; // top cited observations, grounds the agent in real facts
};

export type Line = { speaker: "a" | "b" | "scene"; text: string };

export const SCENES = [
  "The waiter brings the wrong order to the table.",
  "It suddenly starts raining and you both have to dash for cover.",
  "A song comes on that one of you clearly knows every word to.",
  "One of your phones buzzes with a work message mid-sentence.",
  "The table next to you is having a loud, awkward breakup.",
  "There's a 20-minute wait for the thing you came to do.",
  "A stray dog wanders up and won't leave you alone.",
  "The power goes out for a minute and everything goes dark.",
  "You realise you both ordered exactly the same thing.",
  "The bill arrives and there's an awkward pause about who pays.",
  "A friend of one of you spots you and comes over to say hi.",
  "Someone nearby recognises the place from a viral video and starts filming.",
];

const trim = (s: string) =>
  s
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^[A-Z][a-z]+:\s*/, "") // drop "Name:" prefixes some models add
    .slice(0, 600);

function personaCard(p: Persona): string {
  const pr = p.profile;
  const t = (xs: { label: string; detail: string }[]) => xs.map((x) => `${x.label} (${x.detail})`).join("; ");
  return [
    `Name: ${p.name}. ${p.headline}`,
    `Who they are: ${pr.summary}`,
    `How they talk: ${pr.voice}`,
    `Needs in a partner: ${t(pr.needs)}`,
    `Hobbies: ${t(pr.hobbies)}`,
    `Interests: ${t(pr.interests)}`,
    `Values: ${t(pr.values)}`,
    `Lifestyle: ${Object.entries(pr.lifestyle).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    `Possible friction: ${t(pr.possible_friction)}`,
    `Things to bring up: ${pr.conversation_hooks.join(" | ")}`,
    `Real facts (from their LinkedIn/Instagram, don't invent beyond these):\n- ${p.evidence.slice(0, 12).join("\n- ")}`,
  ].join("\n");
}

function system(me: Persona, other: Persona, memory: string | null): string {
  return (
    `You are the dating agent for ${me.name}. You are on a date on ${me.first}'s behalf with ${other.first} (${other.headline || "no headline"}), who is represented by their own agent.\n` +
    `Speak as ${me.first}, in first person, in ${me.first}'s voice.\n\n${personaCard(me)}\n\n` +
    `Your private goal: find out honestly whether ${other.first} would be good for ${me.first}, especially whether they meet ${me.first}'s needs. ` +
    `Ask real questions, share real things about ${me.first}'s life from the facts above, react honestly. You are allowed to be unimpressed, to disagree, or to notice a mismatch. Do not flatter. ` +
    `Never invent jobs, places or events not supported by the facts; if something is unknown, keep it vague.\n` +
    (memory ? `\nThis is your SECOND date with ${other.first}. What you noted after the first date: ${memory}\nGo deeper on that, especially the concern.\n` : "") +
    `\nStyle: 1-3 sentences per message (max 55 words), natural spoken language, an occasional short *action* in asterisks is fine. No lists, no name prefix. ` +
    `Respond to what they just said first. Never repeat a question you already asked; if they dodged it, notice that. Move the conversation somewhere new each turn (values, how they spend a Sunday, what they want in a partner, a story).`
  );
}

function render(lines: Line[], a: Persona, b: Persona): string {
  return lines.map((l) => (l.speaker === "scene" ? `[SCENE: ${l.text}]` : `${l.speaker === "a" ? a.first : b.first}: ${l.text}`)).join("\n");
}

export async function planVenue(a: Persona, b: Persona, round: number, previousVenue?: string) {
  const proposal = await chatJson({
    model: MODELS.reason,
    fallbackModel: MODELS.reasonFallback,
    schema: VenueProposal,
    maxTokens: 800,
    temperature: 0.9,
    messages: [
      { role: "system", content: system(a, b, null) },
      {
        role: "user",
        content:
          `Propose a specific ${round === 2 ? "second-date" : "first-date"} plan that ${a.first} would genuinely enjoy, based on their hobbies and base city. ` +
          (previousVenue ? `Last time you went to: ${previousVenue}. Pick something different and a bit more personal. ` : "") +
          'JSON: {"venue":"specific kind of place + area","activity":"what you do","why":"why it fits ' + a.first + '","line":"what you say to propose it"}',
      },
    ],
  });
  const reply = await chatJson({
    model: MODELS.reason,
    fallbackModel: MODELS.reasonFallback,
    schema: VenueReply,
    maxTokens: 800,
    temperature: 0.8,
    messages: [
      { role: "system", content: system(b, a, null) },
      {
        role: "user",
        content:
          `${a.first} proposes: "${proposal.line}" (${proposal.venue}: ${proposal.activity}). ` +
          `Accept if ${b.first} would enjoy it, otherwise counter with something ${b.first} would prefer (you may compromise). ` +
          'JSON: {"accept":true|false,"counter_venue":null or "...","counter_activity":null or "...","line":"what you say back"}',
      },
    ],
  });
  const accepted = reply.accept || !reply.counter_venue;
  const venue = accepted ? proposal.venue : reply.counter_venue!;
  const activity = accepted || !reply.counter_activity ? proposal.activity : reply.counter_activity;
  return {
    venue: { name: venue, activity, why: accepted ? proposal.why : `${b.first}'s agent countered ${a.first}'s idea (${proposal.venue}) with this.`, proposed_by: "a" as const, accepted },
    lines: [
      { speaker: "a", text: trim(proposal.line) },
      { speaker: "b", text: trim(reply.line) },
    ] as Line[],
  };
}

/** Run the conversation. `onLine` is called after every message so the UI can stream it. */
export async function converse(opts: {
  a: Persona;
  b: Persona;
  round: number;
  venue: { name: string; activity: string };
  scene: string;
  turnsEach: number;
  memoryA: string | null;
  memoryB: string | null;
  lines: Line[];
  onLine: (lines: Line[]) => Promise<void>;
}) {
  const { a, b, turnsEach, lines } = opts;
  const model = opts.round === 2 ? MODELS.secondDate : MODELS.speedDate;
  const total = turnsEach * 2;
  for (let t = 0; t < total; t++) {
    if (t === Math.floor(total / 2)) {
      lines.push({ speaker: "scene", text: opts.scene });
      await opts.onLine(lines);
    }
    const speaker: "a" | "b" = t % 2 === 0 ? "a" : "b";
    const me = speaker === "a" ? a : b;
    const other = speaker === "a" ? b : a;
    const last = t >= total - 2;
    const text = await chat({
      model,
      temperature: 0.9,
      maxTokens: 700, // includes gpt-oss reasoning tokens; the reply itself is short
      messages: [
        { role: "system", content: system(me, other, speaker === "a" ? opts.memoryA : opts.memoryB) },
        {
          role: "user",
          content:
            `You're at: ${opts.venue.name} (${opts.venue.activity}).\n\nConversation so far:\n${render(lines, a, b)}\n\n` +
            (lines.at(-1)?.speaker === "scene" ? "React to what just happened, in character. " : "") +
            (last ? "The date is ending: wrap up naturally and honestly (say if you'd like to meet again or not). " : "") +
            `Write ${me.first}'s next message only.`,
        },
      ],
    });
    lines.push({ speaker, text: trim(text) || "*smiles*" });
    await opts.onLine(lines);
  }
  return lines;
}

export async function debrief(me: Persona, other: Persona, meSide: "a" | "b", lines: Line[], a: Persona, b: Persona, venue: string) {
  return chatJson({
    model: MODELS.reason,
    fallbackModel: MODELS.reasonFallback,
    schema: Debrief,
    maxTokens: 2000,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          `You are ${me.name}'s dating agent writing a PRIVATE debrief for ${me.first} after a date with ${other.first}. ${me.first} will read it. ` +
          `Judge only by what happened on the date against ${me.first}'s profile. Be honest and calibrated: 5 is neutral, 8+ is rare and must be earned, below 4 means a real mismatch. Most dates are 4-7.\n\n${personaCard(me)}`,
      },
      {
        role: "user",
        content:
          `Venue: ${venue}. You spoke as ${meSide === "a" ? a.first : b.first}.\n\nTranscript:\n${render(lines, a, b)}\n\n` +
          'JSON: {"scores":{"values":0-10,"lifestyle":0-10,"interests":0-10,"chemistry":0-10,"needs_met":0-10},"would_see_again":"yes|maybe|no","best_moment":"short quote or moment","concern":"biggest concern","verdict":"one line for ' +
          me.first +
          '","reasoning":"3-4 sentences"}',
      },
    ],
  });
}

/** 0-1 score of how good `d` (one agent's debrief) says the partner is for its person. */
export function debriefScore(d: { scores: Record<string, number>; would_see_again: string }): number {
  const s = d.scores;
  const w = (s.values + s.lifestyle + s.interests + s.chemistry + 2 * s.needs_met) / 60;
  const adj = d.would_see_again === "yes" ? 0.05 : d.would_see_again === "no" ? -0.1 : 0;
  return Math.max(0, Math.min(1, w + adj));
}

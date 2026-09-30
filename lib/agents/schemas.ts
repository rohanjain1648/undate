import { z } from "zod";

const score = z.coerce.number().min(0).max(10);
const refs = z.array(z.string()).default([]);

export const Trait = z.object({
  label: z.string(),
  detail: z.string().default(""),
  evidence: refs,
  confidence: z.coerce.number().min(0).max(1).default(0.6),
});
export type Trait = z.infer<typeof Trait>;

export const ImageNotes = z.object({
  images: z.array(
    z.object({
      ref: z.string(),
      scene: z.string(),
      activity: z.string().default(""),
      signals: z.array(z.string()).default([]),
    })
  ),
});
export type ImageNotes = z.infer<typeof ImageNotes>;

export const Observations = z.object({
  observations: z.array(
    z.object({
      fact: z.string(),
      source: z.string(),
      kind: z.enum(["career", "education", "hobby", "interest", "value", "lifestyle", "social", "personality", "other"]).catch("other"),
    })
  ),
});
export type Observations = z.infer<typeof Observations>;

const bigFive = z.object({ score, why: z.string().default("") });

export const Profile = z.object({
  summary: z.string(),
  voice: z.string().describe("how this person talks / writes, for the persona agent"),
  needs: z.array(Trait),
  hobbies: z.array(Trait),
  interests: z.array(Trait),
  values: z.array(Trait),
  personality: z.object({
    openness: bigFive,
    conscientiousness: bigFive,
    extraversion: bigFive,
    agreeableness: bigFive,
    neuroticism: bigFive,
  }),
  lifestyle: z.object({
    schedule: z.string().default("unknown"),
    social_energy: z.string().default("unknown"),
    travel: z.string().default("unknown"),
    fitness: z.string().default("unknown"),
    base: z.string().default("unknown"),
  }),
  love_language_guess: Trait,
  green_flags: z.array(Trait).default([]),
  possible_friction: z.array(Trait).default([]),
  ideal_first_date: z.string(),
  conversation_hooks: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).catch("medium"),
  confidence_note: z.string().default(""),
});
export type Profile = z.infer<typeof Profile>;

export const VenueProposal = z.object({
  venue: z.string(),
  activity: z.string(),
  why: z.string(),
  line: z.string().describe("what the agent says out loud to propose it"),
});
export const VenueReply = z.object({
  accept: z.boolean(),
  counter_venue: z.string().nullable().default(null),
  counter_activity: z.string().nullable().default(null),
  line: z.string(),
});

export const Debrief = z.object({
  scores: z.object({
    values: score,
    lifestyle: score,
    interests: score,
    chemistry: score,
    needs_met: score,
  }),
  would_see_again: z.enum(["yes", "maybe", "no"]).catch("maybe"),
  best_moment: z.string(),
  concern: z.string(),
  verdict: z.string().describe("one-line verdict for the ranking page"),
  reasoning: z.string(),
});
export type Debrief = z.infer<typeof Debrief>;

// All Groq model IDs in one place. Swap here if Groq changes its catalog
// (check with: GET https://api.groq.com/openai/v1/models).
export const MODELS = {
  vision: "qwen/qwen3.8-27b", // multimodal: reads Instagram photos
  reason: "openai/gpt-oss-120b", // observations, profile, venue planning, debriefs
  reasonFallback: "qwen/qwen3.8-27b",
  speedDate: "openai/gpt-oss-20b", // ~0.5s per turn, used for all round-1 date turns
  secondDate: "openai/gpt-oss-120b", // deeper round-2 dates
} as const;

// Max concurrent in-flight requests per model (keeps us under Groq RPM/TPM limits).
export const CONCURRENCY: Record<string, number> = {
  [MODELS.vision]: 3,
  [MODELS.reason]: 6,
  [MODELS.speedDate]: 12,
};

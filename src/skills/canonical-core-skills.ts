import { createCanonicalSkill } from "./canonical-skill-builder.js";
import type { CanonicalSkill } from "./types.js";

export const canonicalCoreSkills: readonly CanonicalSkill[] = [
  createCanonicalSkill(
    "find-skills",
    "find-skills",
    "overall",
    "general",
    "vercel-labs/skills",
    "3.1M",
    "Discover and install AI agent skills across the ecosystem",
    ["discovery", "catalog", "ecosystem"],
  ),
  createCanonicalSkill(
    "grill-me",
    "grill-me",
    "overall",
    "general",
    "mattpocock/skills",
    "936.7K",
    "Interactive design, architecture, and logic interrogation",
    ["interview", "architecture", "socratic"],
  ),
];

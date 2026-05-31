// Aggregates every vertical template pack. Consumed by convex/seed.ts.
import type { TemplatePack } from "./types";
import { constructionPack } from "./construction";
import { foodHospitalityPack } from "./foodHospitality";
import { transportPack } from "./transport";
import { manufacturingPack } from "./manufacturing";
import { retailPack } from "./retail";
import { facilitiesPack } from "./facilities";

export const packs: TemplatePack[] = [
  constructionPack,
  foodHospitalityPack,
  transportPack,
  manufacturingPack,
  retailPack,
  facilitiesPack,
];

export type { TemplatePack, TemplateDef, Section, Question } from "./types";

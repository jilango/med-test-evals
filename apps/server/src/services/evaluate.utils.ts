import type { Diagnosis, Medication } from "@test-evals/shared";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "or",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
]);

export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[^a-z0-9/%.'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s: string) {
  const norm = normalizeText(s);
  if (!norm) return [];
  return norm.split(" ").filter(Boolean);
}

export function tokenSetSimilarity(a: string, b: string) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function fuzzyScore(a: string | null | undefined, b: string | null | undefined) {
  const sa = (a ?? "").trim();
  const sb = (b ?? "").trim();
  if (!sa && !sb) return 1;
  if (!sa || !sb) return 0;
  return tokenSetSimilarity(sa, sb);
}

export function clamp01(x: number) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function f1(precision: number, recall: number) {
  if (precision <= 0 || recall <= 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export function normalizeDose(dose: string | null) {
  if (!dose) return null;
  return normalizeText(dose)
    .replace(/\s+/g, "")
    .replace(/milligrams?/g, "mg")
    .replace(/micrograms?/g, "mcg")
    .replace(/grams?/g, "g");
}

export function normalizeRoute(route: string | null) {
  if (!route) return null;
  const r = normalizeText(route).replace(/\./g, "");
  if (r === "po" || r === "oral" || r === "by mouth") return "po";
  if (r === "iv") return "iv";
  if (r === "im") return "im";
  if (r === "subcutaneous" || r === "sc" || r === "sq") return "sc";
  if (r === "inhaled" || r === "inh") return "inhaled";
  if (r === "topical" || r === "top") return "topical";
  if (r === "sl" || r === "sublingual") return "sl";
  return r;
}

export function normalizeFrequency(freq: string | null) {
  if (!freq) return null;
  const f = normalizeText(freq).replace(/\./g, "");
  const compact = f.replace(/\s+/g, " ").trim();
  if (compact === "bid" || compact === "2x daily" || compact === "twice daily")
    return "bid";
  if (compact === "tid" || compact === "3x daily" || compact === "three times daily")
    return "tid";
  if (compact === "qid" || compact === "4x daily" || compact === "four times daily")
    return "qid";
  if (compact === "daily" || compact === "once daily" || compact === "qd") return "qd";
  if (compact === "prn" || compact.includes("as needed")) return "prn";
  if (compact === "qhs" || compact.includes("at bedtime")) return "qhs";
  return compact.replace(/\s+/g, "");
}

export function medicationsMatch(a: Medication, b: Medication) {
  const nameOk = fuzzyScore(a.name, b.name) >= 0.8;
  if (!nameOk) return false;
  const doseA = normalizeDose(a.dose);
  const doseB = normalizeDose(b.dose);
  const freqA = normalizeFrequency(a.frequency);
  const freqB = normalizeFrequency(b.frequency);
  // require both present & equal, or both null
  const doseOk = doseA === doseB;
  const freqOk = freqA === freqB;
  return doseOk && freqOk;
}

export function greedySetMatch<T>(
  gold: T[],
  pred: T[],
  matchScore: (g: T, p: T) => number,
  threshold = 0.8,
) {
  const usedPred = new Set<number>();
  let matches = 0;
  let scoreSum = 0;

  for (let i = 0; i < gold.length; i++) {
    let bestJ = -1;
    let bestScore = -1;
    for (let j = 0; j < pred.length; j++) {
      if (usedPred.has(j)) continue;
      const s = matchScore(gold[i]!, pred[j]!);
      if (s > bestScore) {
        bestScore = s;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestScore >= threshold) {
      usedPred.add(bestJ);
      matches++;
      scoreSum += bestScore;
    }
  }

  return { matches, scoreSum };
}

export function diagnosisScore(g: Diagnosis, p: Diagnosis) {
  return fuzzyScore(g.description, p.description);
}

export function groundingTokens(value: string) {
  return tokenize(value).filter((t) => !STOPWORDS.has(t));
}

export function isGroundedValue(value: unknown, transcript: string) {
  if (value === null || value === undefined) return true;
  const tNorm = normalizeText(transcript);
  if (!tNorm) return false;

  if (typeof value === "number") {
    // numeric grounding: require the number string to appear
    const s = String(value);
    return tNorm.includes(s);
  }

  if (typeof value === "string") {
    const vNorm = normalizeText(value);
    if (!vNorm) return true;
    if (tNorm.includes(vNorm)) return true;
    // fallback: all informative tokens must appear somewhere
    const toks = groundingTokens(vNorm);
    if (!toks.length) return true;
    return toks.every((tok) => tNorm.includes(tok));
  }

  return true;
}


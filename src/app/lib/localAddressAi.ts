export interface LocalAddressInput {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
  ooaza: string;
  aza: string;
  koaza: string;
  banchi: string;
  building: string;
}

export interface LocalAddressCandidate {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
}

export interface LocalAddressCorrection {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
}

export interface LocalAddressCheckResult {
  isValidAddress: boolean;
  reason: string;
  confidence: number;
  corrected: LocalAddressCorrection | null;
}

interface CandidateScoring {
  candidate: LocalAddressCandidate;
  confidence: number;
  postalMatched: boolean;
  prefectureMatched: boolean;
  cityMatched: boolean;
  townMatched: boolean;
}

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const normalizeText = (value: string): string => {
  return value.normalize("NFKC").replace(/[ 　]/g, "").trim();
};

const normalizePostalCode = (value: string): string => {
  return value.replace(/[^\d]/g, "").slice(0, 7);
};

const isLooseMatch = (left: string, right: string): boolean => {
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
};

const composeTownInput = (input: LocalAddressInput): string => {
  return normalizeText(`${input.town}${input.ooaza}${input.aza}${input.koaza}`);
};

const toCorrection = (candidate: LocalAddressCandidate): LocalAddressCorrection => {
  return {
    postalCode: candidate.postalCode,
    prefecture: candidate.prefecture,
    city: candidate.city,
    town: candidate.town,
  };
};

const scoreCandidate = (
  input: LocalAddressInput,
  candidate: LocalAddressCandidate
): CandidateScoring => {
  const postalInput = normalizePostalCode(input.postalCode);
  const prefectureInput = normalizeText(input.prefecture);
  const cityInput = normalizeText(input.city);
  const townInput = composeTownInput(input);

  const postalCandidate = normalizePostalCode(candidate.postalCode);
  const prefectureCandidate = normalizeText(candidate.prefecture);
  const cityCandidate = normalizeText(candidate.city);
  const townCandidate = normalizeText(candidate.town);

  const weights = {
    postal: 0.34,
    prefecture: 0.22,
    city: 0.22,
    town: 0.22,
  } as const;

  let weightedScore = 0;
  let maxWeight = 0;

  const postalMatched = postalInput.length === 7 && postalInput === postalCandidate;
  if (postalInput.length === 7) {
    maxWeight += weights.postal;
    weightedScore += postalMatched ? weights.postal : 0;
  }

  const prefectureMatched = isLooseMatch(prefectureInput, prefectureCandidate);
  if (prefectureInput) {
    maxWeight += weights.prefecture;
    weightedScore += prefectureMatched
      ? prefectureInput === prefectureCandidate
        ? weights.prefecture
        : weights.prefecture * 0.65
      : 0;
  }

  const cityMatched = isLooseMatch(cityInput, cityCandidate);
  if (cityInput) {
    maxWeight += weights.city;
    weightedScore += cityMatched
      ? cityInput === cityCandidate
        ? weights.city
        : weights.city * 0.65
      : 0;
  }

  const townMatched = isLooseMatch(townInput, townCandidate);
  if (townInput) {
    maxWeight += weights.town;
    weightedScore += townMatched
      ? townInput === townCandidate
        ? weights.town
        : weights.town * 0.7
      : 0;
  }

  const confidence = maxWeight > 0 ? clamp(weightedScore / maxWeight, 0, 1) : 0;
  return {
    candidate,
    confidence,
    postalMatched,
    prefectureMatched,
    cityMatched,
    townMatched,
  };
};

const buildReason = (best: CandidateScoring, hasInputPostal: boolean): string => {
  const misses: string[] = [];
  if (hasInputPostal && !best.postalMatched) {
    misses.push("郵便番号");
  }
  if (!best.prefectureMatched) {
    misses.push("都道府県");
  }
  if (!best.cityMatched) {
    misses.push("市区町村");
  }
  if (!best.townMatched) {
    misses.push("町域");
  }

  if (misses.length === 0) {
    return "手入力住所と住所候補の一致度が高く、実在の可能性が高いです。";
  }

  return `${misses.join("・")}に不一致の可能性があります。候補住所を確認してください。`;
};

export const checkAddressWithLocalInference = async (params: {
  input: LocalAddressInput;
  candidates: LocalAddressCandidate[];
}): Promise<LocalAddressCheckResult> => {
  const candidates = params.candidates.filter((candidate) => {
    return Boolean(
      normalizeText(candidate.prefecture) ||
        normalizeText(candidate.city) ||
        normalizeText(candidate.town) ||
        normalizePostalCode(candidate.postalCode)
    );
  });

  if (candidates.length === 0) {
    return {
      isValidAddress: false,
      reason:
        "住所候補が見つかりませんでした。入力住所の都道府県・市区町村・町域を確認してください。",
      confidence: 0.12,
      corrected: null,
    };
  }

  const scored = candidates.map((candidate) => scoreCandidate(params.input, candidate));
  scored.sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];

  const hasInputPostal = normalizePostalCode(params.input.postalCode).length === 7;
  const hasCriticalMismatch =
    (normalizeText(params.input.prefecture) && !best.prefectureMatched) ||
    (normalizeText(params.input.city) && !best.cityMatched);
  const isValidAddress = !hasCriticalMismatch && best.confidence >= 0.82;
  const corrected =
    !isValidAddress && best.confidence >= 0.45 ? toCorrection(best.candidate) : null;

  return {
    isValidAddress,
    reason: buildReason(best, hasInputPostal),
    confidence: best.confidence,
    corrected,
  };
};

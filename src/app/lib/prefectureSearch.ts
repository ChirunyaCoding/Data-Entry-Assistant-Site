import {
  buildQueryTokens,
  matchesWithTokens,
  normalizeAscii,
  toKatakana,
  type MatchQueryTokens,
} from "./japaneseTextSearch.ts";

export interface PrefectureCandidate {
  prefecture: string;
  prefectureKana: string;
  prefectureRomaji: string;
}

const getSuggestionPriority = (
  target: { kanji: string; kana: string; romaji: string },
  tokens: MatchQueryTokens
): number => {
  if (tokens.romaji) {
    const normalizedRomaji = normalizeAscii(target.romaji);
    if (normalizedRomaji.startsWith(tokens.romaji)) {
      return 0;
    }
    if (tokens.romaji.length >= 2 && normalizedRomaji.includes(tokens.romaji)) {
      return 1;
    }
  }

  if (tokens.kana) {
    const katakana = toKatakana(target.kana);
    if (katakana.startsWith(tokens.kana)) {
      return 2;
    }
    if (katakana.includes(tokens.kana)) {
      return 3;
    }
  }

  if (target.kanji.startsWith(tokens.raw)) {
    return 4;
  }
  if (target.kanji.includes(tokens.raw)) {
    return 5;
  }

  return 6;
};

export const findPrefectureSuggestions = (
  prefectures: PrefectureCandidate[],
  rawQuery: string,
  limit = Number.POSITIVE_INFINITY
): string[] => {
  const tokens = buildQueryTokens(rawQuery);
  if (!tokens.raw) {
    return [];
  }

  return prefectures
    .filter((candidate) => {
      return matchesWithTokens(
        {
          kanji: candidate.prefecture,
          kana: candidate.prefectureKana,
          romaji: candidate.prefectureRomaji,
        },
        tokens
      );
    })
    .sort((a, b) => {
      const aPriority = getSuggestionPriority(
        {
          kanji: a.prefecture,
          kana: a.prefectureKana,
          romaji: a.prefectureRomaji,
        },
        tokens
      );
      const bPriority = getSuggestionPriority(
        {
          kanji: b.prefecture,
          kana: b.prefectureKana,
          romaji: b.prefectureRomaji,
        },
        tokens
      );

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      return a.prefecture.localeCompare(b.prefecture, "ja");
    })
    .map((candidate) => candidate.prefecture)
    .slice(0, limit);
};

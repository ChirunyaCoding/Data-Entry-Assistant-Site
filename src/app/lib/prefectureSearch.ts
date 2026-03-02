import { buildQueryTokens, matchesWithTokens } from "./japaneseTextSearch.ts";

export interface PrefectureCandidate {
  prefecture: string;
  prefectureKana: string;
  prefectureRomaji: string;
}

export const findPrefectureSuggestions = (
  prefectures: PrefectureCandidate[],
  rawQuery: string,
  limit = 10
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
    .map((candidate) => candidate.prefecture)
    .slice(0, limit);
};

import type { AddressQuery, KenAllAddress } from "./kenAll.ts";
import { buildQueryTokens, matchesWithTokens } from "./japaneseTextSearch.ts";

const uniqueBy = <T,>(items: T[], keyResolver: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const results: T[] = [];

  for (const item of items) {
    const key = keyResolver(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(item);
  }

  return results;
};

export const findCitySuggestions = (
  addresses: KenAllAddress[],
  query: AddressQuery,
  limit = 10
): KenAllAddress[] => {
  const prefecture = query.prefecture.trim();
  const cityQueryTokens = buildQueryTokens(query.city);
  const town = query.town.trim();

  if (!cityQueryTokens.raw || town) {
    return [];
  }

  const prefectureQueryTokens = buildQueryTokens(prefecture);

  const filtered = addresses.filter((address) => {
    if (
      prefecture &&
      !matchesWithTokens(
        {
          kanji: address.prefecture,
          kana: address.prefectureKana,
          romaji: address.prefectureRomaji,
        },
        prefectureQueryTokens
      )
    ) {
      return false;
    }

    return matchesWithTokens(
      {
        kanji: address.city,
        kana: address.cityKana,
        romaji: address.cityRomaji,
      },
      cityQueryTokens
    );
  });

  return uniqueBy(filtered, (address) => `${address.prefecture}|${address.city}`).slice(
    0,
    limit
  );
};

export const findTownSuggestions = (
  addresses: KenAllAddress[],
  query: AddressQuery,
  limit = 10
): KenAllAddress[] => {
  const prefecture = query.prefecture.trim();
  const cityQueryTokens = buildQueryTokens(query.city);
  const townQueryTokens = buildQueryTokens(query.town);

  if (!townQueryTokens.raw) {
    return [];
  }

  const prefectureQueryTokens = buildQueryTokens(prefecture);

  const filtered = addresses.filter((address) => {
    if (
      prefecture &&
      !matchesWithTokens(
        {
          kanji: address.prefecture,
          kana: address.prefectureKana,
          romaji: address.prefectureRomaji,
        },
        prefectureQueryTokens
      )
    ) {
      return false;
    }
    if (
      cityQueryTokens.raw &&
      !matchesWithTokens(
        {
          kanji: address.city,
          kana: address.cityKana,
          romaji: address.cityRomaji,
        },
        cityQueryTokens
      )
    ) {
      return false;
    }

    return matchesWithTokens(
      {
        kanji: address.town,
        kana: address.townKana,
        romaji: address.townRomaji,
      },
      townQueryTokens
    );
  });

  return uniqueBy(
    filtered,
    (address) => `${address.prefecture}|${address.city}|${address.town}`
  ).slice(0, limit);
};

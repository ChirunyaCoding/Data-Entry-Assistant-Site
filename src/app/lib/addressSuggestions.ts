import type { AddressQuery, KenAllAddress } from "./kenAll.ts";
import {
  buildQueryTokens,
  matchesWithTokens,
  romajiIncludes,
  romajiStartsWith,
  toKatakana,
  type MatchQueryTokens,
} from "./japaneseTextSearch.ts";

interface AddressSuggestionIndex {
  cityCandidates: KenAllAddress[];
  townCandidates: KenAllAddress[];
}

const ADDRESS_INDEX_CACHE = new WeakMap<KenAllAddress[], AddressSuggestionIndex>();

const getAddressSuggestionIndex = (
  addresses: KenAllAddress[]
): AddressSuggestionIndex => {
  const cached = ADDRESS_INDEX_CACHE.get(addresses);
  if (cached) {
    return cached;
  }

  const citySeen = new Set<string>();
  const townSeen = new Set<string>();
  const cityCandidates: KenAllAddress[] = [];
  const townCandidates: KenAllAddress[] = [];

  for (const address of addresses) {
    const cityKey = `${address.prefecture}|${address.city}`;
    if (!citySeen.has(cityKey)) {
      citySeen.add(cityKey);
      cityCandidates.push(address);
    }

    const townKey = `${address.prefecture}|${address.city}|${address.town}`;
    if (!townSeen.has(townKey)) {
      townSeen.add(townKey);
      townCandidates.push(address);
    }
  }

  const index = { cityCandidates, townCandidates };
  ADDRESS_INDEX_CACHE.set(addresses, index);
  return index;
};

const isSingleAsciiLetterQuery = (value: string): boolean => {
  const normalized = value.trim().normalize("NFKC");
  return /^[a-z]$/i.test(normalized);
};

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

const getSuggestionPriority = (
  target: { kanji: string; kana: string; romaji: string },
  tokens: MatchQueryTokens
): number => {
  if (tokens.romaji) {
    if (romajiStartsWith(target.romaji, tokens.romaji)) {
      return 0;
    }
    if (tokens.romaji.length >= 2 && romajiIncludes(target.romaji, tokens.romaji)) {
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

export const findCitySuggestions = (
  addresses: KenAllAddress[],
  query: AddressQuery,
  limit = Number.POSITIVE_INFINITY
): KenAllAddress[] => {
  const prefecture = query.prefecture.trim();
  if (isSingleAsciiLetterQuery(query.city)) {
    return [];
  }
  const cityQueryTokens = buildQueryTokens(query.city);
  if (!cityQueryTokens.raw) {
    return [];
  }

  const { cityCandidates } = getAddressSuggestionIndex(addresses);
  const prefectureQueryTokens = buildQueryTokens(prefecture);

  const filtered = cityCandidates.filter((address) => {
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

  const sorted = [...filtered].sort((a, b) => {
    const aPriority = getSuggestionPriority(
      {
        kanji: a.city,
        kana: a.cityKana,
        romaji: a.cityRomaji,
      },
      cityQueryTokens
    );
    const bPriority = getSuggestionPriority(
      {
        kanji: b.city,
        kana: b.cityKana,
        romaji: b.cityRomaji,
      },
      cityQueryTokens
    );

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const prefectureOrder = a.prefecture.localeCompare(b.prefecture, "ja");
    if (prefectureOrder !== 0) {
      return prefectureOrder;
    }

    return a.city.localeCompare(b.city, "ja");
  });

  return uniqueBy(sorted, (address) => `${address.prefecture}|${address.city}`).slice(0, limit);
};

export const findTownSuggestions = (
  addresses: KenAllAddress[],
  query: AddressQuery,
  limit = Number.POSITIVE_INFINITY
): KenAllAddress[] => {
  const prefecture = query.prefecture.trim();
  if (isSingleAsciiLetterQuery(query.town)) {
    return [];
  }
  const cityQueryTokens = buildQueryTokens(query.city);
  const townQueryTokens = buildQueryTokens(query.town);

  if (!townQueryTokens.raw) {
    return [];
  }

  const { townCandidates } = getAddressSuggestionIndex(addresses);
  const prefectureQueryTokens = buildQueryTokens(prefecture);

  const filtered = townCandidates.filter((address) => {
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

  const sorted = [...filtered].sort((a, b) => {
    const aPriority = getSuggestionPriority(
      {
        kanji: a.town,
        kana: a.townKana,
        romaji: a.townRomaji,
      },
      townQueryTokens
    );
    const bPriority = getSuggestionPriority(
      {
        kanji: b.town,
        kana: b.townKana,
        romaji: b.townRomaji,
      },
      townQueryTokens
    );

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const prefectureOrder = a.prefecture.localeCompare(b.prefecture, "ja");
    if (prefectureOrder !== 0) {
      return prefectureOrder;
    }

    const cityOrder = a.city.localeCompare(b.city, "ja");
    if (cityOrder !== 0) {
      return cityOrder;
    }

    return a.town.localeCompare(b.town, "ja");
  });

  return uniqueBy(
    sorted,
    (address) => `${address.prefecture}|${address.city}|${address.town}`
  ).slice(0, limit);
};

import { kanaToRomaji, toKatakana } from "./japaneseTextSearch.ts";

export interface KenAllAddress {
  postalCode: string;
  prefecture: string;
  prefectureKana: string;
  prefectureRomaji: string;
  city: string;
  cityKana: string;
  cityRomaji: string;
  town: string;
  townKana: string;
  townRomaji: string;
}

export interface AddressQuery {
  prefecture: string;
  city: string;
  town: string;
}

const KEN_ALL_CSV_URL = new URL("../../../KEN_ALL.CSV", import.meta.url).href;
const KEN_ALL_MIN_COLUMNS = 9;
const PARSE_YIELD_LINE_INTERVAL = 2500;

let kenAllCachePromise: Promise<KenAllAddress[]> | null = null;

const decodeKenAll = (buffer: ArrayBuffer): string => {
  const encodings = ["shift-jis", "windows-31j", "utf-8"];

  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      // 次の文字コード候補で再試行する
    }
  }

  throw new Error("KEN_ALL.CSV の文字コード判定に失敗しました");
};

const unquote = (value: string): string => value.replace(/^"|"$/g, "").trim();

const parseKenAllLine = (line: string): KenAllAddress | null => {
  const columns = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (columns.length < KEN_ALL_MIN_COLUMNS) {
    return null;
  }

  const postalCode = unquote(columns[2]).replace(/[^\d]/g, "");
  const prefectureKana = toKatakana(unquote(columns[3]));
  const cityKana = toKatakana(unquote(columns[4]));
  const townKanaRaw = toKatakana(unquote(columns[5]));
  const prefecture = unquote(columns[6]);
  const city = unquote(columns[7]);
  const townRaw = unquote(columns[8]);
  const town = townRaw === "以下に掲載がない場合" ? "" : townRaw;
  const townKana = town ? townKanaRaw : "";

  if (!postalCode || !prefecture || !city) {
    return null;
  }

  return {
    postalCode,
    prefecture,
    prefectureKana,
    prefectureRomaji: kanaToRomaji(prefectureKana),
    city,
    cityKana,
    cityRomaji: kanaToRomaji(cityKana),
    town,
    townKana,
    townRomaji: kanaToRomaji(townKana),
  };
};

export const loadKenAllData = async (): Promise<KenAllAddress[]> => {
  if (kenAllCachePromise) {
    return kenAllCachePromise;
  }

  kenAllCachePromise = (async () => {
    const response = await fetch(KEN_ALL_CSV_URL);
    if (!response.ok) {
      throw new Error(`KEN_ALL.CSV の取得に失敗しました: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const csvText = decodeKenAll(buffer);
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const parsed: KenAllAddress[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const address = parseKenAllLine(lines[i]);
      if (address) {
        parsed.push(address);
      }

      if ((i + 1) % PARSE_YIELD_LINE_INTERVAL === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 0);
        });
      }
    }

    return parsed;
  })();

  try {
    return await kenAllCachePromise;
  } catch (error) {
    kenAllCachePromise = null;
    throw error;
  }
};

export const searchKenAllAddresses = (
  addresses: KenAllAddress[],
  query: AddressQuery,
  limit = 10
): KenAllAddress[] => {
  const prefecture = query.prefecture.trim();
  const city = query.city.trim();
  const town = query.town.trim();

  if (!prefecture && !city && !town) {
    return [];
  }

  return addresses
    .filter((address) => {
      if (prefecture && !address.prefecture.includes(prefecture)) {
        return false;
      }
      if (city && !address.city.includes(city)) {
        return false;
      }
      if (town && !address.town.includes(town)) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
};

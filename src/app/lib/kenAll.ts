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
const KEN_ALL_INDEX_URL = `${import.meta.env.BASE_URL}ken_all_index.json`;
const KEN_ALL_MIN_COLUMNS = 9;
const PARSE_YIELD_LINE_INTERVAL = 2500;

const KEN_ALL_CACHE_DB_NAME = "data-entry-tool-cache-v1";
const KEN_ALL_CACHE_STORE = "ken_all";
const KEN_ALL_CACHE_KEY = "ken_all_index_v1";

let kenAllCachePromise: Promise<KenAllAddress[]> | null = null;

type KenAllTuple = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

const canUseIndexedDb = (): boolean => {
  return typeof indexedDB !== "undefined";
};

const openKenAllCacheDb = async (): Promise<IDBDatabase> => {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(KEN_ALL_CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEN_ALL_CACHE_STORE)) {
        db.createObjectStore(KEN_ALL_CACHE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const readKenAllCacheFromIndexedDb = async (): Promise<KenAllAddress[] | null> => {
  if (!canUseIndexedDb()) {
    return null;
  }

  try {
    const db = await openKenAllCacheDb();
    return await new Promise<KenAllAddress[] | null>((resolve) => {
      const tx = db.transaction(KEN_ALL_CACHE_STORE, "readonly");
      const store = tx.objectStore(KEN_ALL_CACHE_STORE);
      const request = store.get(KEN_ALL_CACHE_KEY);

      request.onsuccess = () => {
        const value = request.result as KenAllAddress[] | undefined;
        if (!Array.isArray(value)) {
          resolve(null);
          return;
        }
        resolve(value);
      };
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    });
  } catch {
    return null;
  }
};

const writeKenAllCacheToIndexedDb = async (addresses: KenAllAddress[]) => {
  if (!canUseIndexedDb()) {
    return;
  }

  try {
    const db = await openKenAllCacheDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(KEN_ALL_CACHE_STORE, "readwrite");
      tx.objectStore(KEN_ALL_CACHE_STORE).put(addresses, KEN_ALL_CACHE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // キャッシュ保存失敗は無視して続行
  }
};

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

const parseKenAllCsv = async (csvText: string): Promise<KenAllAddress[]> => {
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
};

const loadKenAllFromIndexJson = async (): Promise<KenAllAddress[] | null> => {
  try {
    const response = await fetch(KEN_ALL_INDEX_URL, {
      cache: "force-cache",
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return null;
    }

    if (payload.length === 0) {
      return null;
    }

    const first = payload[0];
    if (!Array.isArray(first)) {
      return payload as KenAllAddress[];
    }

    const addresses: KenAllAddress[] = [];
    for (const item of payload as KenAllTuple[]) {
      if (!Array.isArray(item) || item.length < 10) {
        continue;
      }
      addresses.push({
        postalCode: item[0],
        prefecture: item[1],
        prefectureKana: item[2],
        prefectureRomaji: item[3],
        city: item[4],
        cityKana: item[5],
        cityRomaji: item[6],
        town: item[7],
        townKana: item[8],
        townRomaji: item[9],
      });
    }

    if (addresses.length === 0) {
      return null;
    }
    return addresses;
  } catch {
    return null;
  }
};

const loadKenAllFromCsvFallback = async (): Promise<KenAllAddress[]> => {
  const response = await fetch(KEN_ALL_CSV_URL, {
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`KEN_ALL.CSV の取得に失敗しました: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const csvText = decodeKenAll(buffer);
  return await parseKenAllCsv(csvText);
};

export const loadKenAllData = async (): Promise<KenAllAddress[]> => {
  if (kenAllCachePromise) {
    return kenAllCachePromise;
  }

  kenAllCachePromise = (async () => {
    const cached = await readKenAllCacheFromIndexedDb();
    if (cached && cached.length > 0) {
      return cached;
    }

    const indexed = await loadKenAllFromIndexJson();
    if (indexed && indexed.length > 0) {
      void writeKenAllCacheToIndexedDb(indexed);
      return indexed;
    }

    const fallback = await loadKenAllFromCsvFallback();
    void writeKenAllCacheToIndexedDb(fallback);
    return fallback;
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

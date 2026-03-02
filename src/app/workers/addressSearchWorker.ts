/// <reference lib="webworker" />

import { findCitySuggestions, findTownSuggestions } from "../lib/addressSuggestions.ts";
import { type KenAllAddress, loadKenAllData } from "../lib/kenAll.ts";
import {
  type PrefectureCandidate,
  findPrefectureSuggestions,
} from "../lib/prefectureSearch.ts";

type InitRequest = { type: "init" };
type PostalQueryRequest = { type: "queryPostal"; id: number; postalCode: string };
type PrefectureQueryRequest = {
  type: "queryPrefecture";
  id: number;
  prefecture: string;
};
type CityQueryRequest = {
  type: "queryCity";
  id: number;
  prefecture: string;
  city: string;
  town: string;
};
type TownQueryRequest = {
  type: "queryTown";
  id: number;
  prefecture: string;
  city: string;
  town: string;
};

type WorkerRequest =
  | InitRequest
  | PostalQueryRequest
  | PrefectureQueryRequest
  | CityQueryRequest
  | TownQueryRequest;

type ReadyResponse = { type: "ready" };
type ErrorResponse = { type: "error"; message: string };
type PostalResultResponse = {
  type: "postalResult";
  id: number;
  suggestions: KenAllAddress[];
};
type PrefectureResultResponse = {
  type: "prefectureResult";
  id: number;
  suggestions: string[];
};
type CityResultResponse = {
  type: "cityResult";
  id: number;
  suggestions: KenAllAddress[];
};
type TownResultResponse = {
  type: "townResult";
  id: number;
  suggestions: KenAllAddress[];
};

type WorkerResponse =
  | ReadyResponse
  | ErrorResponse
  | PostalResultResponse
  | PrefectureResultResponse
  | CityResultResponse
  | TownResultResponse;

let addresses: KenAllAddress[] = [];
let prefectureCandidates: PrefectureCandidate[] = [];
let isInitialized = false;

const postResponse = (payload: WorkerResponse) => {
  self.postMessage(payload);
};

const dedupeAddresses = (items: KenAllAddress[]): KenAllAddress[] => {
  const seen = new Set<string>();
  const unique: KenAllAddress[] = [];

  for (const item of items) {
    const key = `${item.prefecture}|${item.city}|${item.town}|${item.postalCode}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }

  return unique;
};

const buildPrefectureCandidates = (records: KenAllAddress[]): PrefectureCandidate[] => {
  const map = new Map<string, PrefectureCandidate>();
  for (const address of records) {
    if (map.has(address.prefecture)) {
      continue;
    }
    map.set(address.prefecture, {
      prefecture: address.prefecture,
      prefectureKana: address.prefectureKana,
      prefectureRomaji: address.prefectureRomaji,
    });
  }
  return Array.from(map.values());
};

const ensureInitialized = async () => {
  if (isInitialized) {
    return;
  }

  addresses = await loadKenAllData();
  prefectureCandidates = buildPrefectureCandidates(addresses);
  isInitialized = true;
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    await ensureInitialized();

    if (message.type === "init") {
      postResponse({ type: "ready" });
      return;
    }

    if (message.type === "queryPostal") {
      const normalizedPostalCode = message.postalCode.replace(/[^\d]/g, "");
      if (!normalizedPostalCode) {
        postResponse({ type: "postalResult", id: message.id, suggestions: [] });
        return;
      }

      const suggestions = dedupeAddresses(
        addresses.filter((address) =>
          address.postalCode.startsWith(normalizedPostalCode)
        )
      );
      postResponse({ type: "postalResult", id: message.id, suggestions });
      return;
    }

    if (message.type === "queryPrefecture") {
      const suggestions = findPrefectureSuggestions(
        prefectureCandidates,
        message.prefecture
      );
      postResponse({ type: "prefectureResult", id: message.id, suggestions });
      return;
    }

    if (message.type === "queryCity") {
      const suggestions = findCitySuggestions(addresses, {
        prefecture: message.prefecture,
        city: message.city,
        town: message.town,
      });
      postResponse({ type: "cityResult", id: message.id, suggestions });
      return;
    }

    if (message.type === "queryTown") {
      const suggestions = findTownSuggestions(addresses, {
        prefecture: message.prefecture,
        city: message.city,
        town: message.town,
      });
      postResponse({ type: "townResult", id: message.id, suggestions });
      return;
    }
  } catch {
    postResponse({
      type: "error",
      message: "住所マスタの読み込みに失敗しました",
    });
  }
};

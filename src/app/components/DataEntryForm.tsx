import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Save,
  Upload,
  FileText,
  User,
  Trash2,
  Pencil,
  Table2,
  FileUser,
  Copy,
  ChevronDown,
  ChevronUp,
  Settings,
  X,
} from "lucide-react";
import { loadKenAllData, searchKenAllAddresses, type KenAllAddress } from "../lib/kenAll";
import { findCitySuggestions, findTownSuggestions } from "../lib/addressSuggestions";
import {
  checkAddressWithLocalInference,
  type LocalAddressCandidate,
  type LocalAddressCheckResult,
} from "../lib/localAddressAi";

interface FormData {
  operator: string;
  filename: string;
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
  ooaza: string;
  aza: string;
  koaza: string;
  banchi: string;
  building: string;
  company: string;
  position: string;
  name: string;
  phone: string;
  notes: string;
}

interface ResidentFormData {
  // 共通
  residentSelfName: string;
  // 転出
  departName: string;
  departPrefecture: string;
  departCity: string;
  departTown: string;
  departOoaza: string;
  departAza: string;
  departKoaza: string;
  departBanchi: string;
  departBuilding: string;
  // 本籍
  registryName: string;
  registryPrefecture: string;
  registryCity: string;
  registryTown: string;
  registryOoaza: string;
  registryAza: string;
  registryKoaza: string;
  registryBanchi: string;
  registryBuilding: string;
  residentAlias: string;
}

const DEFAULT_FORM_DATA: FormData = {
  operator: "",
  filename: "",
  postalCode: "",
  prefecture: "",
  city: "",
  town: "",
  ooaza: "",
  aza: "",
  koaza: "",
  banchi: "",
  building: "",
  company: "",
  position: "",
  name: "",
  phone: "",
  notes: "",
};

const DEFAULT_RESIDENT_FORM_DATA: ResidentFormData = {
  residentSelfName: "",
  departName: "",
  departPrefecture: "",
  departCity: "",
  departTown: "",
  departOoaza: "",
  departAza: "",
  departKoaza: "",
  departBanchi: "",
  departBuilding: "",
  registryName: "",
  registryPrefecture: "",
  registryCity: "",
  registryTown: "",
  registryOoaza: "",
  registryAza: "",
  registryKoaza: "",
  registryBanchi: "",
  registryBuilding: "",
  residentAlias: "",
};

interface SavedEntry extends FormData {
  id: number;
  savedAt: string;
  sheetRowsByTarget?: Record<string, number>;
}

interface SavedResidentEntry extends ResidentFormData {
  id: number;
  savedAt: string;
  sheetRowsByTarget?: Record<string, number>;
}

interface SheetWritePosition {
  sheetId: string;
  sheetName: string;
  row: number;
}

interface ResidentSecondaryEntry {
  id: number;
  fileName: string;
  name: string;
}

interface AddressCheckViewResult extends LocalAddressCheckResult {
  checkedAddress: string;
  referenceCandidateCount: number;
}

const FULL_WIDTH_SPACE = "　";
const SUGGESTION_ITEM_HEIGHT = 36;
const SUGGESTION_PANEL_MAX_HEIGHT = 288;
const SUGGESTION_OVERSCAN = 6;

const joinWithFullWidthSpace = (parts: string[]) => {
  return parts.filter(Boolean).join(FULL_WIDTH_SPACE);
};

const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const movingItem = next[fromIndex];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, movingItem);
  return next;
};

const buildSheetTargetKey = (sheetId: string, sheetName: string): string => {
  return `${sheetId}::${sheetName}`;
};

const normalizeSheetRow = (row: unknown): number | null => {
  if (typeof row !== "number" || !Number.isFinite(row)) {
    return null;
  }
  const normalized = Math.floor(row);
  return normalized >= 1 ? normalized : null;
};

const mergeSheetRowMap = (
  currentMap: Record<string, number> | undefined,
  position: SheetWritePosition | undefined
): Record<string, number> | undefined => {
  if (!position) {
    return currentMap;
  }
  const normalizedRow = normalizeSheetRow(position.row);
  if (normalizedRow === null) {
    return currentMap;
  }

  const targetKey = buildSheetTargetKey(position.sheetId, position.sheetName);
  if (currentMap?.[targetKey] === normalizedRow) {
    return currentMap;
  }

  return {
    ...(currentMap ?? {}),
    [targetKey]: normalizedRow,
  };
};

const resolveSheetRowFromMap = (
  sheetRowsByTarget: Record<string, number> | undefined,
  sheetId: string,
  sheetName: string
): number | undefined => {
  const targetKey = buildSheetTargetKey(sheetId, sheetName);
  const normalizedRow = normalizeSheetRow(sheetRowsByTarget?.[targetKey]);
  return normalizedRow ?? undefined;
};

type SuggestionType = "postal" | "prefecture" | "city" | "town";
type ResidentSection = "depart" | "registry";
type AddressSuggestionTarget = "basic" | ResidentSection;
type AddressSuggestionType = Exclude<SuggestionType, "postal">;

type WorkerRequest =
  | { type: "init" }
  | { type: "queryPostal"; id: number; postalCode: string }
  | { type: "queryPrefecture"; id: number; prefecture: string }
  | {
      type: "queryCity";
      id: number;
      prefecture: string;
      city: string;
      town: string;
    }
  | {
      type: "queryTown";
      id: number;
      prefecture: string;
      city: string;
      town: string;
    };

type WorkerResponse =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "postalResult"; id: number; suggestions: KenAllAddress[] }
  | { type: "prefectureResult"; id: number; suggestions: string[] }
  | { type: "cityResult"; id: number; suggestions: KenAllAddress[] }
  | { type: "townResult"; id: number; suggestions: KenAllAddress[] };

type WorkerQueryRequest = Omit<Exclude<WorkerRequest, { type: "init" }>, "id">;

const INITIAL_ACTIVE_SUGGESTION_INDEX: Record<SuggestionType, number> = {
  postal: -1,
  prefecture: -1,
  city: -1,
  town: -1,
};

const APP_SETTINGS_STORAGE_KEY = "data-entry-tool.settings.v1";
const SIMPLE_LOGIN_PASSED_STORAGE_KEY = "data-entry-tool.simple-login-passed.v1";
const SIMPLE_LOGIN_NAME = "admin";
const SIMPLE_LOGIN_PASS = "chihiro";
const ENV_BASIC_SHEET_WEBHOOK_URL = (
  import.meta.env.VITE_BASIC_SHEET_WEBHOOK_URL ?? ""
).trim();
const ENV_RESIDENT_SHEET_WEBHOOK_URL = (
  import.meta.env.VITE_RESIDENT_SHEET_WEBHOOK_URL ?? ""
).trim();
const ENV_BASIC_SHEET_URL = (import.meta.env.VITE_BASIC_SHEET_URL ?? "").trim();
const ENV_BASIC_SECONDARY_SHEET_URL = (
  import.meta.env.VITE_BASIC_SECONDARY_SHEET_URL ?? ""
).trim();
const ENV_RESIDENT_PRIMARY_SHEET_URL = (
  import.meta.env.VITE_RESIDENT_PRIMARY_SHEET_URL ?? ""
).trim();
const ENV_RESIDENT_SECONDARY_SHEET_URL = (
  import.meta.env.VITE_RESIDENT_SECONDARY_SHEET_URL ?? ""
).trim();
const ENV_GOOGLE_MAPS_EMBED_API_KEY = (
  import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY ?? ""
).trim();
const RESIDENT_SHEET_SELECTION_STORAGE_KEY =
  "data-entry-tool.resident-sheet-selection.v1";
const BASIC_SHEET_SELECTION_STORAGE_KEY = "data-entry-tool.basic-sheet-selection.v1";
const LEGACY_RESIDENT_TARGET_SHEET_NAME_STORAGE_KEY =
  "data-entry-tool.resident-target-sheet-name.v1";
const SHEET_TAB_SELECTION_STORAGE_KEY = "data-entry-tool.sheet-tab-selection.v1";
const RELOAD_STATE_STORAGE_KEY = "data-entry-tool.reload-state.v1";
const RELOAD_PDF_DB_NAME = "data-entry-tool.reload-cache.v1";
const RELOAD_PDF_STORE_NAME = "pdf";
const RELOAD_PDF_RECORD_KEY = "latest";
const BASIC_SHEET_START_ROW = 5;
const RESIDENT_SHEET_START_ROW = 6;
const RESIDENT_SECONDARY_SHEET_START_ROW = 3;
const DEFAULT_SHEET_WRITE_FONT_SIZE = 10;
const MIN_SHEET_WRITE_FONT_SIZE = 6;
const MAX_SHEET_WRITE_FONT_SIZE = 72;
const KANJI_ME_EMBED_URL = "https://kanji.me/";
type BasicSheetSelection = "basicPrimary" | "basicSecondary";
type ResidentSheetSelection = "residentPrimary" | "residentSecondary";
type BasicWriteSkipFieldName = "postalCode" | "prefecture" | "city" | "town";
type BasicWriteSkipFields = Record<BasicWriteSkipFieldName, boolean>;

const DEFAULT_BASIC_WRITE_SKIP_FIELDS: BasicWriteSkipFields = {
  postalCode: false,
  prefecture: false,
  city: false,
  town: false,
};

interface ReloadPersistedState {
  mode: "basic" | "resident";
  viewMode: "pdf" | "sheet" | "kanji";
  phoneInputMode: PhoneInputMode;
  formData: FormData;
  basicWriteSkipFields: BasicWriteSkipFields;
  residentFormData: ResidentFormData;
  savedEntries: SavedEntry[];
  savedResidentEntries: SavedResidentEntry[];
  residentSecondaryEntries: ResidentSecondaryEntry[];
}

const readStringField = (source: Record<string, unknown>, key: string): string => {
  const value = source[key];
  return typeof value === "string" ? value : "";
};

const normalizeBasicWriteSkipFieldsFromUnknown = (value: unknown): BasicWriteSkipFields => {
  const source = typeof value === "object" && value !== null ? value : {};
  const record = source as Record<string, unknown>;
  return {
    postalCode: record.postalCode === true,
    prefecture: record.prefecture === true,
    city: record.city === true,
    town: record.town === true,
  };
};

const normalizeFormDataFromUnknown = (value: unknown): FormData => {
  const source = typeof value === "object" && value !== null ? value : {};
  const record = source as Record<string, unknown>;
  return {
    operator: readStringField(record, "operator"),
    filename: readStringField(record, "filename"),
    postalCode: readStringField(record, "postalCode"),
    prefecture: readStringField(record, "prefecture"),
    city: readStringField(record, "city"),
    town: readStringField(record, "town"),
    ooaza: readStringField(record, "ooaza"),
    aza: readStringField(record, "aza"),
    koaza: readStringField(record, "koaza"),
    banchi: readStringField(record, "banchi"),
    building: readStringField(record, "building"),
    company: readStringField(record, "company"),
    position: readStringField(record, "position"),
    name: readStringField(record, "name"),
    phone: readStringField(record, "phone"),
    notes: readStringField(record, "notes"),
  };
};

const normalizeResidentFormDataFromUnknown = (value: unknown): ResidentFormData => {
  const source = typeof value === "object" && value !== null ? value : {};
  const record = source as Record<string, unknown>;
  return {
    residentSelfName: readStringField(record, "residentSelfName"),
    departName: readStringField(record, "departName"),
    departPrefecture: readStringField(record, "departPrefecture"),
    departCity: readStringField(record, "departCity"),
    departTown: readStringField(record, "departTown"),
    departOoaza: readStringField(record, "departOoaza"),
    departAza: readStringField(record, "departAza"),
    departKoaza: readStringField(record, "departKoaza"),
    departBanchi: readStringField(record, "departBanchi"),
    departBuilding: readStringField(record, "departBuilding"),
    registryName: readStringField(record, "registryName"),
    registryPrefecture: readStringField(record, "registryPrefecture"),
    registryCity: readStringField(record, "registryCity"),
    registryTown: readStringField(record, "registryTown"),
    registryOoaza: readStringField(record, "registryOoaza"),
    registryAza: readStringField(record, "registryAza"),
    registryKoaza: readStringField(record, "registryKoaza"),
    registryBanchi: readStringField(record, "registryBanchi"),
    registryBuilding: readStringField(record, "registryBuilding"),
    residentAlias: readStringField(record, "residentAlias"),
  };
};

const normalizeSheetRowsByTargetFromUnknown = (
  value: unknown
): Record<string, number> | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const entries = Object.entries(source).flatMap(([key, row]) => {
    const normalizedRow = normalizeSheetRow(row);
    return normalizedRow === null ? [] : ([[key, normalizedRow]] as const);
  });
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

const normalizeSavedEntriesFromUnknown = (value: unknown): SavedEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const normalizedId = normalizeSheetRow(record.id) ?? index + 1;
    return [
      {
        ...normalizeFormDataFromUnknown(record),
        id: normalizedId,
        savedAt: readStringField(record, "savedAt"),
        sheetRowsByTarget: normalizeSheetRowsByTargetFromUnknown(
          record.sheetRowsByTarget
        ),
      },
    ];
  });
};

const normalizeSavedResidentEntriesFromUnknown = (value: unknown): SavedResidentEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const normalizedId = normalizeSheetRow(record.id) ?? index + 1;
    return [
      {
        ...normalizeResidentFormDataFromUnknown(record),
        id: normalizedId,
        savedAt: readStringField(record, "savedAt"),
        sheetRowsByTarget: normalizeSheetRowsByTargetFromUnknown(
          record.sheetRowsByTarget
        ),
      },
    ];
  });
};

const normalizeResidentSecondaryEntriesFromUnknown = (
  value: unknown
): ResidentSecondaryEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const normalizedId = normalizeSheetRow(record.id) ?? index + 1;
    return [
      {
        id: normalizedId,
        fileName: readStringField(record, "fileName"),
        name: readStringField(record, "name"),
      },
    ];
  });
};

const openReloadPdfDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDBが利用できません。"));
      return;
    }

    const request = indexedDB.open(RELOAD_PDF_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RELOAD_PDF_STORE_NAME)) {
        database.createObjectStore(RELOAD_PDF_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
  });
};

const saveReloadPdfBlob = async (blob: Blob): Promise<void> => {
  const database = await openReloadPdfDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RELOAD_PDF_STORE_NAME, "readwrite");
      const store = transaction.objectStore(RELOAD_PDF_STORE_NAME);
      store.put({ id: RELOAD_PDF_RECORD_KEY, blob });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("PDFキャッシュの保存に失敗しました。"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("PDFキャッシュ保存が中断されました。"));
    });
  } finally {
    database.close();
  }
};

const loadReloadPdfBlob = async (): Promise<Blob | null> => {
  const database = await openReloadPdfDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const transaction = database.transaction(RELOAD_PDF_STORE_NAME, "readonly");
      const store = transaction.objectStore(RELOAD_PDF_STORE_NAME);
      const request = store.get(RELOAD_PDF_RECORD_KEY);
      request.onsuccess = () => {
        const result = request.result as { id: string; blob?: unknown } | undefined;
        resolve(result?.blob instanceof Blob ? result.blob : null);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("PDFキャッシュの読み込みに失敗しました。"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("PDFキャッシュ読み込みが中断されました。"));
    });
  } finally {
    database.close();
  }
};

const clearReloadPdfBlob = async (): Promise<void> => {
  const database = await openReloadPdfDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RELOAD_PDF_STORE_NAME, "readwrite");
      const store = transaction.objectStore(RELOAD_PDF_STORE_NAME);
      store.delete(RELOAD_PDF_RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("PDFキャッシュ削除に失敗しました。"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("PDFキャッシュ削除が中断されました。"));
    });
  } finally {
    database.close();
  }
};

const BASIC_FIELD_ORDER = [
  "operator",
  "filename",
  "postalCode",
  "prefecture",
  "city",
  "town",
  "ooaza",
  "aza",
  "koaza",
  "banchi",
  "building",
  "company",
  "position",
  "name",
  "phone",
  "notes",
] as const;

const DETAIL_ADDRESS_FIELDS = new Set<string>(["ooaza", "aza", "koaza"]);
const BASIC_ADDRESS_FIELDS_FOR_AI_CHECK = new Set<string>([
  "postalCode",
  "prefecture",
  "city",
  "town",
  "ooaza",
  "aza",
  "koaza",
  "banchi",
  "building",
]);
const RESIDENT_ADDRESS_FIELDS_FOR_ADDRESS_CHECK = new Set<string>([
  "departPrefecture",
  "departCity",
  "departTown",
  "departOoaza",
  "departAza",
  "departKoaza",
  "departBanchi",
  "departBuilding",
  "registryPrefecture",
  "registryCity",
  "registryTown",
  "registryOoaza",
  "registryAza",
  "registryKoaza",
  "registryBanchi",
  "registryBuilding",
]);
const RESIDENT_FIELD_ORDER = [
  "residentSelfName",
  "departName",
  "departPrefecture",
  "departCity",
  "departTown",
  "departOoaza",
  "departAza",
  "departKoaza",
  "departBanchi",
  "departBuilding",
  "registryName",
  "registryPrefecture",
  "registryCity",
  "registryTown",
  "registryOoaza",
  "registryAza",
  "registryKoaza",
  "registryBanchi",
  "registryBuilding",
  "residentAlias",
] as const;
const RESIDENT_DETAIL_ADDRESS_FIELDS = new Set<string>([
  "departOoaza",
  "departAza",
  "departKoaza",
  "registryOoaza",
  "registryAza",
  "registryKoaza",
  "residentAlias",
]);
type ResidentFieldName = (typeof RESIDENT_FIELD_ORDER)[number];

const isResidentFieldName = (fieldName: string): fieldName is ResidentFieldName => {
  return RESIDENT_FIELD_ORDER.includes(fieldName as ResidentFieldName);
};

const getResidentSectionFromFieldName = (
  fieldName: string
): ResidentSection | null => {
  if (fieldName.startsWith("depart")) {
    return "depart";
  }
  if (fieldName.startsWith("registry")) {
    return "registry";
  }
  return null;
};

const getResidentAddressFieldName = (
  section: ResidentSection,
  type: AddressSuggestionType
): keyof ResidentFormData => {
  if (section === "depart") {
    if (type === "prefecture") {
      return "departPrefecture";
    }
    if (type === "city") {
      return "departCity";
    }
    return "departTown";
  }

  if (type === "prefecture") {
    return "registryPrefecture";
  }
  if (type === "city") {
    return "registryCity";
  }
  return "registryTown";
};

type PhoneInputMode = "mobile" | "landline";

interface AppSettings {
  isOperatorFixed: boolean;
  fixedOperatorName: string;
  isFilenameFixed: boolean;
  fixedFilename: string;
  writeFontSize: number;
  isAddressCheckEnabled: boolean;
  isReloadStatePersistenceEnabled: boolean;
  isResidentSelfNameFixed: boolean;
  fixedResidentSelfName: string;
  isBasicSecondarySheetEnabled: boolean;
  isResidentSecondaryColumnBUppercase: boolean;
  basicSheetWebhookUrl: string;
  residentSheetWebhookUrl: string;
  basicSheetUrl: string;
  basicSecondarySheetUrl: string;
  residentPrimarySheetUrl: string;
  residentSecondarySheetUrl: string;
  googleMapsEmbedApiKey: string;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  isOperatorFixed: false,
  fixedOperatorName: "",
  isFilenameFixed: false,
  fixedFilename: "",
  writeFontSize: DEFAULT_SHEET_WRITE_FONT_SIZE,
  isAddressCheckEnabled: true,
  isReloadStatePersistenceEnabled: false,
  isResidentSelfNameFixed: false,
  fixedResidentSelfName: "",
  isBasicSecondarySheetEnabled: false,
  isResidentSecondaryColumnBUppercase: true,
  basicSheetWebhookUrl: ENV_BASIC_SHEET_WEBHOOK_URL,
  residentSheetWebhookUrl: ENV_RESIDENT_SHEET_WEBHOOK_URL,
  basicSheetUrl: ENV_BASIC_SHEET_URL,
  basicSecondarySheetUrl: ENV_BASIC_SECONDARY_SHEET_URL,
  residentPrimarySheetUrl: ENV_RESIDENT_PRIMARY_SHEET_URL,
  residentSecondarySheetUrl: ENV_RESIDENT_SECONDARY_SHEET_URL,
  googleMapsEmbedApiKey: ENV_GOOGLE_MAPS_EMBED_API_KEY,
};

type AppSettingsUrlField =
  | "basicSheetWebhookUrl"
  | "residentSheetWebhookUrl"
  | "basicSheetUrl"
  | "basicSecondarySheetUrl"
  | "residentPrimarySheetUrl"
  | "residentSecondarySheetUrl"
  | "googleMapsEmbedApiKey";

const ENV_URL_KEY_TO_SETTING_FIELD: Record<string, AppSettingsUrlField> = {
  VITE_BASIC_SHEET_WEBHOOK_URL: "basicSheetWebhookUrl",
  VITE_RESIDENT_SHEET_WEBHOOK_URL: "residentSheetWebhookUrl",
  VITE_BASIC_SHEET_URL: "basicSheetUrl",
  VITE_BASIC_SECONDARY_SHEET_URL: "basicSecondarySheetUrl",
  VITE_RESIDENT_PRIMARY_SHEET_URL: "residentPrimarySheetUrl",
  VITE_RESIDENT_SECONDARY_SHEET_URL: "residentSecondarySheetUrl",
  VITE_GOOGLE_MAPS_EMBED_API_KEY: "googleMapsEmbedApiKey",
};

const parseDotEnvUrlSettings = (
  envContent: string
): Partial<Pick<AppSettings, AppSettingsUrlField>> => {
  const parsedSettings: Partial<Pick<AppSettings, AppSettingsUrlField>> = {};
  const lines = envContent.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmedLine.startsWith("export ")
      ? trimmedLine.slice("export ".length).trim()
      : trimmedLine;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const rawKey = normalizedLine.slice(0, separatorIndex).trim().replace(/^\uFEFF/, "");
    const settingField = ENV_URL_KEY_TO_SETTING_FIELD[rawKey];
    if (!settingField) {
      continue;
    }

    let rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      rawValue = rawValue.slice(1, -1);
    }

    parsedSettings[settingField] = rawValue.trim();
  }

  return parsedSettings;
};

const normalizeSheetWriteFontSize = (value: unknown): number => {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SHEET_WRITE_FONT_SIZE;
  }

  const rounded = Math.floor(numericValue);
  if (rounded < MIN_SHEET_WRITE_FONT_SIZE) {
    return MIN_SHEET_WRITE_FONT_SIZE;
  }
  if (rounded > MAX_SHEET_WRITE_FONT_SIZE) {
    return MAX_SHEET_WRITE_FONT_SIZE;
  }
  return rounded;
};

const formatPostalCode = (rawValue: string): string => {
  const digits = rawValue.replace(/[^\d]/g, "").slice(0, 7);
  if (digits.length <= 3) {
    return digits;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
};

const splitByPattern = (digits: string, blocks: number[]): string => {
  let cursor = 0;
  const parts: string[] = [];

  for (const block of blocks) {
    if (cursor >= digits.length) {
      break;
    }
    const next = digits.slice(cursor, cursor + block);
    if (!next) {
      break;
    }
    parts.push(next);
    cursor += block;
  }

  if (cursor < digits.length) {
    parts.push(digits.slice(cursor));
  }

  return parts.join("-");
};

const formatPhoneNumber = (rawValue: string, mode: PhoneInputMode): string => {
  const digits = rawValue.replace(/[^\d]/g, "").slice(0, 11);
  if (!digits) {
    return "";
  }

  if (mode === "mobile" && (digits === "09" || digits === "08" || digits === "07")) {
    return `${digits}0`;
  }

  if (digits.startsWith("0289")) {
    return splitByPattern(digits.slice(0, 10), [4, 2, 4]);
  }

  if (mode === "mobile") {
    return splitByPattern(digits, [3, 4, 4]);
  }

  if (digits.startsWith("03") || digits.startsWith("06")) {
    return splitByPattern(digits, [2, 4, 4]);
  }

  if (digits.length <= 10) {
    return splitByPattern(digits, [3, 3, 4]);
  }

  return splitByPattern(digits, [3, 4, 4]);
};

const SHIFTED_NUMBER_TO_DIGIT_MAP: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};

const sanitizeTownValue = (rawValue: string): string => {
  return rawValue
    .replace(/以下に掲載がない場合/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim();
};

const toFullWidthDigits = (rawValue: string): string => {
  return rawValue.replace(/[0-9]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0xfee0)
  );
};

const toHalfWidthDigits = (rawValue: string): string => {
  return rawValue.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
};

const toFullWidthAlphabet = (rawValue: string): string => {
  return rawValue.replace(/[A-Za-z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0xfee0)
  );
};

const toHalfWidthAlphabet = (rawValue: string): string => {
  return rawValue.replace(/[Ａ-Ｚａ-ｚ]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
};

const formatBanchiValue = (
  rawValue: string,
  options?: {
    halfWidthAlphaNumeric?: boolean;
    halfWidthHyphen?: boolean;
  }
): string => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return "";
  }

  const shiftedNormalized = trimmed.replace(/[!@#$%^&*()]/g, (char) => {
    return SHIFTED_NUMBER_TO_DIGIT_MAP[char] ?? char;
  });
  const normalized = shiftedNormalized.normalize("NFKC");

  const normalizedAlphaNumeric = options?.halfWidthAlphaNumeric
    ? toHalfWidthAlphabet(toHalfWidthDigits(normalized))
    : toFullWidthAlphabet(toFullWidthDigits(normalized));

  return normalizedAlphaNumeric.replace(
    /[-‐‑‒–—―ｰ]/g,
    options?.halfWidthHyphen ? "-" : "－"
  );
};

const AREA_FIELD_PREFIXES = {
  ooaza: "大字",
  aza: "字",
  koaza: "小字",
  departOoaza: "大字",
  departAza: "字",
  departKoaza: "小字",
  registryOoaza: "大字",
  registryAza: "字",
  registryKoaza: "小字",
} as const;

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const formatAreaFieldValue = (fieldName: string, rawValue: string): string => {
  const prefix = AREA_FIELD_PREFIXES[fieldName as keyof typeof AREA_FIELD_PREFIXES];
  if (!prefix) {
    return rawValue;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return "";
  }

  const normalizedBody = trimmed.replace(
    new RegExp(`^(?:${escapeRegExp(prefix)}[\\s　]*)+`),
    ""
  );
  if (!normalizedBody) {
    return "";
  }

  return `${prefix}${normalizedBody}`;
};


const normalizeBuildingValue = (rawValue: string): string => {
  return toFullWidthAlphabet(toHalfWidthDigits(rawValue));
};

const COMPANY_SHORTCUT_MAP: Record<string, string> = {
  yu: "有限会社",
  ゆ: "有限会社",
  ka: "株式会社",
  か: "株式会社",
  go: "合同会社",
  gou: "合同会社",
  godo: "合同会社",
  goudou: "合同会社",
  ご: "合同会社",
  ごう: "合同会社",
  shi: "合資会社",
  si: "合資会社",
  し: "合資会社",
  goshi: "合資会社",
  goushi: "合資会社",
  ごうし: "合資会社",
  me: "合名会社",
  mei: "合名会社",
  め: "合名会社",
  めい: "合名会社",
  gomei: "合名会社",
  goumei: "合名会社",
  ごうめい: "合名会社",
};

const expandCompanyShortcut = (rawValue: string): string => {
  const key = rawValue.normalize("NFKC").trim().toLowerCase();
  if (!key) {
    return rawValue;
  }
  return COMPANY_SHORTCUT_MAP[key] ?? rawValue;
};

const POSITION_SHORTCUT_MAP: Record<string, string> = {
  da: "代表取締役　",
  だ: "代表取締役　",
};

const expandPositionShortcut = (rawValue: string): string => {
  const key = rawValue.normalize("NFKC").trim().toLowerCase();
  if (!key) {
    return rawValue;
  }
  return POSITION_SHORTCUT_MAP[key] ?? rawValue;
};

interface VirtualSuggestionListProps {
  count: number;
  activeIndex: number;
  getKey: (index: number) => string;
  getLabel: (index: number) => string;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

const VirtualSuggestionList = ({
  count,
  activeIndex,
  getKey,
  getLabel,
  onHover,
  onSelect,
}: VirtualSuggestionListProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const viewportHeight = Math.min(
    SUGGESTION_PANEL_MAX_HEIGHT,
    count * SUGGESTION_ITEM_HEIGHT
  );

  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / SUGGESTION_ITEM_HEIGHT) - SUGGESTION_OVERSCAN
  );
  const endIndex = Math.min(
    count,
    Math.ceil((scrollTop + viewportHeight) / SUGGESTION_ITEM_HEIGHT) +
      SUGGESTION_OVERSCAN
  );

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const itemTop = activeIndex * SUGGESTION_ITEM_HEIGHT;
    const itemBottom = itemTop + SUGGESTION_ITEM_HEIGHT;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (itemTop < viewTop) {
      container.scrollTop = itemTop;
      return;
    }
    if (itemBottom > viewBottom) {
      container.scrollTop = itemBottom - container.clientHeight;
    }
  }, [activeIndex]);

  return (
    <div
      ref={containerRef}
      className="max-h-72 overflow-y-auto"
      onScroll={(e) => {
        setScrollTop((e.target as HTMLDivElement).scrollTop);
      }}
    >
      <div
        className="relative"
        style={{ height: count * SUGGESTION_ITEM_HEIGHT }}
      >
        {Array.from(
          { length: Math.max(0, endIndex - startIndex) },
          (_, offset) => {
            const index = startIndex + offset;
            const isActive = activeIndex === index;

            return (
              <button
                key={getKey(index)}
                type="button"
                onClick={() => onSelect(index)}
                onMouseEnter={() => onHover(index)}
                className={`absolute left-0 right-0 text-left px-3 py-2 transition-colors text-sm text-gray-700 ${
                  isActive ? "bg-blue-100" : "hover:bg-blue-50"
                }`}
                style={{
                  top: index * SUGGESTION_ITEM_HEIGHT,
                  height: SUGGESTION_ITEM_HEIGHT,
                }}
              >
                {getLabel(index)}
              </button>
            );
          }
        )}
      </div>
    </div>
  );
};

const normalizeSheetUrl = (rawUrl: string): string => {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const isGoogleSheet = parsedUrl.hostname === "docs.google.com";
    if (!isGoogleSheet || !parsedUrl.pathname.includes("/spreadsheets/")) {
      return trimmedUrl;
    }

    parsedUrl.searchParams.delete("rm");
    parsedUrl.hash = "";

    if (!parsedUrl.pathname.includes("/edit")) {
      parsedUrl.pathname = parsedUrl.pathname
        .replace(/\/(pubhtml|preview|htmlview)(\/)?$/, "/edit")
        .replace(/\/$/, "");
      if (!parsedUrl.pathname.includes("/edit")) {
        parsedUrl.pathname = `${parsedUrl.pathname}/edit`;
      }
    }

    return parsedUrl.toString();
  } catch {
    return trimmedUrl;
  }
};

interface ResidentSheetWritePayload {
  action: "appendResidentRow";
  sheetId: string;
  sheetName: string;
  startRow: number;
  fontSize?: number;
  targetRow?: number;
  preferExistingRow?: boolean;
  values: {
    B: string;
    F: string;
    G: string;
    H: string;
    I: string;
    J: string;
    K: string;
    L: string;
  };
}

interface ResidentFolderSheetWriteRow {
  C: string;
  D: string;
  E: string;
}

interface ResidentFolderSheetWritePayload {
  action: "appendResidentFolderRows";
  sheetId: string;
  sheetName: string;
  startRow: number;
  fontSize?: number;
  rows: ResidentFolderSheetWriteRow[];
}

interface ResidentSecondarySheetWriteRow {
  B: string;
  C: string;
}

interface ResidentSecondarySheetWritePayload {
  action: "appendResidentSecondaryRows";
  sheetId: string;
  sheetName: string;
  startRow: number;
  fontSize?: number;
  rows: ResidentSecondarySheetWriteRow[];
}

interface BasicSheetWritePayload {
  action: "appendBasicRow";
  sheetId: string;
  sheetName: string;
  startRow: number;
  fontSize?: number;
  targetRow?: number;
  preferExistingRow?: boolean;
  values: {
    A: string;
    B: string;
    C: string;
    D: string;
    E: string;
    F: string;
    G: string;
    H: string;
    I: string;
    J: string;
  };
}

interface BasicFileNameSheetWritePayload {
  action: "appendBasicFileNameRows";
  sheetId: string;
  sheetName: string;
  startRow: number;
  fontSize?: number;
  fileNames: string[];
}

interface ResidentSheetListPayload {
  action: "listSheets";
  sheetId: string;
}

interface SheetClearPayload {
  action: "clearSheetRange";
  sheetId: string;
  sheetName: string;
  startRow: number;
  endRow: number;
  clearAllColumns: boolean;
  startColumn?: number;
  endColumn?: number;
}

interface SpreadsheetSheetTab {
  name: string;
  gid: string;
}

interface ResidentSheetWebhookResponse {
  ok: boolean;
  row?: number;
  rowsWritten?: number;
  startRow?: number;
  endRow?: number;
  sheetName?: string;
  sheetId?: string;
  clearedRange?: string;
  sheets?: SpreadsheetSheetTab[];
  message?: string;
}

const extractGoogleSheetId = (sheetUrl: string): string => {
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? "";
};

const buildSheetUrlWithGid = (rawUrl: string, gid: string | undefined): string => {
  const normalizedUrl = normalizeSheetUrl(rawUrl);
  if (!normalizedUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    if (gid) {
      parsedUrl.searchParams.set("gid", gid);
    }
    return parsedUrl.toString();
  } catch {
    return normalizedUrl;
  }
};

const joinResidentAddressForSheet = (parts: string[]): string => {
  return parts.map((part) => part.trim()).filter(Boolean).join("");
};

const joinBasicAddressForSheet = (parts: string[]): string => {
  return parts.map((part) => part.trim()).filter(Boolean).join("");
};

const buildManualBasicAddressText = (formData: FormData): string => {
  return [
    formData.prefecture,
    formData.city,
    formData.town,
    formData.ooaza,
    formData.aza,
    formData.koaza,
    formData.banchi,
    formData.building,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("");
};

const buildManualResidentAddressText = (
  formData: ResidentFormData,
  section: ResidentSection
): string => {
  if (section === "depart") {
    return [
      formData.departPrefecture,
      formData.departCity,
      formData.departTown,
      formData.departOoaza,
      formData.departAza,
      formData.departKoaza,
      formData.departBanchi,
      formData.departBuilding,
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("");
  }

  return [
    formData.registryPrefecture,
    formData.registryCity,
    formData.registryTown,
    formData.registryOoaza,
    formData.registryAza,
    formData.registryKoaza,
    formData.registryBanchi,
    formData.registryBuilding,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("");
};

const buildGoogleMapsEmbedSearchUrl = (address: string, apiKey: string): string => {
  const query = encodeURIComponent(address);
  const key = encodeURIComponent(apiKey);
  return `https://www.google.com/maps/embed/v1/search?key=${key}&q=${query}&language=ja&region=JP`;
};

const GOOGLE_GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

interface GoogleGeocodeApiResponse {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
  }>;
}

const fetchGoogleFormattedAddress = async (
  inputAddress: string,
  apiKey: string
): Promise<string> => {
  const requestUrl =
    `${GOOGLE_GEOCODE_ENDPOINT}?address=${encodeURIComponent(inputAddress)}` +
    `&key=${encodeURIComponent(apiKey)}&language=ja&region=jp`;
  const response = await fetch(requestUrl);
  if (!response.ok) {
    throw new Error(`Google住所検索に失敗しました（HTTP ${response.status}）。`);
  }

  const payload = (await response.json()) as GoogleGeocodeApiResponse;
  const status = String(payload.status ?? "").trim().toUpperCase();
  const errorMessage = String(payload.error_message ?? "").trim();

  if (status !== "OK") {
    if (status === "ZERO_RESULTS") {
      throw new Error("Googleで該当住所が見つかりませんでした。");
    }
    if (status === "REQUEST_DENIED") {
      throw new Error(
        `Google住所検索が拒否されました。Geocoding APIの有効化とAPIキー制限を確認してください。${
          errorMessage ? ` (${errorMessage})` : ""
        }`
      );
    }
    if (status === "OVER_QUERY_LIMIT") {
      throw new Error("Google住所検索の上限に達しました。時間をおいて再試行してください。");
    }
    throw new Error(
      `Google住所検索に失敗しました。${status}${errorMessage ? ` (${errorMessage})` : ""}`
    );
  }

  const formattedAddress = String(payload.results?.[0]?.formatted_address ?? "").trim();
  if (!formattedAddress) {
    throw new Error("Google検索結果の住所を取得できませんでした。");
  }

  return formattedAddress;
};

const isPdfFile = (file: File): boolean => {
  const normalizedName = file.name.toLowerCase();
  return file.type === "application/pdf" || normalizedName.endsWith(".pdf");
};

const TIFF_EXTENSION_PATTERN = /\.tiff?$/i;

const buildResidentFolderSheetRows = (files: File[]): ResidentFolderSheetWriteRow[] => {
  const tifEntries = files
    .map((file) => {
      const relativePath = (file.webkitRelativePath ?? "").trim();
      if (!relativePath) {
        return null;
      }
      if (!TIFF_EXTENSION_PATTERN.test(file.name)) {
        return null;
      }

      const segments = relativePath.split("/").filter((segment) => segment.length > 0);
      if (segments.length < 3) {
        return null;
      }

      return {
        rootFolder: segments[0],
        childFolder: segments[1],
        fileName: file.name,
        sortKey: relativePath,
      };
    })
    .filter(
      (
        entry
      ): entry is {
        rootFolder: string;
        childFolder: string;
        fileName: string;
        sortKey: string;
      } => entry !== null
    )
    .sort((a, b) => {
      const byChildFolder = a.childFolder.localeCompare(b.childFolder, "ja");
      if (byChildFolder !== 0) {
        return byChildFolder;
      }
      return a.sortKey.localeCompare(b.sortKey, "ja");
    });

  return tifEntries.map((entry) => ({
    C: entry.rootFolder,
    D: entry.childFolder,
    E: entry.fileName,
  }));
};

const buildBasicFileNamesFromFolder = (files: File[]): string[] => {
  return files
    .filter((file) => TIFF_EXTENSION_PATTERN.test(file.name))
    .sort((a, b) => {
      const aPath = (a.webkitRelativePath || a.name).trim();
      const bPath = (b.webkitRelativePath || b.name).trim();
      return aPath.localeCompare(bPath, "ja");
    })
    .map((file) => file.name.trim())
    .filter((fileName) => fileName.length > 0);
};

const forceFullWidthText = (rawValue: string): string => {
  const normalized = rawValue.normalize("NFKC");
  const withFullWidthSpace = normalized.replace(/ /g, FULL_WIDTH_SPACE);
  return withFullWidthSpace.replace(/[!-~]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0xfee0)
  );
};

const buildResidentSecondaryColumnBValue = (
  rawValue: string,
  shouldUppercase: boolean
): string => {
  const normalized = rawValue.normalize("NFKC");
  const transformed = shouldUppercase ? normalized.toUpperCase() : normalized;
  return forceFullWidthText(transformed);
};

const buildResidentSecondaryEntriesFromFiles = (
  files: File[]
): ResidentSecondaryEntry[] => {
  return files
    .filter((file) => TIFF_EXTENSION_PATTERN.test(file.name))
    .sort((a, b) => {
      const aPath = (a.webkitRelativePath || a.name).trim();
      const bPath = (b.webkitRelativePath || b.name).trim();
      return aPath.localeCompare(bPath, "ja");
    })
    .map((file, index) => ({
      id: index + 1,
      fileName: forceFullWidthText(file.name.trim()),
      name: "",
    }))
    .filter((entry) => entry.fileName.length > 0);
};

type ResidentSheetWebhookPayload =
  | ResidentSheetWritePayload
  | ResidentFolderSheetWritePayload
  | ResidentSecondarySheetWritePayload
  | ResidentSheetListPayload
  | BasicSheetWritePayload
  | BasicFileNameSheetWritePayload
  | SheetClearPayload;

interface SheetWebhookConfig {
  envName: "VITE_BASIC_SHEET_WEBHOOK_URL" | "VITE_RESIDENT_SHEET_WEBHOOK_URL";
  url: string;
}

const postSheetWebhook = async (
  payload: ResidentSheetWebhookPayload,
  webhookConfig: SheetWebhookConfig,
  actionLabel: string
): Promise<ResidentSheetWebhookResponse> => {
  if (!webhookConfig.url) {
    throw new Error(
      `${webhookConfig.envName} が未設定のため、${actionLabel}を実行できません。`
    );
  }

  const requestBody = new URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();

  const response = await fetch(webhookConfig.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: requestBody,
  });

  const responseText = await response.text();
  let responseBody: ResidentSheetWebhookResponse | null = null;
  if (responseText) {
    try {
      responseBody = JSON.parse(responseText) as ResidentSheetWebhookResponse;
    } catch {
      const snippet = responseText.slice(0, 120).replace(/\s+/g, " ").trim();
      throw new Error(
        `Webhookの応答がJSONではありません。Apps Scriptの公開設定を確認してください。応答先頭: ${snippet}`
      );
    }
  }

  if (!response.ok) {
    throw new Error(
      responseBody?.message ??
        `Webhookリクエストに失敗しました（HTTP ${response.status}）`
    );
  }

  if (!responseBody) {
    throw new Error(
      "Webhook応答が空です。Apps Scriptの返却値（JSON）を確認してください。"
    );
  }

  if (responseBody.ok !== true) {
    throw new Error(responseBody.message ?? "Webhook実行に失敗しました。");
  }

  return responseBody;
};

const fetchSpreadsheetSheetTabs = async (
  sheetId: string,
  webhookConfig: SheetWebhookConfig
): Promise<SpreadsheetSheetTab[]> => {
  const responseBody = await postSheetWebhook(
    {
      action: "listSheets",
      sheetId,
    },
    webhookConfig,
    "シートタブ取得"
  );

  if (responseBody.sheetId && responseBody.sheetId !== sheetId) {
    throw new Error(
      "Webhook応答の sheetId が不一致です。Apps Scriptを最新コードへ更新してください。"
    );
  }

  const rawSheets = responseBody.sheets;
  if (!Array.isArray(rawSheets)) {
    throw new Error(
      "Webhook応答に sheets がありません。Apps Scriptを最新コードへ更新してください。"
    );
  }

  const normalizedSheets = rawSheets
    .map((sheet) => ({
      name: typeof sheet.name === "string" ? sheet.name.trim() : "",
      gid:
        typeof sheet.gid === "string"
          ? sheet.gid.trim()
          : String(sheet.gid ?? "").trim(),
    }))
    .filter((sheet) => sheet.name.length > 0 && sheet.gid.length > 0);

  if (normalizedSheets.length === 0) {
    throw new Error("シートタブ一覧が空です。共有設定とApps Scriptを確認してください。");
  }

  return normalizedSheets;
};

const postResidentSheetPayload = async (
  payload: ResidentSheetWritePayload,
  webhookConfig: SheetWebhookConfig
): Promise<ResidentSheetWebhookResponse> => {
  const responseBody = await postSheetWebhook(
    payload,
    webhookConfig,
    "住民票シート書き込み"
  );

  if (responseBody.sheetName !== payload.sheetName) {
    throw new Error(
      "Webhook応答に sheetName が含まれていないか不一致です。Apps Scriptを最新コードへ更新してください。"
    );
  }

  return responseBody;
};

const postBasicSheetPayload = async (
  payload: BasicSheetWritePayload,
  webhookConfig: SheetWebhookConfig
): Promise<ResidentSheetWebhookResponse> => {
  const responseBody = await postSheetWebhook(
    payload,
    webhookConfig,
    "基本シート書き込み"
  );

  if (responseBody.sheetName !== payload.sheetName) {
    throw new Error(
      "Webhook応答に sheetName が含まれていないか不一致です。Apps Scriptを最新コードへ更新してください。"
    );
  }

  return responseBody;
};

export function DataEntryForm() {
  const [isSimpleLoginPassed, setIsSimpleLoginPassed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    try {
      return window.localStorage.getItem(SIMPLE_LOGIN_PASSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [simpleLoginName, setSimpleLoginName] = useState("");
  const [simpleLoginPass, setSimpleLoginPass] = useState("");
  const [simpleLoginError, setSimpleLoginError] = useState("");
  const [mode, setMode] = useState<"basic" | "resident">("basic");
  const [showNotes, setShowNotes] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsHydrated, setIsSettingsHydrated] = useState(false);
  const [isReloadStateReady, setIsReloadStateReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    ...DEFAULT_APP_SETTINGS,
  });
  const settingsEnvFileInputRef = useRef<HTMLInputElement | null>(null);
  const [settingsEnvImportMessage, setSettingsEnvImportMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [phoneInputMode, setPhoneInputMode] = useState<PhoneInputMode>("mobile");
  const [formData, setFormData] = useState<FormData>({
    ...DEFAULT_FORM_DATA,
  });
  const [basicWriteSkipFields, setBasicWriteSkipFields] = useState<BasicWriteSkipFields>({
    ...DEFAULT_BASIC_WRITE_SKIP_FIELDS,
  });

  const [residentFormData, setResidentFormData] = useState<ResidentFormData>({
    ...DEFAULT_RESIDENT_FORM_DATA,
  });

  const [pdfFile, setPdfFile] = useState<string | null>(null);
  const [savedEntries, setSavedEntries] = useState<SavedEntry[]>([]);
  const [savedResidentEntries, setSavedResidentEntries] = useState<SavedResidentEntry[]>([]);
  const [editingBasicEntryId, setEditingBasicEntryId] = useState<number | null>(null);
  const [editingResidentEntryId, setEditingResidentEntryId] = useState<number | null>(
    null
  );
  const [residentSecondaryEntries, setResidentSecondaryEntries] = useState<
    ResidentSecondaryEntry[]
  >([]);
  const [residentSecondaryWritingEntryId, setResidentSecondaryWritingEntryId] =
    useState<number | null>(null);
  const [basicListWritingEntryId, setBasicListWritingEntryId] = useState<number | null>(
    null
  );
  const [residentListWritingEntryId, setResidentListWritingEntryId] =
    useState<number | null>(null);
  const [isBasicSheetSaving, setIsBasicSheetSaving] = useState(false);
  const [isBasicFolderImporting, setIsBasicFolderImporting] = useState(false);
  const [basicSheetSyncError, setBasicSheetSyncError] = useState("");
  const [basicSheetSyncSuccess, setBasicSheetSyncSuccess] = useState("");
  const [isBasicAddressAiChecking, setIsBasicAddressAiChecking] = useState(false);
  const [basicAddressAiError, setBasicAddressAiError] = useState("");
  const [basicAddressAiResult, setBasicAddressAiResult] =
    useState<AddressCheckViewResult | null>(null);
  const [basicMapSearchError, setBasicMapSearchError] = useState("");
  const [basicMapEmbedUrl, setBasicMapEmbedUrl] = useState("");
  const [basicMapDisplayedAddress, setBasicMapDisplayedAddress] = useState("");
  const [isBasicMapLoaded, setIsBasicMapLoaded] = useState(false);
  const [isBasicMapResolving, setIsBasicMapResolving] = useState(false);
  const [residentAddressCheckErrorBySection, setResidentAddressCheckErrorBySection] =
    useState<Record<ResidentSection, string>>({
      depart: "",
      registry: "",
    });
  const [residentAddressCheckResultBySection, setResidentAddressCheckResultBySection] =
    useState<Record<ResidentSection, AddressCheckViewResult | null>>({
      depart: null,
      registry: null,
    });
  const [residentAddressCheckingBySection, setResidentAddressCheckingBySection] =
    useState<Record<ResidentSection, boolean>>({
      depart: false,
      registry: false,
    });
  const [residentMapSearchErrorBySection, setResidentMapSearchErrorBySection] = useState<
    Record<ResidentSection, string>
  >({
    depart: "",
    registry: "",
  });
  const [residentMapEmbedUrlBySection, setResidentMapEmbedUrlBySection] = useState<
    Record<ResidentSection, string>
  >({
    depart: "",
    registry: "",
  });
  const [residentMapDisplayedAddressBySection, setResidentMapDisplayedAddressBySection] =
    useState<Record<ResidentSection, string>>({
      depart: "",
      registry: "",
    });
  const [residentMapLoadedBySection, setResidentMapLoadedBySection] = useState<
    Record<ResidentSection, boolean>
  >({
    depart: false,
    registry: false,
  });
  const [residentMapResolvingBySection, setResidentMapResolvingBySection] = useState<
    Record<ResidentSection, boolean>
  >({
    depart: false,
    registry: false,
  });
  const [isResidentSheetSaving, setIsResidentSheetSaving] = useState(false);
  const [isResidentFolderImporting, setIsResidentFolderImporting] = useState(false);
  const [residentSheetSyncError, setResidentSheetSyncError] = useState("");
  const [residentSheetSyncSuccess, setResidentSheetSyncSuccess] = useState("");
  const [isSheetInitializing, setIsSheetInitializing] = useState(false);
  const [sheetInitializeError, setSheetInitializeError] = useState("");
  const [sheetInitializeSuccess, setSheetInitializeSuccess] = useState("");
  const [viewMode, setViewMode] = useState<"pdf" | "sheet" | "kanji">("pdf");
  const [basicSheetSelection, setBasicSheetSelection] = useState<BasicSheetSelection>(() => {
    if (typeof window === "undefined") {
      return "basicPrimary";
    }

    try {
      const savedSelection = window.localStorage.getItem(
        BASIC_SHEET_SELECTION_STORAGE_KEY
      );
      return savedSelection === "basicSecondary" ? "basicSecondary" : "basicPrimary";
    } catch {
      return "basicPrimary";
    }
  });
  const [residentSheetSelection, setResidentSheetSelection] =
    useState<ResidentSheetSelection>(() => {
      if (typeof window === "undefined") {
        return "residentPrimary";
      }

      try {
        const savedSelection = window.localStorage.getItem(
          RESIDENT_SHEET_SELECTION_STORAGE_KEY
        );
        return savedSelection === "residentSecondary"
          ? "residentSecondary"
          : "residentPrimary";
      } catch {
        return "residentPrimary";
      }
    });
  const [sheetTabsBySheetId, setSheetTabsBySheetId] = useState<
    Record<string, SpreadsheetSheetTab[]>
  >({});
  const [sheetTabLoadingBySheetId, setSheetTabLoadingBySheetId] = useState<
    Record<string, boolean>
  >({});
  const [sheetTabErrorBySheetId, setSheetTabErrorBySheetId] = useState<
    Record<string, string>
  >({});
  const [selectedSheetTabBySheetId, setSelectedSheetTabBySheetId] = useState<
    Record<string, string>
  >(() => {
    if (typeof window === "undefined") {
      return {};
    }

    try {
      const saved = window.localStorage.getItem(SHEET_TAB_SELECTION_STORAGE_KEY);
      const parsed = saved ? (JSON.parse(saved) as Record<string, unknown>) : {};
      const normalizedSelections: Record<string, string> = {};

      if (parsed && typeof parsed === "object") {
        for (const [sheetId, sheetName] of Object.entries(parsed)) {
          if (typeof sheetName === "string") {
            normalizedSelections[sheetId] = sheetName;
          }
        }
      }

      const legacySheetName = (
        window.localStorage.getItem(LEGACY_RESIDENT_TARGET_SHEET_NAME_STORAGE_KEY) ?? ""
      ).trim();
      if (legacySheetName) {
        const residentPrimaryId = extractGoogleSheetId(
          DEFAULT_APP_SETTINGS.residentPrimarySheetUrl
        );
        const residentSecondaryId = extractGoogleSheetId(
          DEFAULT_APP_SETTINGS.residentSecondarySheetUrl
        );
        if (residentPrimaryId && !normalizedSelections[residentPrimaryId]) {
          normalizedSelections[residentPrimaryId] = legacySheetName;
        }
        if (residentSecondaryId && !normalizedSelections[residentSecondaryId]) {
          normalizedSelections[residentSecondaryId] = legacySheetName;
        }
      }

      return normalizedSelections;
    } catch {
      return {};
    }
  });
  const configuredSheetUrls = {
    basicPrimary: settings.basicSheetUrl.trim(),
    basicSecondary: settings.basicSecondarySheetUrl.trim(),
    residentPrimary: settings.residentPrimarySheetUrl.trim(),
    residentSecondary: settings.residentSecondarySheetUrl.trim(),
  } as const;
  const effectiveBasicSheetSelection: BasicSheetSelection =
    settings.isBasicSecondarySheetEnabled ? basicSheetSelection : "basicPrimary";
  const basicSheetWebhookConfig: SheetWebhookConfig = {
    envName: "VITE_BASIC_SHEET_WEBHOOK_URL",
    url: settings.basicSheetWebhookUrl.trim(),
  };
  const residentSheetWebhookConfig: SheetWebhookConfig = {
    envName: "VITE_RESIDENT_SHEET_WEBHOOK_URL",
    url: settings.residentSheetWebhookUrl.trim(),
  };
  const activeSheetWebhookConfig =
    mode === "basic" ? basicSheetWebhookConfig : residentSheetWebhookConfig;
  const activeSheetUrl =
    mode === "basic"
      ? configuredSheetUrls[effectiveBasicSheetSelection]
      : configuredSheetUrls[residentSheetSelection];
  const activeSheetId = extractGoogleSheetId(activeSheetUrl);
  const hasLoadedActiveSheetTabs = activeSheetId
    ? Object.prototype.hasOwnProperty.call(sheetTabsBySheetId, activeSheetId)
    : false;
  const activeSheetTabs = activeSheetId ? sheetTabsBySheetId[activeSheetId] ?? [] : [];
  const activeSelectedSheetName = activeSheetId
    ? selectedSheetTabBySheetId[activeSheetId] ?? ""
    : "";
  const activeSelectedSheetGid = activeSheetTabs.find(
    (sheet) => sheet.name === activeSelectedSheetName
  )?.gid;
  const sheetEmbedUrl = buildSheetUrlWithGid(activeSheetUrl, activeSelectedSheetGid);
  const isActiveSheetTabLoading = activeSheetId
    ? Boolean(sheetTabLoadingBySheetId[activeSheetId])
    : false;
  const activeSheetTabError = activeSheetId
    ? sheetTabErrorBySheetId[activeSheetId] ?? ""
    : "";
  const isInitializeButtonDisabled =
    isSheetInitializing ||
    isActiveSheetTabLoading ||
    activeSheetTabs.length === 0 ||
    !activeSelectedSheetName;
  const residentSecondaryNamedEntryCount = residentSecondaryEntries.filter(
    (entry) => entry.name.trim().length > 0
  ).length;
  const isResidentSecondaryEntryWriting = residentSecondaryWritingEntryId !== null;
  const isBasicListEntryWriting = basicListWritingEntryId !== null;
  const isResidentListEntryWriting = residentListWritingEntryId !== null;
  const hasBasicAddressAiCorrection = Boolean(
    basicAddressAiResult?.corrected &&
      (basicAddressAiResult.corrected.postalCode ||
        basicAddressAiResult.corrected.prefecture ||
        basicAddressAiResult.corrected.city ||
        basicAddressAiResult.corrected.town)
  );
  const hasDepartAddressCheckCorrection = Boolean(
    residentAddressCheckResultBySection.depart?.corrected &&
      (residentAddressCheckResultBySection.depart.corrected.postalCode ||
        residentAddressCheckResultBySection.depart.corrected.prefecture ||
        residentAddressCheckResultBySection.depart.corrected.city ||
        residentAddressCheckResultBySection.depart.corrected.town)
  );
  const hasRegistryAddressCheckCorrection = Boolean(
    residentAddressCheckResultBySection.registry?.corrected &&
      (residentAddressCheckResultBySection.registry.corrected.postalCode ||
        residentAddressCheckResultBySection.registry.corrected.prefecture ||
        residentAddressCheckResultBySection.registry.corrected.city ||
        residentAddressCheckResultBySection.registry.corrected.town)
  );
  const residentTargetSheetName = mode === "resident" ? activeSelectedSheetName : "";
  const sheetSelectionMessage =
    mode === "basic"
      ? settings.isBasicSecondarySheetEnabled
        ? `基本モードでは${
            effectiveBasicSheetSelection === "basicPrimary"
              ? "基本シート1"
              : "基本シート2"
          }を表示中です。`
        : "基本モードでは基本シート1を表示中です。"
      : `住民票モードでは${
          residentSheetSelection === "residentPrimary"
            ? "住民票シート1"
            : "住民票シート2"
        }を表示中です。`;
  const isBasicSecondarySheetMode =
    mode === "basic" && effectiveBasicSheetSelection === "basicSecondary";
  const [isKenAllLoading, setIsKenAllLoading] = useState(false);
  const [kenAllLoadError, setKenAllLoadError] = useState<string | null>(null);
  const [postalCodeSuggestions, setPostalCodeSuggestions] = useState<KenAllAddress[]>([]);
  const [prefectureSuggestions, setPrefectureSuggestions] = useState<string[]>([]);
  const [citySuggestions, setCitySuggestions] = useState<KenAllAddress[]>([]);
  const [townSuggestions, setTownSuggestions] = useState<KenAllAddress[]>([]);
  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const [isPostalSuggestionVisible, setIsPostalSuggestionVisible] = useState(false);
  const [isPrefectureSuggestionVisible, setIsPrefectureSuggestionVisible] =
    useState(false);
  const [isCitySuggestionVisible, setIsCitySuggestionVisible] = useState(false);
  const [isTownSuggestionVisible, setIsTownSuggestionVisible] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<Record<
    SuggestionType,
    number
  >>(INITIAL_ACTIVE_SUGGESTION_INDEX);
  const [residentActiveSection, setResidentActiveSection] =
    useState<ResidentSection>("depart");
  const [isPrefectureComposing, setIsPrefectureComposing] = useState(false);
  const [isCityComposing, setIsCityComposing] = useState(false);
  const [isTownComposing, setIsTownComposing] = useState(false);
  const [residentComposing, setResidentComposing] = useState<
    Record<ResidentSection, Record<AddressSuggestionType, boolean>>
  >({
    depart: {
      prefecture: false,
      city: false,
      town: false,
    },
    registry: {
      prefecture: false,
      city: false,
      town: false,
    },
  });
  const basicFormRef = useRef<HTMLDivElement>(null);
  const residentFormRef = useRef<HTMLDivElement>(null);
  const pdfUploadInputRef = useRef<HTMLInputElement | null>(null);
  const basicFolderInputRef = useRef<HTMLInputElement>(null);
  const residentFolderInputRef = useRef<HTMLInputElement>(null);
  const addressWorkerRef = useRef<Worker | null>(null);
  const currentPdfObjectUrlRef = useRef<string | null>(null);
  const currentPdfBlobRef = useRef<Blob | null>(null);
  const hasReloadStateRestoredRef = useRef(false);
  const requestSerialRef = useRef(0);
  const latestRequestIdRef = useRef<Record<SuggestionType, number>>({
    postal: 0,
    prefecture: 0,
    city: 0,
    town: 0,
  });
  const deferredPostalCode = useDeferredValue(formData.postalCode);
  const activePrefectureInput =
    mode === "basic"
      ? formData.prefecture
      : residentFormData[
          getResidentAddressFieldName(residentActiveSection, "prefecture")
        ];
  const activeCityInput =
    mode === "basic"
      ? formData.city
      : residentFormData[getResidentAddressFieldName(residentActiveSection, "city")];
  const activeTownInput =
    mode === "basic"
      ? formData.town
      : residentFormData[getResidentAddressFieldName(residentActiveSection, "town")];
  const deferredPrefecture = useDeferredValue(activePrefectureInput);
  const deferredCity = useDeferredValue(activeCityInput);
  const deferredTown = useDeferredValue(activeTownInput);
  const isActivePrefectureComposing =
    mode === "basic"
      ? isPrefectureComposing
      : residentComposing[residentActiveSection].prefecture;
  const isActiveCityComposing =
    mode === "basic"
      ? isCityComposing
      : residentComposing[residentActiveSection].city;
  const isActiveTownComposing =
    mode === "basic"
      ? isTownComposing
      : residentComposing[residentActiveSection].town;

  useEffect(() => {
    const folderInputs = [basicFolderInputRef.current, residentFolderInputRef.current];
    folderInputs.forEach((input) => {
      if (!input) {
        return;
      }
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    });
  }, [mode]);

  useEffect(() => {
    return () => {
      if (currentPdfObjectUrlRef.current) {
        URL.revokeObjectURL(currentPdfObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;
    const worker = new Worker(
      new URL("../workers/addressSearchWorker.ts", import.meta.url),
      { type: "module" }
    );
    addressWorkerRef.current = worker;

    setIsKenAllLoading(true);
    setKenAllLoadError(null);
    setIsWorkerReady(false);

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (isDisposed) {
        return;
      }

      const message = event.data;
      if (message.type === "ready") {
        setIsKenAllLoading(false);
        setKenAllLoadError(null);
        setIsWorkerReady(true);
        return;
      }

      if (message.type === "error") {
        setIsKenAllLoading(false);
        setKenAllLoadError(message.message);
        setIsWorkerReady(false);
        return;
      }

      if (message.type === "postalResult") {
        if (latestRequestIdRef.current.postal !== message.id) {
          return;
        }
        setPostalCodeSuggestions(message.suggestions);
        return;
      }
      if (message.type === "prefectureResult") {
        if (latestRequestIdRef.current.prefecture !== message.id) {
          return;
        }
        setPrefectureSuggestions(message.suggestions);
        return;
      }
      if (message.type === "cityResult") {
        if (latestRequestIdRef.current.city !== message.id) {
          return;
        }
        setCitySuggestions(message.suggestions);
        return;
      }
      if (message.type === "townResult") {
        if (latestRequestIdRef.current.town !== message.id) {
          return;
        }
        setTownSuggestions(message.suggestions);
      }
    };

    worker.addEventListener("message", handleMessage);
    worker.postMessage({ type: "init" } as WorkerRequest);

    return () => {
      isDisposed = true;
      worker.removeEventListener("message", handleMessage);
      worker.terminate();
      addressWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
      if (!saved) {
        return;
      }
      const parsed = JSON.parse(saved) as Partial<AppSettings>;
      setSettings({
        isOperatorFixed: Boolean(parsed.isOperatorFixed),
        fixedOperatorName:
          typeof parsed.fixedOperatorName === "string"
            ? parsed.fixedOperatorName
            : "",
        isFilenameFixed: Boolean(parsed.isFilenameFixed),
        fixedFilename:
          typeof parsed.fixedFilename === "string" ? parsed.fixedFilename : "",
        writeFontSize: normalizeSheetWriteFontSize(parsed.writeFontSize),
        isAddressCheckEnabled:
          typeof parsed.isAddressCheckEnabled === "boolean"
            ? parsed.isAddressCheckEnabled
            : DEFAULT_APP_SETTINGS.isAddressCheckEnabled,
        isReloadStatePersistenceEnabled:
          typeof parsed.isReloadStatePersistenceEnabled === "boolean"
            ? parsed.isReloadStatePersistenceEnabled
            : DEFAULT_APP_SETTINGS.isReloadStatePersistenceEnabled,
        isResidentSelfNameFixed: Boolean(parsed.isResidentSelfNameFixed),
        fixedResidentSelfName:
          typeof parsed.fixedResidentSelfName === "string"
            ? parsed.fixedResidentSelfName
            : "",
        isBasicSecondarySheetEnabled:
          typeof parsed.isBasicSecondarySheetEnabled === "boolean"
            ? parsed.isBasicSecondarySheetEnabled
            : DEFAULT_APP_SETTINGS.isBasicSecondarySheetEnabled,
        isResidentSecondaryColumnBUppercase:
          typeof parsed.isResidentSecondaryColumnBUppercase === "boolean"
            ? parsed.isResidentSecondaryColumnBUppercase
            : DEFAULT_APP_SETTINGS.isResidentSecondaryColumnBUppercase,
        basicSheetWebhookUrl:
          typeof parsed.basicSheetWebhookUrl === "string"
            ? parsed.basicSheetWebhookUrl
            : DEFAULT_APP_SETTINGS.basicSheetWebhookUrl,
        residentSheetWebhookUrl:
          typeof parsed.residentSheetWebhookUrl === "string"
            ? parsed.residentSheetWebhookUrl
            : DEFAULT_APP_SETTINGS.residentSheetWebhookUrl,
        basicSheetUrl:
          typeof parsed.basicSheetUrl === "string"
            ? parsed.basicSheetUrl
            : DEFAULT_APP_SETTINGS.basicSheetUrl,
        basicSecondarySheetUrl:
          typeof parsed.basicSecondarySheetUrl === "string"
            ? parsed.basicSecondarySheetUrl
            : DEFAULT_APP_SETTINGS.basicSecondarySheetUrl,
        residentPrimarySheetUrl:
          typeof parsed.residentPrimarySheetUrl === "string"
            ? parsed.residentPrimarySheetUrl
            : DEFAULT_APP_SETTINGS.residentPrimarySheetUrl,
        residentSecondarySheetUrl:
          typeof parsed.residentSecondarySheetUrl === "string"
            ? parsed.residentSecondarySheetUrl
            : DEFAULT_APP_SETTINGS.residentSecondarySheetUrl,
        googleMapsEmbedApiKey:
          typeof parsed.googleMapsEmbedApiKey === "string"
            ? parsed.googleMapsEmbedApiKey
            : DEFAULT_APP_SETTINGS.googleMapsEmbedApiKey,
      });
    } catch {
      // 設定の復元に失敗した場合は既定値を使う
    }
    setIsSettingsHydrated(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!isSettingsHydrated || hasReloadStateRestoredRef.current) {
      return;
    }
    hasReloadStateRestoredRef.current = true;
    if (!settings.isReloadStatePersistenceEnabled) {
      setIsReloadStateReady(true);
      return;
    }

    try {
      const saved = window.localStorage.getItem(RELOAD_STATE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ReloadPersistedState>;
        setMode(parsed.mode === "resident" ? "resident" : "basic");
        setViewMode(
          parsed.viewMode === "sheet" || parsed.viewMode === "kanji"
            ? parsed.viewMode
            : "pdf"
        );
        setPhoneInputMode(parsed.phoneInputMode === "landline" ? "landline" : "mobile");
        const normalizedFormData = normalizeFormDataFromUnknown(parsed.formData);
        setFormData({
          ...normalizedFormData,
          operator: settings.isOperatorFixed
            ? settings.fixedOperatorName
            : normalizedFormData.operator,
          filename: settings.isFilenameFixed ? settings.fixedFilename : normalizedFormData.filename,
        });
        setBasicWriteSkipFields(
          normalizeBasicWriteSkipFieldsFromUnknown(parsed.basicWriteSkipFields)
        );
        const normalizedResidentFormData = normalizeResidentFormDataFromUnknown(
          parsed.residentFormData
        );
        setResidentFormData({
          ...normalizedResidentFormData,
          residentSelfName: settings.isResidentSelfNameFixed
            ? settings.fixedResidentSelfName
            : normalizedResidentFormData.residentSelfName,
        });
        setSavedEntries(normalizeSavedEntriesFromUnknown(parsed.savedEntries));
        setSavedResidentEntries(
          normalizeSavedResidentEntriesFromUnknown(parsed.savedResidentEntries)
        );
        setResidentSecondaryEntries(
          normalizeResidentSecondaryEntriesFromUnknown(parsed.residentSecondaryEntries)
        );
      }
    } catch {
      // 保存状態の復元に失敗した場合は既定値を使う
    }

    void (async () => {
      try {
        const blob = await loadReloadPdfBlob();
        if (!blob) {
          return;
        }
        const url = URL.createObjectURL(blob);
        if (currentPdfObjectUrlRef.current) {
          URL.revokeObjectURL(currentPdfObjectUrlRef.current);
        }
        currentPdfObjectUrlRef.current = url;
        currentPdfBlobRef.current = blob;
        setPdfFile(url);
      } catch {
        // PDFキャッシュ復元失敗は無視
      }
    })();
    setIsReloadStateReady(true);
  }, [isSettingsHydrated, settings.isReloadStatePersistenceEnabled]);

  useEffect(() => {
    if (
      !isSettingsHydrated ||
      !isReloadStateReady ||
      !settings.isReloadStatePersistenceEnabled
    ) {
      return;
    }

    const persistedState: ReloadPersistedState = {
      mode,
      viewMode,
      phoneInputMode,
      formData,
      basicWriteSkipFields,
      residentFormData,
      savedEntries,
      savedResidentEntries,
      residentSecondaryEntries,
    };

    try {
      window.localStorage.setItem(RELOAD_STATE_STORAGE_KEY, JSON.stringify(persistedState));
    } catch {
      // 保存失敗時はメモリ上の状態を継続
    }
  }, [
    isSettingsHydrated,
    isReloadStateReady,
    settings.isReloadStatePersistenceEnabled,
    mode,
    viewMode,
    phoneInputMode,
    formData,
    basicWriteSkipFields,
    residentFormData,
    savedEntries,
    savedResidentEntries,
    residentSecondaryEntries,
  ]);

  useEffect(() => {
    if (
      !isSettingsHydrated ||
      !settings.isReloadStatePersistenceEnabled ||
      !pdfFile ||
      !currentPdfBlobRef.current
    ) {
      return;
    }

    void saveReloadPdfBlob(currentPdfBlobRef.current).catch(() => undefined);
  }, [isSettingsHydrated, settings.isReloadStatePersistenceEnabled, pdfFile]);

  useEffect(() => {
    if (!isSettingsHydrated || settings.isReloadStatePersistenceEnabled) {
      return;
    }

    try {
      window.localStorage.removeItem(RELOAD_STATE_STORAGE_KEY);
    } catch {
      // 失敗時は無視
    }
    void clearReloadPdfBlob().catch(() => undefined);
  }, [isSettingsHydrated, settings.isReloadStatePersistenceEnabled]);

  const handleImportSettingsFromEnvFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";

    if (!selectedFile) {
      return;
    }

    try {
      const envContent = await selectedFile.text();
      const parsedSettings = parseDotEnvUrlSettings(envContent);
      const appliedKeys = Object.keys(parsedSettings);

      if (appliedKeys.length === 0) {
        setSettingsEnvImportMessage({
          type: "error",
          text: "対象キーが見つかりません。VITE_* の設定名を確認してください。",
        });
        return;
      }

      setSettings((prev) => ({
        ...prev,
        ...parsedSettings,
      }));
      setSettingsEnvImportMessage({
        type: "success",
        text: `.envファイルから ${appliedKeys.length} 件の設定を読み込みました。`,
      });
    } catch {
      setSettingsEnvImportMessage({
        type: "error",
        text: ".envファイルの読み込みに失敗しました。",
      });
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(BASIC_SHEET_SELECTION_STORAGE_KEY, basicSheetSelection);
    } catch {
      // 保存に失敗した場合はメモリ上の値を使う
    }
  }, [basicSheetSelection]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        RESIDENT_SHEET_SELECTION_STORAGE_KEY,
        residentSheetSelection
      );
    } catch {
      // 保存に失敗した場合はメモリ上の値を使う
    }
  }, [residentSheetSelection]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        SHEET_TAB_SELECTION_STORAGE_KEY,
        JSON.stringify(selectedSheetTabBySheetId)
      );
    } catch {
      // 保存に失敗した場合はメモリ上の値を使う
    }
  }, [selectedSheetTabBySheetId]);

  useEffect(() => {
    if (!activeSheetId || hasLoadedActiveSheetTabs) {
      return;
    }

    let canceled = false;
    setSheetTabLoadingBySheetId((prev) => ({
      ...prev,
      [activeSheetId]: true,
    }));
    setSheetTabErrorBySheetId((prev) => ({
      ...prev,
      [activeSheetId]: "",
    }));

    void (async () => {
      try {
        const sheetTabs = await fetchSpreadsheetSheetTabs(
          activeSheetId,
          activeSheetWebhookConfig
        );
        if (canceled) {
          return;
        }

        setSheetTabsBySheetId((prev) => ({
          ...prev,
          [activeSheetId]: sheetTabs,
        }));
        setSelectedSheetTabBySheetId((prev) => {
          const currentSelection = prev[activeSheetId] ?? "";
          const hasCurrentSelection = sheetTabs.some(
            (sheet) => sheet.name === currentSelection
          );
          if (hasCurrentSelection) {
            return prev;
          }
          const defaultSheetName = sheetTabs[0]?.name ?? "";
          if (!defaultSheetName) {
            return prev;
          }
          return {
            ...prev,
            [activeSheetId]: defaultSheetName,
          };
        });
      } catch (error) {
        if (canceled) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "シートタブ一覧の取得中に不明なエラーが発生しました。";
        setSheetTabErrorBySheetId((prev) => ({
          ...prev,
          [activeSheetId]: message,
        }));
      } finally {
        if (canceled) {
          return;
        }
        setSheetTabLoadingBySheetId((prev) => ({
          ...prev,
          [activeSheetId]: false,
        }));
      }
    })();

    return () => {
      canceled = true;
    };
  }, [
    activeSheetId,
    hasLoadedActiveSheetTabs,
    activeSheetWebhookConfig.envName,
    activeSheetWebhookConfig.url,
  ]);

  useEffect(() => {
    if (!settings.isOperatorFixed) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      operator: settings.fixedOperatorName,
    }));
  }, [settings.fixedOperatorName, settings.isOperatorFixed]);

  useEffect(() => {
    if (!settings.isFilenameFixed) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      filename: settings.fixedFilename,
    }));
  }, [settings.fixedFilename, settings.isFilenameFixed]);

  useEffect(() => {
    if (!settings.isResidentSelfNameFixed) {
      return;
    }

    setResidentFormData((prev) => ({
      ...prev,
      residentSelfName: settings.fixedResidentSelfName,
    }));
  }, [settings.fixedResidentSelfName, settings.isResidentSelfNameFixed]);

  useEffect(() => {
    if (settings.isAddressCheckEnabled) {
      return;
    }
    resetBasicAddressAiCheckState();
    resetResidentAddressCheckState();
  }, [settings.isAddressCheckEnabled]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      phone: formatPhoneNumber(prev.phone, phoneInputMode),
    }));
  }, [phoneInputMode]);

  const requestWorker = (type: SuggestionType, payload: WorkerQueryRequest) => {
    const worker = addressWorkerRef.current;
    if (!worker) {
      return;
    }
    const id = ++requestSerialRef.current;
    latestRequestIdRef.current[type] = id;
    worker.postMessage({
      ...payload,
      id,
    });
  };

  useEffect(() => {
    if (!isWorkerReady) {
      setPostalCodeSuggestions([]);
      return;
    }

    const normalizedPostalCode = deferredPostalCode.replace(/[^\d]/g, "");
    if (!normalizedPostalCode) {
      setPostalCodeSuggestions([]);
      return;
    }

    requestWorker("postal", {
      type: "queryPostal",
      postalCode: normalizedPostalCode,
    });
  }, [deferredPostalCode, isWorkerReady]);

  useEffect(() => {
    if (!isWorkerReady || isActivePrefectureComposing) {
      setPrefectureSuggestions([]);
      return;
    }

    const prefecture = deferredPrefecture.trim();
    if (!prefecture) {
      setPrefectureSuggestions([]);
      return;
    }

    requestWorker("prefecture", {
      type: "queryPrefecture",
      prefecture,
    });
  }, [deferredPrefecture, isActivePrefectureComposing, isWorkerReady]);

  useEffect(() => {
    if (!isWorkerReady || isActiveCityComposing) {
      setCitySuggestions([]);
      return;
    }

    const city = deferredCity.trim();
    if (!city) {
      setCitySuggestions([]);
      return;
    }

    requestWorker("city", {
      type: "queryCity",
      prefecture: deferredPrefecture,
      city: deferredCity,
      town: deferredTown,
    });
  }, [
    deferredPrefecture,
    deferredCity,
    deferredTown,
    isActiveCityComposing,
    isWorkerReady,
  ]);

  useEffect(() => {
    if (!isWorkerReady || isActiveTownComposing) {
      setTownSuggestions([]);
      return;
    }

    const town = deferredTown.trim();
    if (!town) {
      setTownSuggestions([]);
      return;
    }

    requestWorker("town", {
      type: "queryTown",
      prefecture: deferredPrefecture,
      city: deferredCity,
      town: deferredTown,
    });
  }, [
    deferredPrefecture,
    deferredCity,
    deferredTown,
    isActiveTownComposing,
    isWorkerReady,
  ]);

  const resetBasicAddressAiCheckState = () => {
    setBasicAddressAiError("");
    setBasicAddressAiResult(null);
  };
  const resetResidentAddressCheckState = (section?: ResidentSection) => {
    if (!section) {
      setResidentAddressCheckErrorBySection({
        depart: "",
        registry: "",
      });
      setResidentAddressCheckResultBySection({
        depart: null,
        registry: null,
      });
      setResidentAddressCheckingBySection({
        depart: false,
        registry: false,
      });
      return;
    }

    setResidentAddressCheckErrorBySection((prev) => ({
      ...prev,
      [section]: "",
    }));
    setResidentAddressCheckResultBySection((prev) => ({
      ...prev,
      [section]: null,
    }));
  };

  const handleBasicWriteSkipFieldToggle = (
    fieldName: BasicWriteSkipFieldName,
    checked: boolean
  ) => {
    setBasicWriteSkipFields((prev) => ({
      ...prev,
      [fieldName]: checked,
    }));
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    if (BASIC_ADDRESS_FIELDS_FOR_AI_CHECK.has(name)) {
      resetBasicAddressAiCheckState();
      setBasicMapSearchError("");
      setBasicMapEmbedUrl("");
      setBasicMapDisplayedAddress("");
      setIsBasicMapLoaded(false);
      setIsBasicMapResolving(false);
    }

    if (name === "postalCode") {
      setActiveSuggestionIndex((prev) => ({ ...prev, postal: -1 }));
      setIsPostalSuggestionVisible(value.trim().length > 0);
      setFormData((prev) => ({
        ...prev,
        postalCode: formatPostalCode(value),
      }));
      return;
    }

    if (name === "phone") {
      setFormData((prev) => ({
        ...prev,
        phone: formatPhoneNumber(value, phoneInputMode),
      }));
      return;
    }

    if (name === "town") {
      const sanitizedTown = sanitizeTownValue(value);
      setActiveSuggestionIndex((prev) => ({ ...prev, town: -1 }));
      setIsTownSuggestionVisible(sanitizedTown.trim().length > 0);
      setFormData((prev) => ({
        ...prev,
        town: sanitizedTown,
      }));
      return;
    }

    if (name === "company") {
      setFormData((prev) => ({
        ...prev,
        company: expandCompanyShortcut(value),
      }));
      return;
    }

    if (name === "position") {
      setFormData((prev) => ({
        ...prev,
        position: expandPositionShortcut(value),
      }));
      return;
    }

    if (name === "ooaza" || name === "aza" || name === "koaza") {
      setFormData((prev) => ({
        ...prev,
        [name]: formatAreaFieldValue(name, value),
      }));
      return;
    }

    if (name === "banchi") {
      setFormData((prev) => ({
        ...prev,
        banchi: formatBanchiValue(value, {
          halfWidthAlphaNumeric: true,
          halfWidthHyphen: true,
        }),
      }));
      return;
    }

    if (name === "building") {
      setFormData((prev) => ({
        ...prev,
        building: normalizeBuildingValue(value),
      }));
      return;
    }

    if (name === "prefecture") {
      setActiveSuggestionIndex((prev) => ({ ...prev, prefecture: -1 }));
      setIsPrefectureSuggestionVisible(value.trim().length > 0);
    }
    if (name === "city") {
      setActiveSuggestionIndex((prev) => ({ ...prev, city: -1 }));
      setIsCitySuggestionVisible(value.trim().length > 0);
    }
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const findNextFieldNameFromOrder = (
    currentName: string,
    direction: 1 | -1,
    includeDetailFields: boolean,
    fieldOrder: readonly string[],
    detailFields: Set<string>
  ): string | null => {
    const currentIndex = fieldOrder.indexOf(currentName);

    if (currentIndex < 0) {
      return null;
    }

    let cursor = currentIndex;
    while (true) {
      cursor += direction;
      if (cursor < 0 || cursor >= fieldOrder.length) {
        return null;
      }

      const nextName = fieldOrder[cursor];
      if (!includeDetailFields && detailFields.has(nextName)) {
        continue;
      }

      return nextName;
    }
  };

  const focusByFieldName = (
    containerRef: React.RefObject<HTMLDivElement>,
    fieldName: string
  ) => {
    const target = containerRef.current?.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(`[name="${fieldName}"]`);
    if (!target || target.disabled) {
      return false;
    }

    target.focus();
    if (target instanceof HTMLInputElement) {
      target.select();
    }
    return true;
  };

  const focusNextField = (
    currentName: string,
    direction: 1 | -1,
    includeDetailFields: boolean
  ) => {
    if (isResidentFieldName(currentName)) {
      const nextResidentField = findNextFieldNameFromOrder(
        currentName,
        direction,
        includeDetailFields,
        RESIDENT_FIELD_ORDER,
        RESIDENT_DETAIL_ADDRESS_FIELDS
      );
      if (!nextResidentField) {
        return false;
      }
      return focusByFieldName(residentFormRef, nextResidentField);
    }

    const nextBasicField = findNextFieldNameFromOrder(
      currentName,
      direction,
      includeDetailFields,
      BASIC_FIELD_ORDER,
      DETAIL_ADDRESS_FIELDS
    );
    if (!nextBasicField) {
      return false;
    }

    return focusByFieldName(basicFormRef, nextBasicField);
  };

  const handleBasicFormNavigation = (
    e: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (e.defaultPrevented) {
      return;
    }

    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    const fieldName = target?.name;

    if (!fieldName) {
      return;
    }

    const isNavigationKey =
      e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp";
    if (!isNavigationKey) {
      return;
    }

    const direction: 1 | -1 = e.key === "ArrowUp" ? -1 : 1;
    if (focusNextField(fieldName, direction, e.shiftKey)) {
      e.preventDefault();
    }
  };

  const handleResidentFormNavigation = (
    e: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (e.defaultPrevented) {
      return;
    }

    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    const fieldName = target?.name;
    if (!fieldName || !isResidentFieldName(fieldName)) {
      return;
    }

    const isNavigationKey =
      e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp";
    if (!isNavigationKey) {
      return;
    }

    const direction: 1 | -1 = e.key === "ArrowUp" ? -1 : 1;
    if (focusNextField(fieldName, direction, e.shiftKey)) {
      e.preventDefault();
    }
  };

  const moveSuggestionFocus = (
    type: SuggestionType,
    count: number,
    direction: 1 | -1
  ) => {
    if (count <= 0) {
      return;
    }

    setActiveSuggestionIndex((prev) => {
      const current = prev[type];
      const next =
        current < 0
          ? direction === 1
            ? 0
            : count - 1
          : (current + direction + count) % count;

      return {
        ...prev,
        [type]: next,
      };
    });
  };

  const resetSuggestionFocus = (type: SuggestionType) => {
    setActiveSuggestionIndex((prev) => ({
      ...prev,
      [type]: -1,
    }));
  };

  const applyAddressSuggestion = (
    address: KenAllAddress,
    target: AddressSuggestionTarget = "basic"
  ) => {
    if (target === "basic") {
      resetBasicAddressAiCheckState();
      setFormData((prev) => ({
        ...prev,
        postalCode: formatPostalCode(address.postalCode),
        prefecture: address.prefecture,
        city: address.city,
        town: sanitizeTownValue(address.town),
      }));
    } else {
      resetResidentAddressCheckState(target);
      const prefectureField = getResidentAddressFieldName(target, "prefecture");
      const cityField = getResidentAddressFieldName(target, "city");
      const townField = getResidentAddressFieldName(target, "town");
      setResidentFormData((prev) => ({
        ...prev,
        [prefectureField]: address.prefecture,
        [cityField]: address.city,
        [townField]: sanitizeTownValue(address.town),
      }));
      setResidentActiveSection(target);
    }

    setIsPostalSuggestionVisible(false);
    setIsPrefectureSuggestionVisible(false);
    setIsCitySuggestionVisible(false);
    setIsTownSuggestionVisible(false);
    setActiveSuggestionIndex(INITIAL_ACTIVE_SUGGESTION_INDEX);
  };

  const applyPrefectureSuggestion = (
    prefecture: string,
    target: AddressSuggestionTarget = "basic"
  ) => {
    if (target === "basic") {
      resetBasicAddressAiCheckState();
      setFormData((prev) => ({
        ...prev,
        prefecture,
      }));
    } else {
      resetResidentAddressCheckState(target);
      const prefectureField = getResidentAddressFieldName(target, "prefecture");
      setResidentFormData((prev) => ({
        ...prev,
        [prefectureField]: prefecture,
      }));
      setResidentActiveSection(target);
    }
    setIsPrefectureSuggestionVisible(false);
    resetSuggestionFocus("prefecture");
  };

  const applyCitySuggestion = (
    address: KenAllAddress,
    target: AddressSuggestionTarget = "basic"
  ) => {
    if (target === "basic") {
      resetBasicAddressAiCheckState();
      setFormData((prev) => ({
        ...prev,
        prefecture: address.prefecture,
        city: address.city,
      }));
    } else {
      resetResidentAddressCheckState(target);
      const prefectureField = getResidentAddressFieldName(target, "prefecture");
      const cityField = getResidentAddressFieldName(target, "city");
      setResidentFormData((prev) => ({
        ...prev,
        [prefectureField]: address.prefecture,
        [cityField]: address.city,
      }));
      setResidentActiveSection(target);
    }
    setIsCitySuggestionVisible(false);
    resetSuggestionFocus("city");
  };

  const handleSuggestionAreaBlur = (
    e: React.FocusEvent<HTMLDivElement>,
    close: React.Dispatch<React.SetStateAction<boolean>>,
    type: SuggestionType
  ) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (nextTarget && e.currentTarget.contains(nextTarget)) {
      return;
    }
    close(false);
    resetSuggestionFocus(type);
  };

  const handleSuggestionKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    type: SuggestionType,
    isVisible: boolean,
    count: number,
    show: React.Dispatch<React.SetStateAction<boolean>>,
    selectByIndex: (index: number) => void,
    hide: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!isVisible || count === 0) {
        return;
      }
      show(true);
      e.preventDefault();
      e.stopPropagation();
      if (!isVisible || activeSuggestionIndex[type] < 0) {
        setActiveSuggestionIndex((prev) => ({
          ...prev,
          [type]: e.key === "ArrowDown" ? 0 : count - 1,
        }));
        return;
      }
      moveSuggestionFocus(type, count, e.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (e.key === "Enter") {
      if (!isVisible || count === 0) {
        return;
      }
      const index = activeSuggestionIndex[type] < 0 ? 0 : activeSuggestionIndex[type];
      if (index >= count) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      selectByIndex(index);
      hide(false);
      resetSuggestionFocus(type);
      focusNextField(e.currentTarget.name, 1, e.shiftKey);
      return;
    }

    if (e.key === "Escape") {
      hide(false);
      resetSuggestionFocus(type);
    }
  };

  const handleResidentChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    const residentSection = getResidentSectionFromFieldName(name);
    if (residentSection) {
      setResidentActiveSection(residentSection);
      if (RESIDENT_ADDRESS_FIELDS_FOR_ADDRESS_CHECK.has(name)) {
        resetResidentAddressCheckState(residentSection);
        setResidentMapSearchErrorBySection((prev) => ({
          ...prev,
          [residentSection]: "",
        }));
        setResidentMapEmbedUrlBySection((prev) => ({
          ...prev,
          [residentSection]: "",
        }));
        setResidentMapDisplayedAddressBySection((prev) => ({
          ...prev,
          [residentSection]: "",
        }));
        setResidentMapLoadedBySection((prev) => ({
          ...prev,
          [residentSection]: false,
        }));
        setResidentMapResolvingBySection((prev) => ({
          ...prev,
          [residentSection]: false,
        }));
      }
    }

    if (name === "departTown" || name === "registryTown") {
      const sanitizedTown = sanitizeTownValue(value);
      setActiveSuggestionIndex((prev) => ({ ...prev, town: -1 }));
      setIsTownSuggestionVisible(sanitizedTown.trim().length > 0);
      setResidentFormData((prev) => ({
        ...prev,
        [name]: sanitizedTown,
      }));
      return;
    }

    if (name === "departPrefecture" || name === "registryPrefecture") {
      setActiveSuggestionIndex((prev) => ({ ...prev, prefecture: -1 }));
      setIsPrefectureSuggestionVisible(value.trim().length > 0);
    }

    if (name === "departCity" || name === "registryCity") {
      setActiveSuggestionIndex((prev) => ({ ...prev, city: -1 }));
      setIsCitySuggestionVisible(value.trim().length > 0);
    }

    if (name === "departBanchi" || name === "registryBanchi") {
      setResidentFormData((prev) => ({
        ...prev,
        [name]: formatBanchiValue(value),
      }));
      return;
    }

    if (name === "departBuilding" || name === "registryBuilding") {
      setResidentFormData((prev) => ({
        ...prev,
        [name]: normalizeBuildingValue(value),
      }));
      return;
    }

    if (
      name === "departOoaza" ||
      name === "departAza" ||
      name === "departKoaza" ||
      name === "registryOoaza" ||
      name === "registryAza" ||
      name === "registryKoaza"
    ) {
      setResidentFormData((prev) => ({
        ...prev,
        [name]: formatAreaFieldValue(name, value),
      }));
      return;
    }

    setResidentFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleActiveSheetTabSelectionChange = (sheetName: string) => {
    if (!activeSheetId) {
      return;
    }

    setSelectedSheetTabBySheetId((prev) => ({
      ...prev,
      [activeSheetId]: sheetName,
    }));
  };

  const handleResidentSecondaryNameChange = (id: number, name: string) => {
    setResidentSecondaryEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, name } : entry))
    );
  };

  const handleOpenPdfPicker = () => {
    const input = pdfUploadInputRef.current;
    if (!input) {
      return;
    }
    input.value = "";
    input.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !isPdfFile(file)) {
      return;
    }

    const url = URL.createObjectURL(file);
    if (currentPdfObjectUrlRef.current) {
      URL.revokeObjectURL(currentPdfObjectUrlRef.current);
    }
    currentPdfObjectUrlRef.current = url;
    currentPdfBlobRef.current = file;
    setPdfFile(url);
  };

  const createBasicEntryFromForm = () => {
    return {
      ...formData,
      operator: settings.isOperatorFixed
        ? settings.fixedOperatorName
        : formData.operator,
      filename: settings.isFilenameFixed ? settings.fixedFilename : formData.filename,
    };
  };

  const collectBasicAddressAiReferenceCandidates = async (): Promise<
    LocalAddressCandidate[]
  > => {
    const addresses = await loadKenAllData();
    const prefecture = formData.prefecture.trim();
    const city = formData.city.trim();
    const town = formData.town.trim();
    const postalCodeDigits = formData.postalCode.replace(/[^\d]/g, "").slice(0, 7);
    const detailTown = joinBasicAddressForSheet([
      formData.town,
      formData.ooaza,
      formData.aza,
      formData.koaza,
    ]).trim();
    const hasAddressInput = Boolean(
      prefecture || city || town || detailTown || postalCodeDigits.length === 7
    );
    if (!hasAddressInput) {
      return [];
    }

    const merged: LocalAddressCandidate[] = [];
    const seen = new Set<string>();
    const pushAddressCandidate = (candidate: LocalAddressCandidate) => {
      const key = `${candidate.postalCode}|${candidate.prefecture}|${candidate.city}|${candidate.town}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(candidate);
    };

    if (postalCodeDigits.length === 7) {
      const byPostal = addresses.filter((address) => address.postalCode === postalCodeDigits);
      for (const address of byPostal) {
        pushAddressCandidate({
          postalCode: formatPostalCode(address.postalCode),
          prefecture: address.prefecture,
          city: address.city,
          town: address.town,
        });
        if (merged.length >= 8) {
          return merged;
        }
      }
    }

    const townSuggestions = findTownSuggestions(
      addresses,
      {
        prefecture,
        city,
        town: detailTown || town,
      },
      8
    );
    for (const address of townSuggestions) {
      pushAddressCandidate({
        postalCode: formatPostalCode(address.postalCode),
        prefecture: address.prefecture,
        city: address.city,
        town: address.town,
      });
      if (merged.length >= 8) {
        return merged;
      }
    }

    const citySuggestions = findCitySuggestions(
      addresses,
      {
        prefecture,
        city,
        town: "",
      },
      8
    );
    for (const address of citySuggestions) {
      pushAddressCandidate({
        postalCode: formatPostalCode(address.postalCode),
        prefecture: address.prefecture,
        city: address.city,
        town: address.town || "",
      });
      if (merged.length >= 8) {
        return merged;
      }
    }

    const queries = [
      { prefecture, city, town: detailTown },
      { prefecture, city, town },
      { prefecture, city, town: "" },
    ];
    for (const query of queries) {
      const found = searchKenAllAddresses(addresses, query, 8);
      for (const address of found) {
        pushAddressCandidate({
          postalCode: formatPostalCode(address.postalCode),
          prefecture: address.prefecture,
          city: address.city,
          town: address.town,
        });
        if (merged.length >= 8) {
          return merged;
        }
      }
    }

    return merged;
  };

  const collectResidentAddressReferenceCandidates = async (
    section: ResidentSection
  ): Promise<LocalAddressCandidate[]> => {
    const addresses = await loadKenAllData();
    const prefecture =
      section === "depart"
        ? residentFormData.departPrefecture.trim()
        : residentFormData.registryPrefecture.trim();
    const city =
      section === "depart"
        ? residentFormData.departCity.trim()
        : residentFormData.registryCity.trim();
    const town =
      section === "depart"
        ? residentFormData.departTown.trim()
        : residentFormData.registryTown.trim();
    const detailTown =
      section === "depart"
        ? joinResidentAddressForSheet([
            residentFormData.departTown,
            residentFormData.departOoaza,
            residentFormData.departAza,
            residentFormData.departKoaza,
          ]).trim()
        : joinResidentAddressForSheet([
            residentFormData.registryTown,
            residentFormData.registryOoaza,
            residentFormData.registryAza,
            residentFormData.registryKoaza,
          ]).trim();
    const hasAddressInput = Boolean(prefecture || city || town || detailTown);
    if (!hasAddressInput) {
      return [];
    }

    const merged: LocalAddressCandidate[] = [];
    const seen = new Set<string>();
    const pushAddressCandidate = (candidate: LocalAddressCandidate) => {
      const key = `${candidate.postalCode}|${candidate.prefecture}|${candidate.city}|${candidate.town}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(candidate);
    };

    const townSuggestions = findTownSuggestions(
      addresses,
      {
        prefecture,
        city,
        town: detailTown || town,
      },
      8
    );
    for (const address of townSuggestions) {
      pushAddressCandidate({
        postalCode: formatPostalCode(address.postalCode),
        prefecture: address.prefecture,
        city: address.city,
        town: address.town,
      });
      if (merged.length >= 8) {
        return merged;
      }
    }

    const citySuggestions = findCitySuggestions(
      addresses,
      {
        prefecture,
        city,
        town: "",
      },
      8
    );
    for (const address of citySuggestions) {
      pushAddressCandidate({
        postalCode: formatPostalCode(address.postalCode),
        prefecture: address.prefecture,
        city: address.city,
        town: address.town || "",
      });
      if (merged.length >= 8) {
        return merged;
      }
    }

    const queries = [
      { prefecture, city, town: detailTown },
      { prefecture, city, town },
      { prefecture, city, town: "" },
    ];
    for (const query of queries) {
      const found = searchKenAllAddresses(addresses, query, 8);
      for (const address of found) {
        pushAddressCandidate({
          postalCode: formatPostalCode(address.postalCode),
          prefecture: address.prefecture,
          city: address.city,
          town: address.town,
        });
        if (merged.length >= 8) {
          return merged;
        }
      }
    }

    return merged;
  };

  const handleBasicAddressAiCheck = async () => {
    setBasicAddressAiError("");
    setBasicAddressAiResult(null);

    const manualAddress = buildManualBasicAddressText(formData);
    const postalCode = formData.postalCode.trim();
    if (!manualAddress && !postalCode) {
      setBasicAddressAiError(
        "手入力した住所または郵便番号を入力してから住所チェックしてください。"
      );
      return;
    }

    setIsBasicAddressAiChecking(true);
    try {
      const candidates = await collectBasicAddressAiReferenceCandidates();
      const result = await checkAddressWithLocalInference({
        input: {
          postalCode: formData.postalCode.trim(),
          prefecture: formData.prefecture.trim(),
          city: formData.city.trim(),
          town: formData.town.trim(),
          ooaza: formData.ooaza.trim(),
          aza: formData.aza.trim(),
          koaza: formData.koaza.trim(),
          banchi: formData.banchi.trim(),
          building: formData.building.trim(),
        },
        candidates,
      });

      setBasicAddressAiResult({
        ...result,
        checkedAddress: manualAddress || postalCode,
        referenceCandidateCount: candidates.length,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "住所チェック中に不明なエラーが発生しました。";
      setBasicAddressAiError(message);
    } finally {
      setIsBasicAddressAiChecking(false);
    }
  };

  const handleOpenBasicAddressInGoogleMaps = async () => {
    setBasicMapSearchError("");
    setBasicMapEmbedUrl("");
    setBasicMapDisplayedAddress("");
    setIsBasicMapLoaded(false);
    setIsBasicMapResolving(false);
    const manualAddress = buildManualBasicAddressText(formData);
    if (!manualAddress) {
      setBasicMapSearchError("住所を入力してから地図表示してください。");
      return;
    }

    const apiKey = settings.googleMapsEmbedApiKey.trim();
    if (!apiKey) {
      setBasicMapSearchError(
        "Google Maps Embed APIキーが未設定です。設定の「シート/Webhook設定（詳細）」で入力してください。"
      );
      return;
    }

    setIsBasicMapResolving(true);
    try {
      const resolvedAddress = await fetchGoogleFormattedAddress(manualAddress, apiKey);
      setBasicMapDisplayedAddress(resolvedAddress);
      setBasicMapEmbedUrl(buildGoogleMapsEmbedSearchUrl(resolvedAddress, apiKey));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google住所検索中に不明なエラーが発生しました。";
      setBasicMapSearchError(message);
    } finally {
      setIsBasicMapResolving(false);
    }
  };

  const handleResidentAddressCheck = async (section: ResidentSection) => {
    setResidentAddressCheckErrorBySection((prev) => ({
      ...prev,
      [section]: "",
    }));
    setResidentAddressCheckResultBySection((prev) => ({
      ...prev,
      [section]: null,
    }));

    const manualAddress = buildManualResidentAddressText(residentFormData, section);
    if (!manualAddress) {
      setResidentAddressCheckErrorBySection((prev) => ({
        ...prev,
        [section]: "手入力した住所を入力してから住所チェックしてください。",
      }));
      return;
    }

    setResidentAddressCheckingBySection((prev) => ({
      ...prev,
      [section]: true,
    }));
    try {
      const candidates = await collectResidentAddressReferenceCandidates(section);
      const result = await checkAddressWithLocalInference({
        input:
          section === "depart"
            ? {
                postalCode: "",
                prefecture: residentFormData.departPrefecture.trim(),
                city: residentFormData.departCity.trim(),
                town: residentFormData.departTown.trim(),
                ooaza: residentFormData.departOoaza.trim(),
                aza: residentFormData.departAza.trim(),
                koaza: residentFormData.departKoaza.trim(),
                banchi: residentFormData.departBanchi.trim(),
                building: residentFormData.departBuilding.trim(),
              }
            : {
                postalCode: "",
                prefecture: residentFormData.registryPrefecture.trim(),
                city: residentFormData.registryCity.trim(),
                town: residentFormData.registryTown.trim(),
                ooaza: residentFormData.registryOoaza.trim(),
                aza: residentFormData.registryAza.trim(),
                koaza: residentFormData.registryKoaza.trim(),
                banchi: residentFormData.registryBanchi.trim(),
                building: residentFormData.registryBuilding.trim(),
              },
        candidates,
      });

      setResidentAddressCheckResultBySection((prev) => ({
        ...prev,
        [section]: {
          ...result,
          checkedAddress: manualAddress,
          referenceCandidateCount: candidates.length,
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "住所チェック中に不明なエラーが発生しました。";
      setResidentAddressCheckErrorBySection((prev) => ({
        ...prev,
        [section]: message,
      }));
    } finally {
      setResidentAddressCheckingBySection((prev) => ({
        ...prev,
        [section]: false,
      }));
    }
  };

  const handleOpenResidentAddressInGoogleMaps = async (section: ResidentSection) => {
    setResidentMapSearchErrorBySection((prev) => ({
      ...prev,
      [section]: "",
    }));
    setResidentMapEmbedUrlBySection((prev) => ({
      ...prev,
      [section]: "",
    }));
    setResidentMapDisplayedAddressBySection((prev) => ({
      ...prev,
      [section]: "",
    }));
    setResidentMapLoadedBySection((prev) => ({
      ...prev,
      [section]: false,
    }));
    setResidentMapResolvingBySection((prev) => ({
      ...prev,
      [section]: false,
    }));

    const manualAddress = buildManualResidentAddressText(residentFormData, section);
    if (!manualAddress) {
      setResidentMapSearchErrorBySection((prev) => ({
        ...prev,
        [section]: "住所を入力してから地図表示してください。",
      }));
      return;
    }

    const apiKey = settings.googleMapsEmbedApiKey.trim();
    if (!apiKey) {
      setResidentMapSearchErrorBySection((prev) => ({
        ...prev,
        [section]:
          "Google Maps Embed APIキーが未設定です。設定の「シート/Webhook設定（詳細）」で入力してください。",
      }));
      return;
    }

    setResidentMapResolvingBySection((prev) => ({
      ...prev,
      [section]: true,
    }));
    try {
      const resolvedAddress = await fetchGoogleFormattedAddress(manualAddress, apiKey);
      setResidentMapDisplayedAddressBySection((prev) => ({
        ...prev,
        [section]: resolvedAddress,
      }));
      setResidentMapEmbedUrlBySection((prev) => ({
        ...prev,
        [section]: buildGoogleMapsEmbedSearchUrl(resolvedAddress, apiKey),
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google住所検索中に不明なエラーが発生しました。";
      setResidentMapSearchErrorBySection((prev) => ({
        ...prev,
        [section]: message,
      }));
    } finally {
      setResidentMapResolvingBySection((prev) => ({
        ...prev,
        [section]: false,
      }));
    }
  };

  const handleApplyBasicAddressAiCorrection = () => {
    const correction = basicAddressAiResult?.corrected;
    if (!correction) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      postalCode: correction.postalCode
        ? formatPostalCode(correction.postalCode)
        : prev.postalCode,
      prefecture: correction.prefecture || prev.prefecture,
      city: correction.city || prev.city,
      town: correction.town || prev.town,
    }));
    setBasicAddressAiError("");
  };

  const handleApplyResidentAddressCorrection = (section: ResidentSection) => {
    const correction = residentAddressCheckResultBySection[section]?.corrected;
    if (!correction) {
      return;
    }

    if (section === "depart") {
      setResidentFormData((prev) => ({
        ...prev,
        departPrefecture: correction.prefecture || prev.departPrefecture,
        departCity: correction.city || prev.departCity,
        departTown: correction.town || prev.departTown,
      }));
    } else {
      setResidentFormData((prev) => ({
        ...prev,
        registryPrefecture: correction.prefecture || prev.registryPrefecture,
        registryCity: correction.city || prev.registryCity,
        registryTown: correction.town || prev.registryTown,
      }));
    }

    setResidentAddressCheckErrorBySection((prev) => ({
      ...prev,
      [section]: "",
    }));
  };

  const upsertBasicEntryToList = (
    basicEntry: ReturnType<typeof createBasicEntryFromForm>,
    options?: {
      clearAfterSave?: boolean;
      skipDuplicateOnInsert?: boolean;
      writtenPosition?: SheetWritePosition;
    }
  ) => {
    const savedAt = new Date().toISOString();
    const editingId = editingBasicEntryId;
    setSavedEntries((prev) => {
      if (editingId !== null) {
        let updated = false;
        const next = prev.map((entry) => {
          if (entry.id !== editingId) {
            return entry;
          }
          updated = true;
          return {
            ...basicEntry,
            id: entry.id,
            savedAt,
            sheetRowsByTarget: mergeSheetRowMap(
              entry.sheetRowsByTarget,
              options?.writtenPosition
            ),
          };
        });
        if (updated) {
          return next;
        }
      }

      if (options?.skipDuplicateOnInsert) {
        const duplicateIndex = prev.findIndex((entry) => {
          return BASIC_FIELD_ORDER.every((fieldName) => {
            return entry[fieldName].trim() === basicEntry[fieldName].trim();
          });
        });
        if (duplicateIndex >= 0) {
          if (!options?.writtenPosition) {
            return prev;
          }
          const duplicateEntry = prev[duplicateIndex];
          const mergedSheetRows = mergeSheetRowMap(
            duplicateEntry.sheetRowsByTarget,
            options.writtenPosition
          );
          if (mergedSheetRows === duplicateEntry.sheetRowsByTarget) {
            return prev;
          }
          const next = [...prev];
          next[duplicateIndex] = {
            ...duplicateEntry,
            sheetRowsByTarget: mergedSheetRows,
          };
          return next;
        }
      }

      const nextId =
        prev.length === 0
          ? 1
          : Math.max(...prev.map((entry) => entry.id)) + 1;
      const newEntry: SavedEntry = {
        ...basicEntry,
        id: nextId,
        savedAt,
        sheetRowsByTarget: mergeSheetRowMap(undefined, options?.writtenPosition),
      };
      return [...prev, newEntry];
    });
    setEditingBasicEntryId(null);

    if (options?.clearAfterSave ?? true) {
      handleClear();
    }
  };

  const handleBasicSaveToList = (options?: {
    clearAfterSave?: boolean;
    preserveSheetMessages?: boolean;
  }) => {
    const basicEntry = createBasicEntryFromForm();
    upsertBasicEntryToList(basicEntry, {
      clearAfterSave: options?.clearAfterSave,
    });

    if (!options?.preserveSheetMessages) {
      setBasicSheetSyncError("");
      setBasicSheetSyncSuccess("");
    }
  };

  const resolveBasicSheetTargetForWrite = () => {
    const targetSheetId = extractGoogleSheetId(
      configuredSheetUrls[effectiveBasicSheetSelection]
    );
    if (!targetSheetId) {
      setBasicSheetSyncError(
        "シートIDを取得できないため、シート反映をスキップしました。"
      );
      return null;
    }

    if (sheetTabLoadingBySheetId[targetSheetId]) {
      setBasicSheetSyncError(
        "シートタブ一覧を取得中です。少し待ってから書き込みしてください。"
      );
      return null;
    }

    const tabLoadError = sheetTabErrorBySheetId[targetSheetId];
    if (tabLoadError) {
      setBasicSheetSyncError(
        `シートタブ一覧を取得できないため書き込みできません。${tabLoadError}`
      );
      return null;
    }

    const normalizedTargetSheetName = (
      selectedSheetTabBySheetId[targetSheetId] ?? ""
    ).trim();
    if (!normalizedTargetSheetName) {
      setBasicSheetSyncError("書き込み先シートを選択してください。");
      return null;
    }

    return {
      targetSheetId,
      normalizedTargetSheetName,
    };
  };

  const buildBasicSheetWritePayload = (
    basicEntry: ReturnType<typeof createBasicEntryFromForm>,
    targetSheetId: string,
    normalizedTargetSheetName: string,
    options?: {
      targetRow?: number;
      preferExistingRow?: boolean;
    }
  ): BasicSheetWritePayload => {
    const postalCodeForWrite = basicWriteSkipFields.postalCode ? "" : basicEntry.postalCode;
    const integratedAddress = joinBasicAddressForSheet([
      basicWriteSkipFields.prefecture ? "" : basicEntry.prefecture,
      basicWriteSkipFields.city ? "" : basicEntry.city,
      basicWriteSkipFields.town ? "" : basicEntry.town,
      basicEntry.ooaza,
      basicEntry.aza,
      basicEntry.koaza,
      basicEntry.banchi,
    ]);
    const isSecondaryMapping = effectiveBasicSheetSelection === "basicSecondary";

    const payload: BasicSheetWritePayload = {
      action: "appendBasicRow",
      sheetId: targetSheetId,
      sheetName: normalizedTargetSheetName,
      startRow: BASIC_SHEET_START_ROW,
      fontSize: settings.writeFontSize,
      values: {
        A: basicEntry.operator,
        B: basicEntry.filename,
        C: isSecondaryMapping ? basicEntry.position : postalCodeForWrite,
        D: isSecondaryMapping ? basicEntry.name : integratedAddress,
        E: isSecondaryMapping ? basicEntry.company : basicEntry.building,
        F: isSecondaryMapping ? postalCodeForWrite : basicEntry.company,
        G: isSecondaryMapping ? integratedAddress : basicEntry.position,
        H: isSecondaryMapping ? basicEntry.building : basicEntry.name,
        I: basicEntry.phone,
        J: basicEntry.notes,
      },
    };

    const normalizedTargetRow = normalizeSheetRow(options?.targetRow);
    if (normalizedTargetRow !== null) {
      payload.targetRow = normalizedTargetRow;
    }
    if (options?.preferExistingRow) {
      payload.preferExistingRow = true;
    }

    return payload;
  };

  const writeBasicEntryToSheet = async (
    basicEntry: ReturnType<typeof createBasicEntryFromForm>,
    targetSheetId: string,
    normalizedTargetSheetName: string,
    options?: {
      singleEntryId?: number;
      autoSaveToList?: boolean;
      targetRow?: number;
      preferExistingRow?: boolean;
    }
  ) => {
    const payload = buildBasicSheetWritePayload(
      basicEntry,
      targetSheetId,
      normalizedTargetSheetName,
      {
        targetRow: options?.targetRow,
        preferExistingRow: options?.preferExistingRow,
      }
    );

    if (typeof options?.singleEntryId === "number") {
      setBasicListWritingEntryId(options.singleEntryId);
    } else {
      setIsBasicSheetSaving(true);
    }

    try {
      const result = await postBasicSheetPayload(payload, basicSheetWebhookConfig);
      const normalizedWrittenRow = normalizeSheetRow(result.row);
      const successMessage =
        normalizedWrittenRow !== null
          ? `シート「${normalizedTargetSheetName}」の${normalizedWrittenRow}行目へ反映しました。`
          : `シート「${normalizedTargetSheetName}」へ反映しました。`;
      const withItemMessage =
        typeof options?.singleEntryId === "number"
          ? `${successMessage}（保存済みリストの1件）`
          : successMessage;
      setBasicSheetSyncSuccess(withItemMessage);

      const writtenPosition =
        normalizedWrittenRow !== null
          ? {
              sheetId: targetSheetId,
              sheetName: normalizedTargetSheetName,
              row: normalizedWrittenRow,
            }
          : undefined;

      if (
        typeof options?.singleEntryId === "number" &&
        writtenPosition
      ) {
        setSavedEntries((prev) =>
          prev.map((savedEntry) =>
            savedEntry.id === options.singleEntryId
              ? {
                  ...savedEntry,
                  sheetRowsByTarget: mergeSheetRowMap(
                    savedEntry.sheetRowsByTarget,
                    writtenPosition
                  ),
                }
              : savedEntry
          )
        );
      }

      if (options?.autoSaveToList ?? true) {
        upsertBasicEntryToList(basicEntry, {
          clearAfterSave: typeof options?.singleEntryId !== "number",
          skipDuplicateOnInsert: true,
          writtenPosition,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "シート反映中に不明なエラーが発生しました。";
      setBasicSheetSyncError(message);
    } finally {
      if (typeof options?.singleEntryId === "number") {
        setBasicListWritingEntryId(null);
      } else {
        setIsBasicSheetSaving(false);
      }
    }
  };

  const handleBasicListOverwriteWrite = async (entry: SavedEntry) => {
    setBasicSheetSyncError("");
    setBasicSheetSyncSuccess("");

    const resolvedTarget = resolveBasicSheetTargetForWrite();
    if (!resolvedTarget) {
      return;
    }

    const targetRow = resolveSheetRowFromMap(
      entry.sheetRowsByTarget,
      resolvedTarget.targetSheetId,
      resolvedTarget.normalizedTargetSheetName
    );

    await writeBasicEntryToSheet(
      entry,
      resolvedTarget.targetSheetId,
      resolvedTarget.normalizedTargetSheetName,
      {
        singleEntryId: entry.id,
        autoSaveToList: false,
        targetRow,
        preferExistingRow: true,
      }
    );
  };

  const handleBasicWriteToSheet = async () => {
    const basicEntry = createBasicEntryFromForm();
    setBasicSheetSyncError("");
    setBasicSheetSyncSuccess("");

    const resolvedTarget = resolveBasicSheetTargetForWrite();
    if (!resolvedTarget) {
      return;
    }

    await writeBasicEntryToSheet(
      basicEntry,
      resolvedTarget.targetSheetId,
      resolvedTarget.normalizedTargetSheetName,
      {
        autoSaveToList: true,
      }
    );
  };

  const handleBasicFolderImportClick = () => {
    setBasicSheetSyncError("");
    setBasicSheetSyncSuccess("");

    const input = basicFolderInputRef.current;
    if (!input) {
      setBasicSheetSyncError(
        "フォルダ選択入力の初期化に失敗しました。画面を再読み込みしてください。"
      );
      return;
    }

    input.value = "";
    input.click();
  };

  const handleBasicFolderImportChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    setBasicSheetSyncError("");
    setBasicSheetSyncSuccess("");

    const targetSheetId = extractGoogleSheetId(
      configuredSheetUrls[effectiveBasicSheetSelection]
    );
    if (!targetSheetId) {
      setBasicSheetSyncError(
        "シートIDを取得できないため、シート反映をスキップしました。"
      );
      return;
    }

    if (sheetTabLoadingBySheetId[targetSheetId]) {
      setBasicSheetSyncError(
        "シートタブ一覧を取得中です。少し待ってからフォルダ読み込みしてください。"
      );
      return;
    }

    const tabLoadError = sheetTabErrorBySheetId[targetSheetId];
    if (tabLoadError) {
      setBasicSheetSyncError(
        `シートタブ一覧を取得できないため書き込みできません。${tabLoadError}`
      );
      return;
    }

    const normalizedTargetSheetName = (
      selectedSheetTabBySheetId[targetSheetId] ?? ""
    ).trim();
    if (!normalizedTargetSheetName) {
      setBasicSheetSyncError("書き込み先シートを選択してください。");
      return;
    }

    const fileNames = buildBasicFileNamesFromFolder(files);
    if (fileNames.length === 0) {
      setBasicSheetSyncError(
        "読み込んだフォルダ内に .tif または .tiff ファイルが見つかりません。"
      );
      return;
    }

    const payload: BasicFileNameSheetWritePayload = {
      action: "appendBasicFileNameRows",
      sheetId: targetSheetId,
      sheetName: normalizedTargetSheetName,
      startRow: BASIC_SHEET_START_ROW,
      fontSize: settings.writeFontSize,
      fileNames,
    };

    setIsBasicFolderImporting(true);
    try {
      const result = await postSheetWebhook(
        payload,
        basicSheetWebhookConfig,
        "基本ファイル名書き込み"
      );

      if (result.sheetName && result.sheetName !== normalizedTargetSheetName) {
        throw new Error(
          "Webhook応答に sheetName が含まれていないか不一致です。Apps Scriptを最新コードへ更新してください。"
        );
      }

      const writtenCount =
        typeof result.rowsWritten === "number"
          ? result.rowsWritten
          : fileNames.length;
      const writtenRange =
        typeof result.startRow === "number" && typeof result.endRow === "number"
          ? `${result.startRow}行目〜${result.endRow}行目`
          : `${writtenCount}行`;

      setBasicSheetSyncSuccess(
        `シート「${normalizedTargetSheetName}」のB列へファイル名を${writtenRange}で反映しました。`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "フォルダ読み込み中に不明なエラーが発生しました。";
      setBasicSheetSyncError(message);
    } finally {
      setIsBasicFolderImporting(false);
    }
  };

  const createResidentEntryFromForm = () => {
    return {
      ...residentFormData,
      residentSelfName: settings.isResidentSelfNameFixed
        ? settings.fixedResidentSelfName
        : residentFormData.residentSelfName,
    };
  };

  const upsertResidentEntryToList = (
    residentEntry: ReturnType<typeof createResidentEntryFromForm>,
    options?: {
      clearAfterSave?: boolean;
      skipDuplicateOnInsert?: boolean;
      writtenPosition?: SheetWritePosition;
    }
  ) => {
    const savedAt = new Date().toISOString();
    const editingId = editingResidentEntryId;
    setSavedResidentEntries((prev) => {
      if (editingId !== null) {
        let updated = false;
        const next = prev.map((entry) => {
          if (entry.id !== editingId) {
            return entry;
          }
          updated = true;
          return {
            ...residentEntry,
            id: entry.id,
            savedAt,
            sheetRowsByTarget: mergeSheetRowMap(
              entry.sheetRowsByTarget,
              options?.writtenPosition
            ),
          };
        });
        if (updated) {
          return next;
        }
      }

      if (options?.skipDuplicateOnInsert) {
        const duplicateIndex = prev.findIndex((entry) => {
          return RESIDENT_FIELD_ORDER.every((fieldName) => {
            return entry[fieldName].trim() === residentEntry[fieldName].trim();
          });
        });
        if (duplicateIndex >= 0) {
          if (!options?.writtenPosition) {
            return prev;
          }
          const duplicateEntry = prev[duplicateIndex];
          const mergedSheetRows = mergeSheetRowMap(
            duplicateEntry.sheetRowsByTarget,
            options.writtenPosition
          );
          if (mergedSheetRows === duplicateEntry.sheetRowsByTarget) {
            return prev;
          }
          const next = [...prev];
          next[duplicateIndex] = {
            ...duplicateEntry,
            sheetRowsByTarget: mergedSheetRows,
          };
          return next;
        }
      }

      const nextId =
        prev.length === 0
          ? 1
          : Math.max(...prev.map((entry) => entry.id)) + 1;
      const newEntry: SavedResidentEntry = {
        ...residentEntry,
        id: nextId,
        savedAt,
        sheetRowsByTarget: mergeSheetRowMap(undefined, options?.writtenPosition),
      };
      return [...prev, newEntry];
    });
    setEditingResidentEntryId(null);

    if (options?.clearAfterSave ?? true) {
      handleClear();
    }
  };

  const handleResidentSaveToList = (options?: {
    clearAfterSave?: boolean;
    preserveSheetMessages?: boolean;
  }) => {
    if (residentSheetSelection === "residentSecondary") {
      setResidentSheetSyncError(
        "住民票シート2ではリスト保存は使用しません。書き込みを実行してください。"
      );
      setResidentSheetSyncSuccess("");
      return;
    }

    const residentEntry = createResidentEntryFromForm();
    upsertResidentEntryToList(residentEntry, {
      clearAfterSave: options?.clearAfterSave,
    });

    if (!options?.preserveSheetMessages) {
      setResidentSheetSyncError("");
      setResidentSheetSyncSuccess("");
    }
  };

  const resolveResidentSheetTargetForWrite = () => {
    const targetSheetId = extractGoogleSheetId(
      configuredSheetUrls[residentSheetSelection]
    );
    if (!targetSheetId) {
      setResidentSheetSyncError("シートIDを取得できないため、シート反映をスキップしました。");
      return null;
    }

    if (sheetTabLoadingBySheetId[targetSheetId]) {
      setResidentSheetSyncError(
        "シートタブ一覧を取得中です。少し待ってから書き込みしてください。"
      );
      return null;
    }

    const tabLoadError = sheetTabErrorBySheetId[targetSheetId];
    if (tabLoadError) {
      setResidentSheetSyncError(
        `シートタブ一覧を取得できないため書き込みできません。${tabLoadError}`
      );
      return null;
    }

    const normalizedTargetSheetName = (
      selectedSheetTabBySheetId[targetSheetId] ?? ""
    ).trim();
    if (!normalizedTargetSheetName) {
      setResidentSheetSyncError("書き込み先シートを選択してください。");
      return null;
    }

    return {
      targetSheetId,
      normalizedTargetSheetName,
    };
  };

  const buildResidentSecondaryRowsForWrite = (
    entries: ResidentSecondaryEntry[]
  ): ResidentSecondarySheetWriteRow[] => {
    return entries
      .map((entry) => ({
        B: buildResidentSecondaryColumnBValue(
          entry.fileName,
          settings.isResidentSecondaryColumnBUppercase
        ),
        C: entry.name.trim(),
      }))
      .filter((row) => row.C.length > 0);
  };

  const writeResidentSecondaryRowsToSheet = async (
    rows: ResidentSecondarySheetWriteRow[],
    targetSheetId: string,
    normalizedTargetSheetName: string,
    options?: {
      singleEntryId?: number;
      actionLabel?: string;
    }
  ) => {
    if (rows.length === 0) {
      setResidentSheetSyncError("氏名（C列）を1件以上入力してから書き込みしてください。");
      return;
    }

    const payload: ResidentSecondarySheetWritePayload = {
      action: "appendResidentSecondaryRows",
      sheetId: targetSheetId,
      sheetName: normalizedTargetSheetName,
      startRow: RESIDENT_SECONDARY_SHEET_START_ROW,
      fontSize: settings.writeFontSize,
      rows,
    };

    if (typeof options?.singleEntryId === "number") {
      setResidentSecondaryWritingEntryId(options.singleEntryId);
    } else {
      setIsResidentSheetSaving(true);
    }

    try {
      const result = await postSheetWebhook(
        payload,
        residentSheetWebhookConfig,
        options?.actionLabel ?? "住民票シート2書き込み"
      );

      if (result.sheetName && result.sheetName !== normalizedTargetSheetName) {
        throw new Error(
          "Webhook応答に sheetName が含まれていないか不一致です。Apps Scriptを最新コードへ更新してください。"
        );
      }

      const writtenCount =
        typeof result.rowsWritten === "number" ? result.rowsWritten : rows.length;
      const writtenRange =
        typeof result.startRow === "number" && typeof result.endRow === "number"
          ? `${result.startRow}行目〜${result.endRow}行目`
          : `${writtenCount}行`;
      const successMessage =
        rows.length === 1
          ? `シート「${normalizedTargetSheetName}」のB/C列へ${writtenRange}で1件反映しました。`
          : `シート「${normalizedTargetSheetName}」のB/C列へ${writtenRange}で反映しました。`;
      setResidentSheetSyncSuccess(successMessage);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "シート反映中に不明なエラーが発生しました。";
      setResidentSheetSyncError(message);
    } finally {
      if (typeof options?.singleEntryId === "number") {
        setResidentSecondaryWritingEntryId(null);
      } else {
        setIsResidentSheetSaving(false);
      }
    }
  };

  const handleResidentSecondaryOverwriteWrite = async (entryId: number) => {
    setResidentSheetSyncError("");
    setResidentSheetSyncSuccess("");

    const targetEntry = residentSecondaryEntries.find((entry) => entry.id === entryId);
    if (!targetEntry) {
      setResidentSheetSyncError("対象データが見つかりません。");
      return;
    }

    if (targetEntry.name.trim().length === 0) {
      setResidentSheetSyncError("氏名（C列）を入力してから上書き書き込みしてください。");
      return;
    }

    const resolvedTarget = resolveResidentSheetTargetForWrite();
    if (!resolvedTarget) {
      return;
    }

    const rows = buildResidentSecondaryRowsForWrite([targetEntry]);
    await writeResidentSecondaryRowsToSheet(
      rows,
      resolvedTarget.targetSheetId,
      resolvedTarget.normalizedTargetSheetName,
      {
        singleEntryId: entryId,
        actionLabel: "住民票シート2個別上書き",
      }
    );
  };

  const buildResidentPrimarySheetWritePayload = (
    residentEntry: ReturnType<typeof createResidentEntryFromForm>,
    targetSheetId: string,
    normalizedTargetSheetName: string,
    options?: {
      targetRow?: number;
      preferExistingRow?: boolean;
    }
  ): ResidentSheetWritePayload => {
    const departAddress = joinResidentAddressForSheet([
      residentEntry.departPrefecture,
      residentEntry.departCity,
      residentEntry.departTown,
      residentEntry.departOoaza,
      residentEntry.departAza,
      residentEntry.departKoaza,
      residentEntry.departBanchi,
    ]);
    const registryAddress = joinResidentAddressForSheet([
      residentEntry.registryPrefecture,
      residentEntry.registryCity,
      residentEntry.registryTown,
      residentEntry.registryOoaza,
      residentEntry.registryAza,
      residentEntry.registryKoaza,
      residentEntry.registryBanchi,
    ]);

    const payload: ResidentSheetWritePayload = {
      action: "appendResidentRow",
      sheetId: targetSheetId,
      sheetName: normalizedTargetSheetName,
      startRow: RESIDENT_SHEET_START_ROW,
      fontSize: settings.writeFontSize,
      values: {
        B: residentEntry.residentSelfName,
        F: residentEntry.departName,
        G: departAddress,
        H: residentEntry.departBuilding,
        I: residentEntry.registryName,
        J: registryAddress,
        K: residentEntry.registryBuilding,
        L: residentEntry.residentAlias,
      },
    };

    const normalizedTargetRow = normalizeSheetRow(options?.targetRow);
    if (normalizedTargetRow !== null) {
      payload.targetRow = normalizedTargetRow;
    }
    if (options?.preferExistingRow) {
      payload.preferExistingRow = true;
    }

    return payload;
  };

  const writeResidentPrimaryEntryToSheet = async (
    residentEntry: ReturnType<typeof createResidentEntryFromForm>,
    targetSheetId: string,
    normalizedTargetSheetName: string,
    options?: {
      singleEntryId?: number;
      autoSaveToList?: boolean;
      targetRow?: number;
      preferExistingRow?: boolean;
    }
  ) => {
    const payload = buildResidentPrimarySheetWritePayload(
      residentEntry,
      targetSheetId,
      normalizedTargetSheetName,
      {
        targetRow: options?.targetRow,
        preferExistingRow: options?.preferExistingRow,
      }
    );

    if (typeof options?.singleEntryId === "number") {
      setResidentListWritingEntryId(options.singleEntryId);
    } else {
      setIsResidentSheetSaving(true);
    }

    try {
      const result = await postResidentSheetPayload(
        payload,
        residentSheetWebhookConfig
      );
      const normalizedWrittenRow = normalizeSheetRow(result.row);
      const successMessage =
        normalizedWrittenRow !== null
          ? `シート「${normalizedTargetSheetName}」の${normalizedWrittenRow}行目へ反映しました。`
          : `シート「${normalizedTargetSheetName}」へ反映しました。`;
      const withItemMessage =
        typeof options?.singleEntryId === "number"
          ? `${successMessage}（保存済みリストの1件）`
          : successMessage;
      setResidentSheetSyncSuccess(withItemMessage);

      const writtenPosition =
        normalizedWrittenRow !== null
          ? {
              sheetId: targetSheetId,
              sheetName: normalizedTargetSheetName,
              row: normalizedWrittenRow,
            }
          : undefined;

      if (typeof options?.singleEntryId === "number" && writtenPosition) {
        setSavedResidentEntries((prev) =>
          prev.map((savedEntry) =>
            savedEntry.id === options.singleEntryId
              ? {
                  ...savedEntry,
                  sheetRowsByTarget: mergeSheetRowMap(
                    savedEntry.sheetRowsByTarget,
                    writtenPosition
                  ),
                }
              : savedEntry
          )
        );
      }

      if (options?.autoSaveToList ?? true) {
        upsertResidentEntryToList(residentEntry, {
          clearAfterSave: typeof options?.singleEntryId !== "number",
          skipDuplicateOnInsert: true,
          writtenPosition,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "シート反映中に不明なエラーが発生しました。";
      setResidentSheetSyncError(message);
    } finally {
      if (typeof options?.singleEntryId === "number") {
        setResidentListWritingEntryId(null);
      } else {
        setIsResidentSheetSaving(false);
      }
    }
  };

  const handleResidentListOverwriteWrite = async (entry: SavedResidentEntry) => {
    setResidentSheetSyncError("");
    setResidentSheetSyncSuccess("");

    if (residentSheetSelection !== "residentPrimary") {
      setResidentSheetSyncError("住民票シート1を選択してから実行してください。");
      return;
    }

    const resolvedTarget = resolveResidentSheetTargetForWrite();
    if (!resolvedTarget) {
      return;
    }

    const targetRow = resolveSheetRowFromMap(
      entry.sheetRowsByTarget,
      resolvedTarget.targetSheetId,
      resolvedTarget.normalizedTargetSheetName
    );

    await writeResidentPrimaryEntryToSheet(
      entry,
      resolvedTarget.targetSheetId,
      resolvedTarget.normalizedTargetSheetName,
      {
        singleEntryId: entry.id,
        autoSaveToList: false,
        targetRow,
        preferExistingRow: true,
      }
    );
  };

  const handleResidentWriteToSheet = async () => {
    setResidentSheetSyncError("");
    setResidentSheetSyncSuccess("");

    const resolvedTarget = resolveResidentSheetTargetForWrite();
    if (!resolvedTarget) {
      return;
    }

    if (residentSheetSelection === "residentSecondary") {
      if (residentSecondaryEntries.length === 0) {
        setResidentSheetSyncError(
          "先にフォルダを読み込み、氏名入力欄を生成してください。"
        );
        return;
      }

      const rows = buildResidentSecondaryRowsForWrite(residentSecondaryEntries);
      await writeResidentSecondaryRowsToSheet(
        rows,
        resolvedTarget.targetSheetId,
        resolvedTarget.normalizedTargetSheetName
      );
      return;
    }

    const residentEntry = createResidentEntryFromForm();
    await writeResidentPrimaryEntryToSheet(
      residentEntry,
      resolvedTarget.targetSheetId,
      resolvedTarget.normalizedTargetSheetName,
      {
        autoSaveToList: true,
      }
    );
  };

  const handleResidentFolderImportClick = () => {
    setResidentSheetSyncError("");
    setResidentSheetSyncSuccess("");

    const input = residentFolderInputRef.current;
    if (!input) {
      setResidentSheetSyncError(
        "フォルダ選択入力の初期化に失敗しました。画面を再読み込みしてください。"
      );
      return;
    }

    input.value = "";
    input.click();
  };

  const handleResidentFolderImportChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    setResidentSheetSyncError("");
    setResidentSheetSyncSuccess("");

    if (residentSheetSelection === "residentSecondary") {
      const entries = buildResidentSecondaryEntriesFromFiles(files);
      if (entries.length === 0) {
        setResidentSheetSyncError(
          "読み込んだフォルダ内に .tif または .tiff ファイルが見つかりません。"
        );
        return;
      }

      setResidentSecondaryEntries(entries);
      setResidentSecondaryWritingEntryId(null);
      setResidentSheetSyncSuccess(
        `${entries.length}件のファイルを読み込みました。氏名を入力して書き込みしてください。`
      );
      return;
    }

    const targetSheetId = extractGoogleSheetId(configuredSheetUrls.residentPrimary);
    if (!targetSheetId) {
      setResidentSheetSyncError("シートIDを取得できないため、シート反映をスキップしました。");
      return;
    }

    if (sheetTabLoadingBySheetId[targetSheetId]) {
      setResidentSheetSyncError(
        "シートタブ一覧を取得中です。少し待ってからフォルダ読み込みしてください。"
      );
      return;
    }

    const tabLoadError = sheetTabErrorBySheetId[targetSheetId];
    if (tabLoadError) {
      setResidentSheetSyncError(
        `シートタブ一覧を取得できないため書き込みできません。${tabLoadError}`
      );
      return;
    }

    const normalizedTargetSheetName = (
      selectedSheetTabBySheetId[targetSheetId] ?? ""
    ).trim();
    if (!normalizedTargetSheetName) {
      setResidentSheetSyncError("書き込み先シートを選択してください。");
      return;
    }

    const rows = buildResidentFolderSheetRows(files);
    if (rows.length === 0) {
      setResidentSheetSyncError(
        "子フォルダ内に .tif または .tiff ファイルが見つかりません。"
      );
      return;
    }

    const payload: ResidentFolderSheetWritePayload = {
      action: "appendResidentFolderRows",
      sheetId: targetSheetId,
      sheetName: normalizedTargetSheetName,
      startRow: RESIDENT_SHEET_START_ROW,
      fontSize: settings.writeFontSize,
      rows,
    };

    setIsResidentFolderImporting(true);
    try {
      const result = await postSheetWebhook(
        payload,
        residentSheetWebhookConfig,
        "住民票フォルダ書き込み"
      );

      if (result.sheetName && result.sheetName !== normalizedTargetSheetName) {
        throw new Error(
          "Webhook応答に sheetName が含まれていないか不一致です。Apps Scriptを最新コードへ更新してください。"
        );
      }

      const writtenCount =
        typeof result.rowsWritten === "number" ? result.rowsWritten : rows.length;
      const writtenRange =
        typeof result.startRow === "number" && typeof result.endRow === "number"
          ? `${result.startRow}行目〜${result.endRow}行目`
          : `${writtenCount}行`;
      setResidentSheetSyncSuccess(
        `シート「${normalizedTargetSheetName}」へフォルダ情報を${writtenRange}で反映しました。`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "フォルダ読み込み中に不明なエラーが発生しました。";
      setResidentSheetSyncError(message);
    } finally {
      setIsResidentFolderImporting(false);
    }
  };

  const handleInitializeActiveSheet = async () => {
    if (!activeSheetId) {
      setSheetInitializeError("シートIDを取得できないため、初期化できません。");
      setSheetInitializeSuccess("");
      return;
    }

    if (isActiveSheetTabLoading) {
      setSheetInitializeError(
        "シートタブ一覧を取得中です。少し待ってから初期化してください。"
      );
      setSheetInitializeSuccess("");
      return;
    }

    if (activeSheetTabError) {
      setSheetInitializeError(
        `シートタブ一覧を取得できないため初期化できません。${activeSheetTabError}`
      );
      setSheetInitializeSuccess("");
      return;
    }

    const targetSheetName = activeSelectedSheetName.trim();
    if (!targetSheetName) {
      setSheetInitializeError("初期化対象のシートを選択してください。");
      setSheetInitializeSuccess("");
      return;
    }

    const clearConfig =
      mode === "basic"
        ? {
            startRow: 5,
            endRow: 1000,
            clearAllColumns: true,
            startColumn: undefined,
            endColumn: undefined,
            description: "全列 5行目から1000行目",
          }
        : residentSheetSelection === "residentSecondary"
          ? {
              startRow: 3,
              endRow: 1000,
              clearAllColumns: false,
              startColumn: 2,
              endColumn: 3,
              description: "B3:C1000",
            }
          : {
              startRow: 6,
              endRow: 1000,
              clearAllColumns: true,
              startColumn: undefined,
              endColumn: undefined,
              description: "全列 6行目から1000行目",
            };

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `シート「${targetSheetName}」の${clearConfig.description}を初期化します。よろしいですか？`
      );
      if (!confirmed) {
        return;
      }
    }

    setSheetInitializeError("");
    setSheetInitializeSuccess("");

    const payload: SheetClearPayload = {
      action: "clearSheetRange",
      sheetId: activeSheetId,
      sheetName: targetSheetName,
      startRow: clearConfig.startRow,
      endRow: clearConfig.endRow,
      clearAllColumns: clearConfig.clearAllColumns,
      startColumn: clearConfig.startColumn,
      endColumn: clearConfig.endColumn,
    };

    setIsSheetInitializing(true);
    try {
      const result = await postSheetWebhook(
        payload,
        activeSheetWebhookConfig,
        "シート初期化"
      );
      if (result.sheetName && result.sheetName !== targetSheetName) {
        throw new Error(
          "Webhook応答の sheetName が不一致です。Apps Scriptを最新コードへ更新してください。"
        );
      }

      setSheetInitializeSuccess(
        result.clearedRange
          ? `シート「${targetSheetName}」の${result.clearedRange}を初期化しました。`
          : `シート「${targetSheetName}」を初期化しました。`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "初期化中に不明なエラーが発生しました。";
      setSheetInitializeError(message);
    } finally {
      setIsSheetInitializing(false);
    }
  };

  const handleClear = () => {
    if (mode === "basic") {
      setFormData({
        ...DEFAULT_FORM_DATA,
        operator: settings.isOperatorFixed ? settings.fixedOperatorName : DEFAULT_FORM_DATA.operator,
        filename: settings.isFilenameFixed ? settings.fixedFilename : DEFAULT_FORM_DATA.filename,
      });
      setBasicAddressAiError("");
      setBasicAddressAiResult(null);
      setBasicMapSearchError("");
      setBasicMapEmbedUrl("");
      setBasicMapDisplayedAddress("");
      setIsBasicMapLoaded(false);
      setIsBasicMapResolving(false);
    } else {
      setResidentFormData({
        ...DEFAULT_RESIDENT_FORM_DATA,
        residentSelfName: settings.isResidentSelfNameFixed
          ? settings.fixedResidentSelfName
          : DEFAULT_RESIDENT_FORM_DATA.residentSelfName,
      });
      resetResidentAddressCheckState();
      setResidentMapSearchErrorBySection({
        depart: "",
        registry: "",
      });
      setResidentMapEmbedUrlBySection({
        depart: "",
        registry: "",
      });
      setResidentMapDisplayedAddressBySection({
        depart: "",
        registry: "",
      });
      setResidentMapLoadedBySection({
        depart: false,
        registry: false,
      });
      setResidentMapResolvingBySection({
        depart: false,
        registry: false,
      });
    }
  };

  const handleDeleteEntry = (id: number) => {
    setSavedEntries((prev) => prev.filter((entry) => entry.id !== id));
    setEditingBasicEntryId((prev) => (prev === id ? null : prev));
    setBasicListWritingEntryId((prev) => (prev === id ? null : prev));
  };

  const handleMoveBasicEntry = (id: number, direction: "up" | "down") => {
    setSavedEntries((prev) => {
      const index = prev.findIndex((entry) => entry.id === id);
      if (index < 0) {
        return prev;
      }

      const toIndex = direction === "up" ? index - 1 : index + 1;
      return moveArrayItem(prev, index, toIndex);
    });
  };

  const handleDeleteResidentEntry = (id: number) => {
    setSavedResidentEntries((prev) => prev.filter((entry) => entry.id !== id));
    setEditingResidentEntryId((prev) => (prev === id ? null : prev));
    setResidentListWritingEntryId((prev) => (prev === id ? null : prev));
  };

  const handleMoveResidentEntry = (id: number, direction: "up" | "down") => {
    setSavedResidentEntries((prev) => {
      const index = prev.findIndex((entry) => entry.id === id);
      if (index < 0) {
        return prev;
      }

      const toIndex = direction === "up" ? index - 1 : index + 1;
      return moveArrayItem(prev, index, toIndex);
    });
  };

  const handleEditEntry = (entry: SavedEntry) => {
    setFormData({
      operator: settings.isOperatorFixed ? settings.fixedOperatorName : entry.operator,
      filename: settings.isFilenameFixed ? settings.fixedFilename : entry.filename,
      postalCode: entry.postalCode,
      prefecture: entry.prefecture,
      city: entry.city,
      town: entry.town,
      ooaza: entry.ooaza,
      aza: entry.aza,
      koaza: entry.koaza,
      banchi: entry.banchi,
      building: entry.building,
      company: entry.company,
      position: entry.position,
      name: entry.name,
      phone: entry.phone,
      notes: entry.notes,
    });
    setShowNotes(Boolean(entry.notes));
    setEditingBasicEntryId(entry.id);
  };

  const handleEditResidentEntry = (entry: SavedResidentEntry) => {
    setResidentFormData({
      residentSelfName: settings.isResidentSelfNameFixed
        ? settings.fixedResidentSelfName
        : entry.residentSelfName,
      departName: entry.departName,
      departPrefecture: entry.departPrefecture,
      departCity: entry.departCity,
      departTown: entry.departTown,
      departOoaza: entry.departOoaza,
      departAza: entry.departAza,
      departKoaza: entry.departKoaza,
      departBanchi: entry.departBanchi,
      departBuilding: entry.departBuilding,
      registryName: entry.registryName,
      registryPrefecture: entry.registryPrefecture,
      registryCity: entry.registryCity,
      registryTown: entry.registryTown,
      registryOoaza: entry.registryOoaza,
      registryAza: entry.registryAza,
      registryKoaza: entry.registryKoaza,
      registryBanchi: entry.registryBanchi,
      registryBuilding: entry.registryBuilding,
      residentAlias: entry.residentAlias,
    });
    setResidentSheetSyncError("");
    setResidentSheetSyncSuccess("");
    setEditingResidentEntryId(entry.id);
  };

  const handleCopyBasicEntries = async () => {
    if (savedEntries.length === 0) {
      return;
    }

    const tsvData = savedEntries
      .map((entry) => {
        return [
          entry.operator,
          entry.filename,
          entry.postalCode,
          entry.prefecture,
          entry.city,
          entry.town,
          entry.ooaza,
          entry.aza,
          entry.koaza,
          entry.banchi,
          entry.building,
          entry.company,
          entry.position,
          entry.name,
          entry.phone,
          entry.notes,
        ].join("\t");
      })
      .join("\n");

    try {
      // Try modern Clipboard API first
      await navigator.clipboard.writeText(tsvData);
    } catch (err) {
      // Fallback to textarea method
      try {
        const textarea = document.createElement("textarea");
        textarea.value = tsvData;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch (fallbackErr) {
        console.error(err, fallbackErr);
      }
    }
  };

  const handleCopyResidentEntries = async () => {
    if (savedResidentEntries.length === 0) {
      return;
    }

    const tsvData = savedResidentEntries
      .map((entry) => {
        return [
          entry.residentSelfName,
          entry.departName,
          entry.departPrefecture,
          entry.departCity,
          entry.departTown,
          entry.departOoaza,
          entry.departAza,
          entry.departKoaza,
          entry.departBanchi,
          entry.departBuilding,
          entry.registryName,
          entry.registryPrefecture,
          entry.registryCity,
          entry.registryTown,
          entry.registryOoaza,
          entry.registryAza,
          entry.registryKoaza,
          entry.registryBanchi,
          entry.registryBuilding,
          entry.residentAlias,
        ].join("\t");
      })
      .join("\n");

    try {
      // Try modern Clipboard API first
      await navigator.clipboard.writeText(tsvData);
    } catch (err) {
      // Fallback to textarea method
      try {
        const textarea = document.createElement("textarea");
        textarea.value = tsvData;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch (fallbackErr) {
        console.error(err, fallbackErr);
      }
    }
  };

  const handleSimpleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const isValidCredential =
      simpleLoginName.trim() === SIMPLE_LOGIN_NAME &&
      simpleLoginPass === SIMPLE_LOGIN_PASS;
    if (!isValidCredential) {
      setSimpleLoginError("name または pass が正しくありません。");
      return;
    }

    setSimpleLoginError("");
    setIsSimpleLoginPassed(true);

    try {
      window.localStorage.setItem(SIMPLE_LOGIN_PASSED_STORAGE_KEY, "true");
    } catch {
      // 保存に失敗した場合はメモリ上の値を使う
    }
  };

  if (!isSimpleLoginPassed) {
    return (
      <div className="data-entry-form min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl text-gray-900">データ入力補助ツール</h1>
          <p className="mt-2 text-sm text-gray-600">
            初回利用時のみ簡易ログインが必要です。
          </p>
          <form className="mt-5 space-y-3" onSubmit={handleSimpleLogin}>
            <div>
              <label className="block text-sm text-gray-700 mb-1">name</label>
              <input
                type="text"
                value={simpleLoginName}
                onChange={(event) => {
                  setSimpleLoginName(event.target.value);
                  if (simpleLoginError) {
                    setSimpleLoginError("");
                  }
                }}
                autoComplete="username"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="name を入力"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">pass</label>
              <input
                type="password"
                value={simpleLoginPass}
                onChange={(event) => {
                  setSimpleLoginPass(event.target.value);
                  if (simpleLoginError) {
                    setSimpleLoginError("");
                  }
                }}
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="pass を入力"
                required
              />
            </div>
            {simpleLoginError && (
              <p className="text-sm text-red-600" role="alert">
                {simpleLoginError}
              </p>
            )}
            <button
              type="submit"
              className="w-full px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              ログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="data-entry-form h-screen flex bg-gray-50">
      {/* 左側：入力フォーム */}
      <div className="w-1/2 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-8">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <User className="w-8 h-8 text-blue-600" />
              <h1 className="text-2xl text-gray-900">データ入力補助ツール</h1>
            </div>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="px-3 py-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-2 text-sm"
            >
              <Settings className="w-4 h-4" />
              設定
            </button>
          </div>

          {/* モード切り替えボタン */}
          <div className="mb-6 flex gap-2 border-b border-gray-200 pb-4">
            <button
              onClick={() => setMode("basic")}
              className={`flex-1 px-4 py-2.5 rounded flex items-center justify-center gap-2 transition-colors ${
                mode === "basic"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <User className="w-4 h-4" />
              基本モード
            </button>
            <button
              onClick={() => setMode("resident")}
              className={`flex-1 px-4 py-2.5 rounded flex items-center justify-center gap-2 transition-colors ${
                mode === "resident"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <FileUser className="w-4 h-4" />
              住民票モード
            </button>
          </div>

          {mode === "basic" ? (
            // 基本モード
            <>
              <div
                ref={basicFormRef}
                className="space-y-4"
                onKeyDown={handleBasicFormNavigation}
              >
                {/* 2列レイアウト - 入力者、ファイル名 */}
                <div className="grid grid-cols-2 gap-4">
                  {/* 入力者 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      入力者
                    </label>
                    <input
                      type="text"
                      name="operator"
                      value={
                        settings.isOperatorFixed
                          ? settings.fixedOperatorName
                          : formData.operator
                      }
                      onChange={handleChange}
                      disabled={settings.isOperatorFixed}
                      className={`w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        settings.isOperatorFixed ? "bg-gray-100 text-gray-500" : ""
                      }`}
                      placeholder="入力者名を入力"
                    />
                  </div>

                  {/* ファイル名 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      ファイル名
                    </label>
                    <input
                      type="text"
                      name="filename"
                      value={
                        settings.isFilenameFixed
                          ? settings.fixedFilename
                          : formData.filename
                      }
                      onChange={handleChange}
                      disabled={settings.isFilenameFixed}
                      className={`w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        settings.isFilenameFixed ? "bg-gray-100 text-gray-500" : ""
                      }`}
                      placeholder="ファイル名を入力"
                    />
                  </div>
                </div>

                {isBasicSecondarySheetMode && (
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        肩書
                      </label>
                      <input
                        type="text"
                        name="position"
                        value={formData.position}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="役職・肩書を入力"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        氏名
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="氏名を入力"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        会社名
                      </label>
                      <input
                        type="text"
                        name="company"
                        value={formData.company}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="会社名を入力"
                      />
                    </div>
                  </div>
                )}

                {/* 郵便番号 */}
                <div
                  className="relative"
                  onFocusCapture={() => {
                    setIsPostalSuggestionVisible(true);
                    resetSuggestionFocus("postal");
                  }}
                  onBlurCapture={(e) =>
                    handleSuggestionAreaBlur(e, setIsPostalSuggestionVisible, "postal")
                  }
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="block text-sm text-gray-700">
                      郵便番号
                    </label>
                    <label className="inline-flex items-center gap-1 text-xs text-gray-600 select-none">
                      <input
                        type="checkbox"
                        checked={basicWriteSkipFields.postalCode}
                        onChange={(e) =>
                          handleBasicWriteSkipFieldToggle("postalCode", e.target.checked)
                        }
                        className="h-3.5 w-3.5"
                      />
                      書込除外
                    </label>
                  </div>
                  <input
                    type="text"
                    name="postalCode"
                    value={formData.postalCode}
                    onChange={handleChange}
                    onKeyDown={(e) =>
                      handleSuggestionKeyDown(
                        e,
                        "postal",
                        isPostalSuggestionVisible,
                        postalCodeSuggestions.length,
                        setIsPostalSuggestionVisible,
                        (index) => applyAddressSuggestion(postalCodeSuggestions[index]),
                        setIsPostalSuggestionVisible
                      )
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="000-0000"
                  />

                  {/* 住所補完表示エリア（郵便番号） */}
                  {isPostalSuggestionVisible && formData.postalCode && (
                    <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                      {isKenAllLoading ? (
                        <div className="px-3 py-2 text-sm text-gray-600">
                          住所マスタを読み込み中です...
                        </div>
                      ) : kenAllLoadError ? (
                        <div className="px-3 py-2 text-sm text-red-600">{kenAllLoadError}</div>
                      ) : postalCodeSuggestions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">該当する候補がありません</div>
                      ) : (
                        <VirtualSuggestionList
                          count={postalCodeSuggestions.length}
                          activeIndex={activeSuggestionIndex.postal}
                          getKey={(index) => {
                            const suggestion = postalCodeSuggestions[index];
                            return `postal-suggestion-${suggestion.postalCode}-${suggestion.prefecture}-${suggestion.city}-${suggestion.town}-${index}`;
                          }}
                          getLabel={(index) => {
                            const suggestion = postalCodeSuggestions[index];
                            return joinWithFullWidthSpace([
                              suggestion.postalCode,
                              suggestion.prefecture,
                              suggestion.city,
                              suggestion.town || "（町域なし）",
                            ]);
                          }}
                          onHover={(index) =>
                            setActiveSuggestionIndex((prev) => ({
                              ...prev,
                              postal: index,
                            }))
                          }
                          onSelect={(index) =>
                            applyAddressSuggestion(postalCodeSuggestions[index])
                          }
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* 3列レイアウト - 都道府県、市区町村、町域 */}
                <div className="grid grid-cols-3 gap-4">
                  {/* 都道府県 */}
                  <div
                    className="relative"
                    onFocusCapture={() => {
                      setIsPrefectureSuggestionVisible(true);
                      resetSuggestionFocus("prefecture");
                    }}
                    onBlurCapture={(e) =>
                      handleSuggestionAreaBlur(
                        e,
                        setIsPrefectureSuggestionVisible,
                        "prefecture"
                      )
                    }
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-sm text-gray-700">
                        都道府県
                      </label>
                      <label className="inline-flex items-center gap-1 text-xs text-gray-600 select-none">
                        <input
                          type="checkbox"
                          checked={basicWriteSkipFields.prefecture}
                          onChange={(e) =>
                            handleBasicWriteSkipFieldToggle("prefecture", e.target.checked)
                          }
                          className="h-3.5 w-3.5"
                        />
                        書込除外
                      </label>
                    </div>
                    <input
                      type="text"
                      name="prefecture"
                      value={formData.prefecture}
                      onChange={handleChange}
                      onCompositionStart={() => setIsPrefectureComposing(true)}
                      onCompositionEnd={() => setIsPrefectureComposing(false)}
                      onKeyDown={(e) =>
                        handleSuggestionKeyDown(
                          e,
                          "prefecture",
                          isPrefectureSuggestionVisible,
                          prefectureSuggestions.length,
                          setIsPrefectureSuggestionVisible,
                          (index) =>
                            applyPrefectureSuggestion(prefectureSuggestions[index]),
                          setIsPrefectureSuggestionVisible
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="都道府県を入力"
                    />
                    {isPrefectureSuggestionVisible && formData.prefecture && (
                      <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                        {isKenAllLoading ? (
                          <div className="px-3 py-2 text-sm text-gray-600">
                            住所マスタを読み込み中です...
                          </div>
                        ) : kenAllLoadError ? (
                          <div className="px-3 py-2 text-sm text-red-600">{kenAllLoadError}</div>
                        ) : prefectureSuggestions.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">該当する候補がありません</div>
                        ) : (
                          <VirtualSuggestionList
                            count={prefectureSuggestions.length}
                            activeIndex={activeSuggestionIndex.prefecture}
                            getKey={(index) =>
                              `prefecture-suggestion-${prefectureSuggestions[index]}-${index}`
                            }
                            getLabel={(index) => prefectureSuggestions[index]}
                            onHover={(index) =>
                              setActiveSuggestionIndex((prev) => ({
                                ...prev,
                                prefecture: index,
                              }))
                            }
                            onSelect={(index) =>
                              applyPrefectureSuggestion(prefectureSuggestions[index])
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* 市区町村 */}
                  <div
                    className="relative"
                    onFocusCapture={() => {
                      setIsCitySuggestionVisible(true);
                      resetSuggestionFocus("city");
                    }}
                    onBlurCapture={(e) =>
                      handleSuggestionAreaBlur(e, setIsCitySuggestionVisible, "city")
                    }
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-sm text-gray-700">
                        市区町村
                      </label>
                      <label className="inline-flex items-center gap-1 text-xs text-gray-600 select-none">
                        <input
                          type="checkbox"
                          checked={basicWriteSkipFields.city}
                          onChange={(e) =>
                            handleBasicWriteSkipFieldToggle("city", e.target.checked)
                          }
                          className="h-3.5 w-3.5"
                        />
                        書込除外
                      </label>
                    </div>
                    <input
                      type="text"
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                      onCompositionStart={() => setIsCityComposing(true)}
                      onCompositionEnd={() => setIsCityComposing(false)}
                      onKeyDown={(e) =>
                        handleSuggestionKeyDown(
                          e,
                          "city",
                          isCitySuggestionVisible,
                          citySuggestions.length,
                          setIsCitySuggestionVisible,
                          (index) => applyCitySuggestion(citySuggestions[index]),
                          setIsCitySuggestionVisible
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="市区町村を入力"
                    />
                    {isCitySuggestionVisible && formData.city && (
                      <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                        {isKenAllLoading ? (
                          <div className="px-3 py-2 text-sm text-gray-600">
                            住所マスタを読み込み中です...
                          </div>
                        ) : kenAllLoadError ? (
                          <div className="px-3 py-2 text-sm text-red-600">{kenAllLoadError}</div>
                        ) : citySuggestions.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">該当する候補がありません</div>
                        ) : (
                          <VirtualSuggestionList
                            count={citySuggestions.length}
                            activeIndex={activeSuggestionIndex.city}
                            getKey={(index) => {
                              const suggestion = citySuggestions[index];
                              return `city-suggestion-${suggestion.prefecture}-${suggestion.city}-${index}`;
                            }}
                            getLabel={(index) => {
                              const suggestion = citySuggestions[index];
                              return joinWithFullWidthSpace([
                                suggestion.prefecture,
                                suggestion.city,
                              ]);
                            }}
                            onHover={(index) =>
                              setActiveSuggestionIndex((prev) => ({
                                ...prev,
                                city: index,
                              }))
                            }
                            onSelect={(index) =>
                              applyCitySuggestion(citySuggestions[index])
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* 町域 */}
                  <div
                    className="relative"
                    onFocusCapture={() => {
                      setIsTownSuggestionVisible(true);
                      resetSuggestionFocus("town");
                    }}
                    onBlurCapture={(e) =>
                      handleSuggestionAreaBlur(e, setIsTownSuggestionVisible, "town")
                    }
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-sm text-gray-700">
                        町域
                      </label>
                      <label className="inline-flex items-center gap-1 text-xs text-gray-600 select-none">
                        <input
                          type="checkbox"
                          checked={basicWriteSkipFields.town}
                          onChange={(e) =>
                            handleBasicWriteSkipFieldToggle("town", e.target.checked)
                          }
                          className="h-3.5 w-3.5"
                        />
                        書込除外
                      </label>
                    </div>
                    <input
                      type="text"
                      name="town"
                      value={formData.town}
                      onChange={handleChange}
                      onCompositionStart={() => setIsTownComposing(true)}
                      onCompositionEnd={() => setIsTownComposing(false)}
                      onKeyDown={(e) =>
                        handleSuggestionKeyDown(
                          e,
                          "town",
                          isTownSuggestionVisible,
                          townSuggestions.length,
                          setIsTownSuggestionVisible,
                          (index) => applyAddressSuggestion(townSuggestions[index]),
                          setIsTownSuggestionVisible
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="町域を入力"
                    />
                    {isTownSuggestionVisible && formData.town && (
                      <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                        {isKenAllLoading ? (
                          <div className="px-3 py-2 text-sm text-gray-600">
                            住所マスタを読み込み中です...
                          </div>
                        ) : kenAllLoadError ? (
                          <div className="px-3 py-2 text-sm text-red-600">{kenAllLoadError}</div>
                        ) : townSuggestions.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">該当する候補がありません</div>
                        ) : (
                          <VirtualSuggestionList
                            count={townSuggestions.length}
                            activeIndex={activeSuggestionIndex.town}
                            getKey={(index) => {
                              const suggestion = townSuggestions[index];
                              return `town-suggestion-${suggestion.postalCode}-${suggestion.prefecture}-${suggestion.city}-${suggestion.town}-${index}`;
                            }}
                            getLabel={(index) => {
                              const suggestion = townSuggestions[index];
                              return joinWithFullWidthSpace([
                                suggestion.prefecture,
                                suggestion.city,
                                suggestion.town || "（町域なし）",
                              ]);
                            }}
                            onHover={(index) =>
                              setActiveSuggestionIndex((prev) => ({
                                ...prev,
                                town: index,
                              }))
                            }
                            onSelect={(index) =>
                              applyAddressSuggestion(townSuggestions[index])
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  補完候補は ↑/↓ で移動し、Enter で選択できます。
                </p>
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-emerald-900">
                      入力中の住所を Google Maps で埋め込み表示できます。
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void handleOpenBasicAddressInGoogleMaps();
                      }}
                      disabled={isBasicMapResolving}
                      className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed"
                    >
                      {isBasicMapResolving ? "地図検索中..." : "地図表示"}
                    </button>
                  </div>
                  {basicMapSearchError && (
                    <p className="mt-2 text-xs text-red-600">{basicMapSearchError}</p>
                  )}
                  {basicMapEmbedUrl && (
                    <div className="mt-2 overflow-hidden rounded border border-emerald-200 bg-white">
                      <iframe
                        title="基本モード住所の地図"
                        src={basicMapEmbedUrl}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        onLoad={() => {
                          setIsBasicMapLoaded(true);
                        }}
                        className="h-64 w-full border-0"
                      />
                    </div>
                  )}
                  {isBasicMapLoaded && basicMapDisplayedAddress && (
                    <p className="mt-2 text-[11px] text-emerald-900 break-all">
                      検索住所: {basicMapDisplayedAddress}
                    </p>
                  )}
                </div>
                {settings.isAddressCheckEnabled && (
                  <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-blue-900">
                          住所チェック（手入力住所）
                        </p>
                        <p className="text-[11px] text-blue-700">
                          入力中の住所をブラウザ内推論で検証し、誤り候補があれば修正案を表示します。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleBasicAddressAiCheck();
                        }}
                        disabled={isBasicAddressAiChecking}
                        className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                      >
                        {isBasicAddressAiChecking ? "住所判定中..." : "住所チェック"}
                      </button>
                    </div>
                    {basicAddressAiError && (
                      <p className="mt-2 text-xs text-red-600">{basicAddressAiError}</p>
                    )}
                    {basicAddressAiResult && (
                      <div className="mt-2 rounded border border-blue-100 bg-white px-2.5 py-2 text-xs text-gray-700 space-y-1">
                        <div>
                          判定:
                          <span
                            className={`ml-1 font-semibold ${
                              basicAddressAiResult.isValidAddress
                                ? "text-emerald-700"
                                : "text-amber-700"
                            }`}
                          >
                            {basicAddressAiResult.isValidAddress
                              ? "実在の可能性が高い"
                              : "誤りの可能性あり"}
                          </span>
                        </div>
                        <div>理由: {basicAddressAiResult.reason}</div>
                        <div>
                          信頼度: {(basicAddressAiResult.confidence * 100).toFixed(0)}%
                        </div>
                        <div>参照候補件数: {basicAddressAiResult.referenceCandidateCount}件</div>
                        <div className="truncate">判定対象: {basicAddressAiResult.checkedAddress}</div>
                        {hasBasicAddressAiCorrection && (
                          <div className="pt-1">
                            <p>
                              修正候補:
                              {[
                                basicAddressAiResult.corrected?.prefecture,
                                basicAddressAiResult.corrected?.city,
                                basicAddressAiResult.corrected?.town,
                              ]
                                .filter(Boolean)
                                .join("") || "（住所候補なし）"}
                              {basicAddressAiResult.corrected?.postalCode
                                ? ` / ${formatPostalCode(
                                    basicAddressAiResult.corrected.postalCode
                                  )}`
                                : ""}
                            </p>
                            <button
                              type="button"
                              onClick={handleApplyBasicAddressAiCorrection}
                              className="mt-1 px-2.5 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              候補を適用
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 3列レイアウト - 大字、字、小字 */}
                <div className="grid grid-cols-3 gap-4">
                  {/* 大字 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      大字
                    </label>
                    <input
                      type="text"
                      name="ooaza"
                      value={formData.ooaza}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="大字を入力"
                    />
                  </div>

                  {/* 字 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      字
                    </label>
                    <input
                      type="text"
                      name="aza"
                      value={formData.aza}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="字を入力"
                    />
                  </div>

                  {/* 小字 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      小字
                    </label>
                    <input
                      type="text"
                      name="koaza"
                      value={formData.koaza}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="小字を入力"
                    />
                  </div>
                </div>

                {/* 2列レイアウト - 番地、建物名 */}
                <div className="grid grid-cols-2 gap-4">
                  {/* 番地 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      番地
                    </label>
                    <input
                      type="text"
                      name="banchi"
                      value={formData.banchi}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="番地を入力"
                    />
                  </div>

                  {/* 建物名 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      建物名
                    </label>
                    <input
                      type="text"
                      name="building"
                      value={formData.building}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="建物名を入力"
                    />
                  </div>
                </div>

                {isBasicSecondarySheetMode ? (
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      電話番号
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      onFocus={() => setPhoneInputMode("mobile")}
                      onKeyDown={(e) => {
                        if (e.key === "Shift") {
                          setPhoneInputMode("landline");
                          return;
                        }

                        if (!e.shiftKey) {
                          return;
                        }

                        const mappedDigit = SHIFTED_NUMBER_TO_DIGIT_MAP[e.key];
                        if (!mappedDigit) {
                          return;
                        }

                        e.preventDefault();
                        setPhoneInputMode("landline");
                        setFormData((prev) => ({
                          ...prev,
                          phone: formatPhoneNumber(
                            `${prev.phone}${mappedDigit}`,
                            "landline"
                          ),
                        }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="000-0000-0000"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      通常: 携帯番号 / Shift押下: 固定電話形式
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {/* 会社名 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        会社名
                      </label>
                      <input
                        type="text"
                        name="company"
                        value={formData.company}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="会社名を入力"
                      />
                    </div>

                    {/* 肩書 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        肩書
                      </label>
                      <input
                        type="text"
                        name="position"
                        value={formData.position}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="役職・肩書を入力"
                      />
                    </div>

                    {/* 氏名 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        氏名
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="氏名を入力"
                      />
                    </div>

                    {/* 電話番号 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        電話番号
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleChange}
                        onFocus={() => setPhoneInputMode("mobile")}
                        onKeyDown={(e) => {
                          if (e.key === "Shift") {
                            setPhoneInputMode("landline");
                            return;
                          }

                          if (!e.shiftKey) {
                            return;
                          }

                          const mappedDigit = SHIFTED_NUMBER_TO_DIGIT_MAP[e.key];
                          if (!mappedDigit) {
                            return;
                          }

                          e.preventDefault();
                          setPhoneInputMode("landline");
                          setFormData((prev) => ({
                            ...prev,
                            phone: formatPhoneNumber(
                              `${prev.phone}${mappedDigit}`,
                              "landline"
                            ),
                          }));
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="000-0000-0000"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        通常: 携帯番号 / Shift押下: 固定電話形式
                      </p>
                    </div>
                  </div>
                )}

                {/* 備考（折り畳み式） */}
                <div className="border border-gray-300 rounded">
                  <button
                    type="button"
                    onClick={() => setShowNotes(!showNotes)}
                    className="w-full px-3 py-2 flex items-center justify-between text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span>備考</span>
                    <ChevronDown 
                      className={`w-4 h-4 transition-transform ${showNotes ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {showNotes && (
                    <div className="p-3 border-t border-gray-300">
                      <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={handleChange}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="その他の情報を入力"
                      />
                    </div>
                  )}
                </div>
              </div>

              <input
                ref={basicFolderInputRef}
                type="file"
                multiple
                onChange={handleBasicFolderImportChange}
                className="hidden"
              />

              {/* ボタン */}
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={handleBasicSaveToList}
                  disabled={isBasicSheetSaving || isBasicFolderImporting || isBasicListEntryWriting}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {editingBasicEntryId === null ? "リストへ保存" : "編集を上書き保存"}
                </button>
                <button
                  onClick={handleBasicWriteToSheet}
                  disabled={
                    isBasicSheetSaving || isBasicFolderImporting || isBasicListEntryWriting
                  }
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Table2 className="w-4 h-4" />
                  {isBasicSheetSaving ? "書き込み中..." : "書き込み"}
                </button>
                <button
                  onClick={handleBasicFolderImportClick}
                  disabled={
                    isBasicSheetSaving || isBasicFolderImporting || isBasicListEntryWriting
                  }
                  className="flex-1 px-4 py-2.5 bg-cyan-600 text-white rounded hover:bg-cyan-700 disabled:bg-cyan-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {isBasicFolderImporting ? "読込中..." : "フォルダを読み込み"}
                </button>
                <button
                  onClick={handleClear}
                  disabled={isBasicListEntryWriting}
                  className="px-6 py-2.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  クリア
                </button>
                <button
                  onClick={handleCopyBasicEntries}
                  className="px-6 py-2.5 bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  コピー
                </button>
              </div>
              {basicSheetSyncSuccess && (
                <p className="mt-2 text-sm text-green-700">{basicSheetSyncSuccess}</p>
              )}
              {basicSheetSyncError && (
                <p className="mt-2 text-sm text-red-600">{basicSheetSyncError}</p>
              )}

              {/* 保存済みリスト */}
              <div className="mt-8">
                <h2 className="text-lg text-gray-900 mb-4">保存済みリスト ({savedEntries.length}件)</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {savedEntries.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      保存されたデータはありません
                    </div>
                  ) : (
                    savedEntries.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="p-4 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-sm font-medium text-gray-900">
                                {entry.name || "（氏名なし）"}
                              </span>
                              <span className="text-xs text-gray-500">
                                {entry.company}
                              </span>
                            </div>
                            <div className="text-xs text-gray-600 space-y-1">
                              <div>
                                📍 {[
                                  entry.prefecture,
                                  entry.city,
                                  entry.town,
                                  entry.ooaza,
                                  entry.aza,
                                  entry.koaza,
                                  entry.banchi,
                                  entry.building
                                ].filter(Boolean).join(" ") || "—"}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>📞 {entry.phone || "—"}</div>
                                <div>👤 {entry.operator || "—"}</div>
                              </div>
                            </div>
                            {entry.notes && (
                              <div className="mt-2 text-xs text-gray-500 truncate">
                                備考: {entry.notes}
                              </div>
                            )}
                          </div>
                          <div className="ml-3 flex items-center gap-1">
                            <button
                              onClick={() => handleMoveBasicEntry(entry.id, "up")}
                              disabled={
                                index === 0 ||
                                isBasicSheetSaving ||
                                isBasicFolderImporting ||
                                isBasicListEntryWriting
                              }
                              className="p-2 text-gray-400 hover:text-gray-700 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                              title="上へ移動"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleMoveBasicEntry(entry.id, "down")}
                              disabled={
                                index === savedEntries.length - 1 ||
                                isBasicSheetSaving ||
                                isBasicFolderImporting ||
                                isBasicListEntryWriting
                              }
                              className="p-2 text-gray-400 hover:text-gray-700 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                              title="下へ移動"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                void handleBasicListOverwriteWrite(entry);
                              }}
                              disabled={
                                isBasicSheetSaving ||
                                isBasicFolderImporting ||
                                isBasicListEntryWriting
                              }
                              className="px-2 py-1 rounded border border-emerald-300 text-emerald-700 text-xs hover:bg-emerald-50 disabled:text-gray-400 disabled:border-gray-300 disabled:cursor-not-allowed"
                              title="上書き書き込み"
                            >
                              {basicListWritingEntryId === entry.id
                                ? "上書き中..."
                                : "上書き書き込み"}
                            </button>
                            <button
                              onClick={() => handleDeleteEntry(entry.id)}
                              disabled={
                                isBasicSheetSaving ||
                                isBasicFolderImporting ||
                                isBasicListEntryWriting
                              }
                              className="p-2 text-gray-400 hover:text-red-600 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                              title="削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleEditEntry(entry)}
                              disabled={
                                isBasicSheetSaving ||
                                isBasicFolderImporting ||
                                isBasicListEntryWriting
                              }
                              className="p-2 text-gray-400 hover:text-blue-600 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                              title="編集"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            // 住民票モード
            <>
              <div
                ref={residentFormRef}
                className="space-y-4"
                onKeyDown={
                  residentSheetSelection === "residentPrimary"
                    ? handleResidentFormNavigation
                    : undefined
                }
              >
                <div>
                  <label className="block text-sm text-gray-700 mb-1.5">
                    書き込み先シート
                  </label>
                  <select
                    value={residentTargetSheetName}
                    onChange={(event) =>
                      handleActiveSheetTabSelectionChange(event.target.value)
                    }
                    disabled={isActiveSheetTabLoading || activeSheetTabs.length === 0}
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">
                      {isActiveSheetTabLoading
                        ? "シートタブを取得中..."
                        : activeSheetTabs.length === 0
                          ? "シートタブを取得できません"
                          : "書き込み先シートを選択"}
                    </option>
                    {activeSheetTabs.map((sheet) => (
                      <option
                        key={`${sheet.gid}-${sheet.name}`}
                        value={sheet.name}
                      >
                        {sheet.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    住民票書き込み時は、選択中のシートタブへ追記します。
                  </p>
                  {activeSheetTabError && (
                    <p className="mt-1 text-xs text-red-600">{activeSheetTabError}</p>
                  )}
                </div>

                {residentSheetSelection === "residentSecondary" ? (
                  <div className="space-y-4">
                    {residentSecondaryEntries.length === 0 ? (
                      <div className="rounded border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500">
                        フォルダを読み込むと、ファイル数分の氏名入力欄を表示します。
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                        {residentSecondaryEntries.map((entry, index) => (
                          <div
                            key={entry.id}
                            className="rounded border border-gray-200 bg-gray-50 p-3"
                          >
                            <div className="text-xs text-gray-600">
                              ファイル名（B列）: {entry.fileName}
                            </div>
                            <label className="mt-2 block text-sm text-gray-700 mb-1">
                              氏名（C列） {index + 1}
                            </label>
                            <input
                              type="text"
                              value={entry.name}
                              onChange={(event) =>
                                handleResidentSecondaryNameChange(
                                  entry.id,
                                  event.target.value
                                )
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="氏名を入力"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                void handleResidentSecondaryOverwriteWrite(entry.id);
                              }}
                              disabled={
                                isResidentSheetSaving ||
                                isResidentFolderImporting ||
                                isResidentSecondaryEntryWriting ||
                                entry.name.trim().length === 0
                              }
                              className="mt-2 w-full px-3 py-2 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              <Table2 className="w-4 h-4" />
                              {residentSecondaryWritingEntryId === entry.id
                                ? "上書き中..."
                                : "上書き書き込み"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        自分の名前（B列）
                      </label>
                      <input
                        type="text"
                        name="residentSelfName"
                        value={
                          settings.isResidentSelfNameFixed
                            ? settings.fixedResidentSelfName
                            : residentFormData.residentSelfName
                        }
                        onChange={handleResidentChange}
                        disabled={settings.isResidentSelfNameFixed}
                        className={`w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          settings.isResidentSelfNameFixed
                            ? "bg-gray-100 text-gray-500"
                            : ""
                        }`}
                        placeholder="自分の名前を入力"
                      />
                    </div>

                {/* 2列レイアウト - 転出と本籍を並列表示 */}
                <div className="grid grid-cols-2 gap-6">
                  {/* 左列：転出 */}
                  <div className="space-y-4">
                    <div className="bg-blue-50 px-3 py-2 rounded">
                      <h3 className="text-sm font-semibold text-blue-700">転出</h3>
                    </div>
                    
                    {/* 転出地名 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        名前
                      </label>
                      <input
                        type="text"
                        name="departName"
                        value={residentFormData.departName}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出地名を入力"
                      />
                    </div>

                    {/* 転出都道府県 */}
                    <div
                      className="relative"
                      onFocusCapture={() => {
                        setResidentActiveSection("depart");
                        setIsPrefectureSuggestionVisible(true);
                        resetSuggestionFocus("prefecture");
                      }}
                      onBlurCapture={(e) =>
                        handleSuggestionAreaBlur(
                          e,
                          setIsPrefectureSuggestionVisible,
                          "prefecture"
                        )
                      }
                    >
                      <label className="block text-sm text-gray-700 mb-1.5">
                        都道府県
                      </label>
                      <input
                        type="text"
                        name="departPrefecture"
                        value={residentFormData.departPrefecture}
                        onChange={handleResidentChange}
                        onCompositionStart={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            depart: { ...prev.depart, prefecture: true },
                          }))
                        }
                        onCompositionEnd={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            depart: { ...prev.depart, prefecture: false },
                          }))
                        }
                        onKeyDown={(e) =>
                          handleSuggestionKeyDown(
                            e,
                            "prefecture",
                            isPrefectureSuggestionVisible &&
                              residentActiveSection === "depart",
                            prefectureSuggestions.length,
                            setIsPrefectureSuggestionVisible,
                            (index) =>
                              applyPrefectureSuggestion(
                                prefectureSuggestions[index],
                                "depart"
                              ),
                            setIsPrefectureSuggestionVisible
                          )
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出都道府県を入力"
                      />
                      {isPrefectureSuggestionVisible &&
                        residentActiveSection === "depart" &&
                        residentFormData.departPrefecture && (
                          <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                            {isKenAllLoading ? (
                              <div className="px-3 py-2 text-sm text-gray-600">
                                住所マスタを読み込み中です...
                              </div>
                            ) : kenAllLoadError ? (
                              <div className="px-3 py-2 text-sm text-red-600">
                                {kenAllLoadError}
                              </div>
                            ) : prefectureSuggestions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                該当する候補がありません
                              </div>
                            ) : (
                              <VirtualSuggestionList
                                count={prefectureSuggestions.length}
                                activeIndex={activeSuggestionIndex.prefecture}
                                getKey={(index) =>
                                  `depart-prefecture-suggestion-${prefectureSuggestions[index]}-${index}`
                                }
                                getLabel={(index) => prefectureSuggestions[index]}
                                onHover={(index) =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    prefecture: index,
                                  }))
                                }
                                onSelect={(index) =>
                                  applyPrefectureSuggestion(
                                    prefectureSuggestions[index],
                                    "depart"
                                  )
                                }
                              />
                            )}
                          </div>
                        )}
                    </div>

                    {/* 転出市町村 */}
                    <div
                      className="relative"
                      onFocusCapture={() => {
                        setResidentActiveSection("depart");
                        setIsCitySuggestionVisible(true);
                        resetSuggestionFocus("city");
                      }}
                      onBlurCapture={(e) =>
                        handleSuggestionAreaBlur(e, setIsCitySuggestionVisible, "city")
                      }
                    >
                      <label className="block text-sm text-gray-700 mb-1.5">
                        市区町村
                      </label>
                      <input
                        type="text"
                        name="departCity"
                        value={residentFormData.departCity}
                        onChange={handleResidentChange}
                        onCompositionStart={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            depart: { ...prev.depart, city: true },
                          }))
                        }
                        onCompositionEnd={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            depart: { ...prev.depart, city: false },
                          }))
                        }
                        onKeyDown={(e) =>
                          handleSuggestionKeyDown(
                            e,
                            "city",
                            isCitySuggestionVisible &&
                              residentActiveSection === "depart",
                            citySuggestions.length,
                            setIsCitySuggestionVisible,
                            (index) => applyCitySuggestion(citySuggestions[index], "depart"),
                            setIsCitySuggestionVisible
                          )
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出市町村を入力"
                      />
                      {isCitySuggestionVisible &&
                        residentActiveSection === "depart" &&
                        residentFormData.departCity && (
                          <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                            {isKenAllLoading ? (
                              <div className="px-3 py-2 text-sm text-gray-600">
                                住所マスタを読み込み中です...
                              </div>
                            ) : kenAllLoadError ? (
                              <div className="px-3 py-2 text-sm text-red-600">
                                {kenAllLoadError}
                              </div>
                            ) : citySuggestions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                該当する候補がありません
                              </div>
                            ) : (
                              <VirtualSuggestionList
                                count={citySuggestions.length}
                                activeIndex={activeSuggestionIndex.city}
                                getKey={(index) => {
                                  const suggestion = citySuggestions[index];
                                  return `depart-city-suggestion-${suggestion.prefecture}-${suggestion.city}-${index}`;
                                }}
                                getLabel={(index) => {
                                  const suggestion = citySuggestions[index];
                                  return joinWithFullWidthSpace([
                                    suggestion.prefecture,
                                    suggestion.city,
                                  ]);
                                }}
                                onHover={(index) =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    city: index,
                                  }))
                                }
                                onSelect={(index) =>
                                  applyCitySuggestion(citySuggestions[index], "depart")
                                }
                              />
                            )}
                          </div>
                        )}
                    </div>

                    {/* 転出町 */}
                    <div
                      className="relative"
                      onFocusCapture={() => {
                        setResidentActiveSection("depart");
                        setIsTownSuggestionVisible(true);
                        resetSuggestionFocus("town");
                      }}
                      onBlurCapture={(e) =>
                        handleSuggestionAreaBlur(e, setIsTownSuggestionVisible, "town")
                      }
                    >
                      <label className="block text-sm text-gray-700 mb-1.5">
                        町域
                      </label>
                      <input
                        type="text"
                        name="departTown"
                        value={residentFormData.departTown}
                        onChange={handleResidentChange}
                        onCompositionStart={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            depart: { ...prev.depart, town: true },
                          }))
                        }
                        onCompositionEnd={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            depart: { ...prev.depart, town: false },
                          }))
                        }
                        onKeyDown={(e) =>
                          handleSuggestionKeyDown(
                            e,
                            "town",
                            isTownSuggestionVisible &&
                              residentActiveSection === "depart",
                            townSuggestions.length,
                            setIsTownSuggestionVisible,
                            (index) =>
                              applyAddressSuggestion(townSuggestions[index], "depart"),
                            setIsTownSuggestionVisible
                          )
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出町を入力"
                      />
                      {isTownSuggestionVisible &&
                        residentActiveSection === "depart" &&
                        residentFormData.departTown && (
                          <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                            {isKenAllLoading ? (
                              <div className="px-3 py-2 text-sm text-gray-600">
                                住所マスタを読み込み中です...
                              </div>
                            ) : kenAllLoadError ? (
                              <div className="px-3 py-2 text-sm text-red-600">
                                {kenAllLoadError}
                              </div>
                            ) : townSuggestions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                該当する候補がありません
                              </div>
                            ) : (
                              <VirtualSuggestionList
                                count={townSuggestions.length}
                                activeIndex={activeSuggestionIndex.town}
                                getKey={(index) => {
                                  const suggestion = townSuggestions[index];
                                  return `depart-town-suggestion-${suggestion.postalCode}-${suggestion.prefecture}-${suggestion.city}-${suggestion.town}-${index}`;
                                }}
                                getLabel={(index) => {
                                  const suggestion = townSuggestions[index];
                                  return joinWithFullWidthSpace([
                                    suggestion.prefecture,
                                    suggestion.city,
                                    suggestion.town || "（町域なし）",
                                  ]);
                                }}
                                onHover={(index) =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    town: index,
                                  }))
                                }
                                onSelect={(index) =>
                                  applyAddressSuggestion(townSuggestions[index], "depart")
                                }
                              />
                            )}
                          </div>
                        )}
                    </div>

                    <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-emerald-900">
                          転出住所を Google Maps で埋め込み表示できます。
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            void handleOpenResidentAddressInGoogleMaps("depart");
                          }}
                          disabled={residentMapResolvingBySection.depart}
                          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed"
                        >
                          {residentMapResolvingBySection.depart ? "地図検索中..." : "地図表示"}
                        </button>
                      </div>
                      {residentMapSearchErrorBySection.depart && (
                        <p className="mt-2 text-xs text-red-600">
                          {residentMapSearchErrorBySection.depart}
                        </p>
                      )}
                      {residentMapEmbedUrlBySection.depart && (
                        <div className="mt-2 overflow-hidden rounded border border-emerald-200 bg-white">
                          <iframe
                            title="住民票モード転出住所の地図"
                            src={residentMapEmbedUrlBySection.depart}
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                            onLoad={() => {
                              setResidentMapLoadedBySection((prev) => ({
                                ...prev,
                                depart: true,
                              }));
                            }}
                            className="h-64 w-full border-0"
                          />
                        </div>
                      )}
                      {residentMapLoadedBySection.depart &&
                        residentMapDisplayedAddressBySection.depart && (
                          <p className="mt-2 text-[11px] text-emerald-900 break-all">
                            検索住所: {residentMapDisplayedAddressBySection.depart}
                          </p>
                        )}
                    </div>

                    <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-emerald-900">
                          本籍住所を Google Maps で埋め込み表示できます。
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            void handleOpenResidentAddressInGoogleMaps("registry");
                          }}
                          disabled={residentMapResolvingBySection.registry}
                          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed"
                        >
                          {residentMapResolvingBySection.registry
                            ? "地図検索中..."
                            : "地図表示"}
                        </button>
                      </div>
                      {residentMapSearchErrorBySection.registry && (
                        <p className="mt-2 text-xs text-red-600">
                          {residentMapSearchErrorBySection.registry}
                        </p>
                      )}
                      {residentMapEmbedUrlBySection.registry && (
                        <div className="mt-2 overflow-hidden rounded border border-emerald-200 bg-white">
                          <iframe
                            title="住民票モード本籍住所の地図"
                            src={residentMapEmbedUrlBySection.registry}
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                            onLoad={() => {
                              setResidentMapLoadedBySection((prev) => ({
                                ...prev,
                                registry: true,
                              }));
                            }}
                            className="h-64 w-full border-0"
                          />
                        </div>
                      )}
                      {residentMapLoadedBySection.registry &&
                        residentMapDisplayedAddressBySection.registry && (
                          <p className="mt-2 text-[11px] text-emerald-900 break-all">
                            検索住所: {residentMapDisplayedAddressBySection.registry}
                          </p>
                        )}
                    </div>

                    {settings.isAddressCheckEnabled && (
                      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-blue-900">
                              住所チェック（転出）
                            </p>
                            <p className="text-[11px] text-blue-700">
                              転出住所をブラウザ内推論で検証し、誤り候補があれば修正案を表示します。
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void handleResidentAddressCheck("depart");
                            }}
                            disabled={residentAddressCheckingBySection.depart}
                            className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                          >
                            {residentAddressCheckingBySection.depart
                              ? "住所判定中..."
                              : "住所チェック"}
                          </button>
                        </div>
                        {residentAddressCheckErrorBySection.depart && (
                          <p className="mt-2 text-xs text-red-600">
                            {residentAddressCheckErrorBySection.depart}
                          </p>
                        )}
                        {residentAddressCheckResultBySection.depart && (
                          <div className="mt-2 rounded border border-blue-100 bg-white px-2.5 py-2 text-xs text-gray-700 space-y-1">
                            <div>
                              判定:
                              <span
                                className={`ml-1 font-semibold ${
                                  residentAddressCheckResultBySection.depart.isValidAddress
                                    ? "text-emerald-700"
                                    : "text-amber-700"
                                }`}
                              >
                                {residentAddressCheckResultBySection.depart.isValidAddress
                                  ? "実在の可能性が高い"
                                  : "誤りの可能性あり"}
                              </span>
                            </div>
                            <div>理由: {residentAddressCheckResultBySection.depart.reason}</div>
                            <div>
                              信頼度:{" "}
                              {(
                                residentAddressCheckResultBySection.depart.confidence * 100
                              ).toFixed(0)}
                              %
                            </div>
                            <div>
                              参照候補件数:{" "}
                              {residentAddressCheckResultBySection.depart.referenceCandidateCount}
                              件
                            </div>
                            <div className="truncate">
                              判定対象: {residentAddressCheckResultBySection.depart.checkedAddress}
                            </div>
                            {hasDepartAddressCheckCorrection && (
                              <div className="pt-1">
                                <p>
                                  修正候補:
                                  {[
                                    residentAddressCheckResultBySection.depart.corrected?.prefecture,
                                    residentAddressCheckResultBySection.depart.corrected?.city,
                                    residentAddressCheckResultBySection.depart.corrected?.town,
                                  ]
                                    .filter(Boolean)
                                    .join("") || "（住所候補なし）"}
                                  {residentAddressCheckResultBySection.depart.corrected
                                    ?.postalCode
                                    ? ` / ${formatPostalCode(
                                        residentAddressCheckResultBySection.depart.corrected
                                          .postalCode
                                      )}`
                                    : ""}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleApplyResidentAddressCorrection("depart");
                                  }}
                                  className="mt-1 px-2.5 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                                >
                                  候補を適用
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 転出大字 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        大字
                      </label>
                      <input
                        type="text"
                        name="departOoaza"
                        value={residentFormData.departOoaza}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出大字を入力"
                      />
                    </div>

                    {/* 転出字 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        字
                      </label>
                      <input
                        type="text"
                        name="departAza"
                        value={residentFormData.departAza}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出字を入力"
                      />
                    </div>

                    {/* 転出小字 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        小字
                      </label>
                      <input
                        type="text"
                        name="departKoaza"
                        value={residentFormData.departKoaza}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出小字を入力"
                      />
                    </div>

                    {/* 転出番地 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        番地
                      </label>
                      <input
                        type="text"
                        name="departBanchi"
                        value={residentFormData.departBanchi}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出番地を入力"
                      />
                    </div>

                    {/* 転出建物名 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        建物名
                      </label>
                      <input
                        type="text"
                        name="departBuilding"
                        value={residentFormData.departBuilding}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出建物名を入力"
                      />
                    </div>
                  </div>

                  {/* 右列：本籍 */}
                  <div className="space-y-4">
                    <div className="bg-green-50 px-3 py-2 rounded">
                      <h3 className="text-sm font-semibold text-green-700">本籍</h3>
                    </div>
                    
                    {/* 本籍地名 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        名前
                      </label>
                      <input
                        type="text"
                        name="registryName"
                        value={residentFormData.registryName}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍地名を入力"
                      />
                    </div>

                    {/* 本籍都道府県 */}
                    <div
                      className="relative"
                      onFocusCapture={() => {
                        setResidentActiveSection("registry");
                        setIsPrefectureSuggestionVisible(true);
                        resetSuggestionFocus("prefecture");
                      }}
                      onBlurCapture={(e) =>
                        handleSuggestionAreaBlur(
                          e,
                          setIsPrefectureSuggestionVisible,
                          "prefecture"
                        )
                      }
                    >
                      <label className="block text-sm text-gray-700 mb-1.5">
                        都道府県
                      </label>
                      <input
                        type="text"
                        name="registryPrefecture"
                        value={residentFormData.registryPrefecture}
                        onChange={handleResidentChange}
                        onCompositionStart={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            registry: { ...prev.registry, prefecture: true },
                          }))
                        }
                        onCompositionEnd={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            registry: { ...prev.registry, prefecture: false },
                          }))
                        }
                        onKeyDown={(e) =>
                          handleSuggestionKeyDown(
                            e,
                            "prefecture",
                            isPrefectureSuggestionVisible &&
                              residentActiveSection === "registry",
                            prefectureSuggestions.length,
                            setIsPrefectureSuggestionVisible,
                            (index) =>
                              applyPrefectureSuggestion(
                                prefectureSuggestions[index],
                                "registry"
                              ),
                            setIsPrefectureSuggestionVisible
                          )
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍都道府県を入力"
                      />
                      {isPrefectureSuggestionVisible &&
                        residentActiveSection === "registry" &&
                        residentFormData.registryPrefecture && (
                          <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                            {isKenAllLoading ? (
                              <div className="px-3 py-2 text-sm text-gray-600">
                                住所マスタを読み込み中です...
                              </div>
                            ) : kenAllLoadError ? (
                              <div className="px-3 py-2 text-sm text-red-600">
                                {kenAllLoadError}
                              </div>
                            ) : prefectureSuggestions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                該当する候補がありません
                              </div>
                            ) : (
                              <VirtualSuggestionList
                                count={prefectureSuggestions.length}
                                activeIndex={activeSuggestionIndex.prefecture}
                                getKey={(index) =>
                                  `registry-prefecture-suggestion-${prefectureSuggestions[index]}-${index}`
                                }
                                getLabel={(index) => prefectureSuggestions[index]}
                                onHover={(index) =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    prefecture: index,
                                  }))
                                }
                                onSelect={(index) =>
                                  applyPrefectureSuggestion(
                                    prefectureSuggestions[index],
                                    "registry"
                                  )
                                }
                              />
                            )}
                          </div>
                        )}
                    </div>

                    {/* 本籍市町村 */}
                    <div
                      className="relative"
                      onFocusCapture={() => {
                        setResidentActiveSection("registry");
                        setIsCitySuggestionVisible(true);
                        resetSuggestionFocus("city");
                      }}
                      onBlurCapture={(e) =>
                        handleSuggestionAreaBlur(e, setIsCitySuggestionVisible, "city")
                      }
                    >
                      <label className="block text-sm text-gray-700 mb-1.5">
                        市区町村
                      </label>
                      <input
                        type="text"
                        name="registryCity"
                        value={residentFormData.registryCity}
                        onChange={handleResidentChange}
                        onCompositionStart={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            registry: { ...prev.registry, city: true },
                          }))
                        }
                        onCompositionEnd={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            registry: { ...prev.registry, city: false },
                          }))
                        }
                        onKeyDown={(e) =>
                          handleSuggestionKeyDown(
                            e,
                            "city",
                            isCitySuggestionVisible &&
                              residentActiveSection === "registry",
                            citySuggestions.length,
                            setIsCitySuggestionVisible,
                            (index) => applyCitySuggestion(citySuggestions[index], "registry"),
                            setIsCitySuggestionVisible
                          )
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍市町村を入力"
                      />
                      {isCitySuggestionVisible &&
                        residentActiveSection === "registry" &&
                        residentFormData.registryCity && (
                          <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                            {isKenAllLoading ? (
                              <div className="px-3 py-2 text-sm text-gray-600">
                                住所マスタを読み込み中です...
                              </div>
                            ) : kenAllLoadError ? (
                              <div className="px-3 py-2 text-sm text-red-600">
                                {kenAllLoadError}
                              </div>
                            ) : citySuggestions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                該当する候補がありません
                              </div>
                            ) : (
                              <VirtualSuggestionList
                                count={citySuggestions.length}
                                activeIndex={activeSuggestionIndex.city}
                                getKey={(index) => {
                                  const suggestion = citySuggestions[index];
                                  return `registry-city-suggestion-${suggestion.prefecture}-${suggestion.city}-${index}`;
                                }}
                                getLabel={(index) => {
                                  const suggestion = citySuggestions[index];
                                  return joinWithFullWidthSpace([
                                    suggestion.prefecture,
                                    suggestion.city,
                                  ]);
                                }}
                                onHover={(index) =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    city: index,
                                  }))
                                }
                                onSelect={(index) =>
                                  applyCitySuggestion(citySuggestions[index], "registry")
                                }
                              />
                            )}
                          </div>
                        )}
                    </div>

                    {/* 本籍町 */}
                    <div
                      className="relative"
                      onFocusCapture={() => {
                        setResidentActiveSection("registry");
                        setIsTownSuggestionVisible(true);
                        resetSuggestionFocus("town");
                      }}
                      onBlurCapture={(e) =>
                        handleSuggestionAreaBlur(e, setIsTownSuggestionVisible, "town")
                      }
                    >
                      <label className="block text-sm text-gray-700 mb-1.5">
                        町域
                      </label>
                      <input
                        type="text"
                        name="registryTown"
                        value={residentFormData.registryTown}
                        onChange={handleResidentChange}
                        onCompositionStart={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            registry: { ...prev.registry, town: true },
                          }))
                        }
                        onCompositionEnd={() =>
                          setResidentComposing((prev) => ({
                            ...prev,
                            registry: { ...prev.registry, town: false },
                          }))
                        }
                        onKeyDown={(e) =>
                          handleSuggestionKeyDown(
                            e,
                            "town",
                            isTownSuggestionVisible &&
                              residentActiveSection === "registry",
                            townSuggestions.length,
                            setIsTownSuggestionVisible,
                            (index) =>
                              applyAddressSuggestion(townSuggestions[index], "registry"),
                            setIsTownSuggestionVisible
                          )
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍町を入力"
                      />
                      {isTownSuggestionVisible &&
                        residentActiveSection === "registry" &&
                        residentFormData.registryTown && (
                          <div className="absolute z-30 mt-1 w-full bg-white border border-blue-200 rounded shadow-lg">
                            {isKenAllLoading ? (
                              <div className="px-3 py-2 text-sm text-gray-600">
                                住所マスタを読み込み中です...
                              </div>
                            ) : kenAllLoadError ? (
                              <div className="px-3 py-2 text-sm text-red-600">
                                {kenAllLoadError}
                              </div>
                            ) : townSuggestions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                該当する候補がありません
                              </div>
                            ) : (
                              <VirtualSuggestionList
                                count={townSuggestions.length}
                                activeIndex={activeSuggestionIndex.town}
                                getKey={(index) => {
                                  const suggestion = townSuggestions[index];
                                  return `registry-town-suggestion-${suggestion.postalCode}-${suggestion.prefecture}-${suggestion.city}-${suggestion.town}-${index}`;
                                }}
                                getLabel={(index) => {
                                  const suggestion = townSuggestions[index];
                                  return joinWithFullWidthSpace([
                                    suggestion.prefecture,
                                    suggestion.city,
                                    suggestion.town || "（町域なし）",
                                  ]);
                                }}
                                onHover={(index) =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    town: index,
                                  }))
                                }
                                onSelect={(index) =>
                                  applyAddressSuggestion(townSuggestions[index], "registry")
                                }
                              />
                            )}
                          </div>
                        )}
                    </div>

                    {settings.isAddressCheckEnabled && (
                      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-blue-900">
                              住所チェック（本籍）
                            </p>
                            <p className="text-[11px] text-blue-700">
                              本籍住所をブラウザ内推論で検証し、誤り候補があれば修正案を表示します。
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void handleResidentAddressCheck("registry");
                            }}
                            disabled={residentAddressCheckingBySection.registry}
                            className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                          >
                            {residentAddressCheckingBySection.registry
                              ? "住所判定中..."
                              : "住所チェック"}
                          </button>
                        </div>
                        {residentAddressCheckErrorBySection.registry && (
                          <p className="mt-2 text-xs text-red-600">
                            {residentAddressCheckErrorBySection.registry}
                          </p>
                        )}
                        {residentAddressCheckResultBySection.registry && (
                          <div className="mt-2 rounded border border-blue-100 bg-white px-2.5 py-2 text-xs text-gray-700 space-y-1">
                            <div>
                              判定:
                              <span
                                className={`ml-1 font-semibold ${
                                  residentAddressCheckResultBySection.registry.isValidAddress
                                    ? "text-emerald-700"
                                    : "text-amber-700"
                                }`}
                              >
                                {residentAddressCheckResultBySection.registry.isValidAddress
                                  ? "実在の可能性が高い"
                                  : "誤りの可能性あり"}
                              </span>
                            </div>
                            <div>
                              理由: {residentAddressCheckResultBySection.registry.reason}
                            </div>
                            <div>
                              信頼度:{" "}
                              {(
                                residentAddressCheckResultBySection.registry.confidence * 100
                              ).toFixed(0)}
                              %
                            </div>
                            <div>
                              参照候補件数:{" "}
                              {residentAddressCheckResultBySection.registry.referenceCandidateCount}
                              件
                            </div>
                            <div className="truncate">
                              判定対象:{" "}
                              {residentAddressCheckResultBySection.registry.checkedAddress}
                            </div>
                            {hasRegistryAddressCheckCorrection && (
                              <div className="pt-1">
                                <p>
                                  修正候補:
                                  {[
                                    residentAddressCheckResultBySection.registry.corrected
                                      ?.prefecture,
                                    residentAddressCheckResultBySection.registry.corrected?.city,
                                    residentAddressCheckResultBySection.registry.corrected?.town,
                                  ]
                                    .filter(Boolean)
                                    .join("") || "（住所候補なし）"}
                                  {residentAddressCheckResultBySection.registry.corrected
                                    ?.postalCode
                                    ? ` / ${formatPostalCode(
                                        residentAddressCheckResultBySection.registry.corrected
                                          .postalCode
                                      )}`
                                    : ""}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleApplyResidentAddressCorrection("registry");
                                  }}
                                  className="mt-1 px-2.5 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                                >
                                  候補を適用
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 本籍大字 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        大字
                      </label>
                      <input
                        type="text"
                        name="registryOoaza"
                        value={residentFormData.registryOoaza}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍大字を入力"
                      />
                    </div>

                    {/* 本籍字 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        字
                      </label>
                      <input
                        type="text"
                        name="registryAza"
                        value={residentFormData.registryAza}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍字を入力"
                      />
                    </div>

                    {/* 本籍小字 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        小字
                      </label>
                      <input
                        type="text"
                        name="registryKoaza"
                        value={residentFormData.registryKoaza}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍小字を入力"
                      />
                    </div>

                    {/* 本籍番地 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        番地
                      </label>
                      <input
                        type="text"
                        name="registryBanchi"
                        value={residentFormData.registryBanchi}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍番地を入力"
                      />
                    </div>

                    {/* 本籍建物名 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        建物名
                      </label>
                      <input
                        type="text"
                        name="registryBuilding"
                        value={residentFormData.registryBuilding}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍建物名を入力"
                      />
                    </div>

                    {/* 通称・別名 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        通称・別名
                      </label>
                      <input
                        type="text"
                        name="residentAlias"
                        value={residentFormData.residentAlias}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="通称・別名を入力"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        本籍の建物名から移動する場合は Shift+Enter を押してください。
                      </p>
                    </div>
                  </div>
                </div>
                  </div>
                )}

              <input
                ref={residentFolderInputRef}
                type="file"
                multiple
                onChange={handleResidentFolderImportChange}
                className="hidden"
              />

              {/* ボタン */}
              {residentSheetSelection === "residentSecondary" ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    onClick={handleResidentFolderImportClick}
                    disabled={
                      isResidentSheetSaving ||
                      isResidentFolderImporting ||
                      isResidentSecondaryEntryWriting ||
                      isResidentListEntryWriting
                    }
                    className="flex-1 px-4 py-2.5 bg-cyan-600 text-white rounded hover:bg-cyan-700 disabled:bg-cyan-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    {isResidentFolderImporting ? "読込中..." : "フォルダを読み込み"}
                  </button>
                  <button
                    onClick={handleResidentWriteToSheet}
                    disabled={
                      isResidentSheetSaving ||
                      isResidentFolderImporting ||
                      isResidentSecondaryEntryWriting ||
                      isResidentListEntryWriting ||
                      residentSecondaryNamedEntryCount === 0
                    }
                    className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Table2 className="w-4 h-4" />
                    {isResidentSheetSaving ? "書き込み中..." : "書き込み"}
                  </button>
                  <button
                    onClick={handleClear}
                    disabled={isResidentSecondaryEntryWriting || isResidentListEntryWriting}
                    className="px-6 py-2.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    クリア
                  </button>
                </div>
              ) : (
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    onClick={handleResidentSaveToList}
                    disabled={
                      isResidentSheetSaving ||
                      isResidentFolderImporting ||
                      isResidentListEntryWriting
                    }
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {editingResidentEntryId === null
                      ? "リストへ保存"
                      : "編集を上書き保存"}
                  </button>
                  <button
                    onClick={handleResidentWriteToSheet}
                    disabled={
                      isResidentSheetSaving ||
                      isResidentFolderImporting ||
                      isResidentListEntryWriting
                    }
                    className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Table2 className="w-4 h-4" />
                    {isResidentSheetSaving ? "書き込み中..." : "書き込み"}
                  </button>
                  <button
                    onClick={handleResidentFolderImportClick}
                    disabled={
                      residentSheetSelection !== "residentPrimary" ||
                      isResidentSheetSaving ||
                      isResidentFolderImporting ||
                      isResidentListEntryWriting
                    }
                    className="flex-1 px-4 py-2.5 bg-cyan-600 text-white rounded hover:bg-cyan-700 disabled:bg-cyan-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    {isResidentFolderImporting ? "読込中..." : "フォルダを読み込み"}
                  </button>
                  <button
                    onClick={handleClear}
                    disabled={isResidentListEntryWriting}
                    className="px-6 py-2.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    クリア
                  </button>
                  <button
                    onClick={handleCopyResidentEntries}
                    className="px-6 py-2.5 bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    コピー
                  </button>
                </div>
              )}
              {residentSheetSyncSuccess && (
                <p className="mt-2 text-sm text-green-700">{residentSheetSyncSuccess}</p>
              )}
              {residentSheetSyncError && (
                <p className="mt-2 text-sm text-red-600">{residentSheetSyncError}</p>
              )}

              {residentSheetSelection !== "residentSecondary" && (
                <div className="mt-8">
                  <h2 className="text-lg text-gray-900 mb-4">
                    保存済みリスト ({savedResidentEntries.length}件)
                  </h2>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {savedResidentEntries.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        保存されたデータはありません
                      </div>
                    ) : (
                      savedResidentEntries.map((entry, index) => (
                        <div
                          key={entry.id}
                          className="p-4 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="mb-3 text-xs text-gray-600">
                                自分の名前: {entry.residentSelfName || "—"}
                              </div>
                              <div className="mb-3 pb-3 border-b border-gray-200">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                    転出
                                  </span>
                                  <span className="text-sm font-medium text-gray-900">
                                    {entry.departName || "（氏名なし）"}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600 space-y-1">
                                  <div>
                                    {[
                                      entry.departPrefecture,
                                      entry.departCity,
                                      entry.departTown,
                                      entry.departOoaza,
                                      entry.departAza,
                                      entry.departKoaza,
                                      entry.departBanchi,
                                      entry.departBuilding,
                                    ].filter(Boolean).join(" ") || "—"}
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded">
                                    本籍
                                  </span>
                                  <span className="text-sm font-medium text-gray-900">
                                    {entry.registryName || "（氏名なし）"}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600 space-y-1">
                                  <div>
                                    {[
                                      entry.registryPrefecture,
                                      entry.registryCity,
                                      entry.registryTown,
                                      entry.registryOoaza,
                                      entry.registryAza,
                                      entry.registryKoaza,
                                      entry.registryBanchi,
                                      entry.registryBuilding,
                                    ].filter(Boolean).join(" ") || "—"}
                                  </div>
                                  <div>通称・別名: {entry.residentAlias || "—"}</div>
                                </div>
                              </div>
                            </div>
                            <div className="ml-3 flex items-center gap-1">
                              <button
                                onClick={() => handleMoveResidentEntry(entry.id, "up")}
                                disabled={
                                  index === 0 ||
                                  isResidentSheetSaving ||
                                  isResidentFolderImporting ||
                                  isResidentListEntryWriting
                                }
                                className="p-2 text-gray-400 hover:text-gray-700 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                                title="上へ移動"
                              >
                                <ChevronUp className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleMoveResidentEntry(entry.id, "down")}
                                disabled={
                                  index === savedResidentEntries.length - 1 ||
                                  isResidentSheetSaving ||
                                  isResidentFolderImporting ||
                                  isResidentListEntryWriting
                                }
                                className="p-2 text-gray-400 hover:text-gray-700 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                                title="下へ移動"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  void handleResidentListOverwriteWrite(entry);
                                }}
                                disabled={
                                  isResidentSheetSaving ||
                                  isResidentFolderImporting ||
                                  isResidentListEntryWriting
                                }
                                className="px-2 py-1 rounded border border-emerald-300 text-emerald-700 text-xs hover:bg-emerald-50 disabled:text-gray-400 disabled:border-gray-300 disabled:cursor-not-allowed"
                                title="上書き書き込み"
                              >
                                {residentListWritingEntryId === entry.id
                                  ? "上書き中..."
                                  : "上書き書き込み"}
                              </button>
                              <button
                                onClick={() => handleDeleteResidentEntry(entry.id)}
                                disabled={
                                  isResidentSheetSaving ||
                                  isResidentFolderImporting ||
                                  isResidentListEntryWriting
                                }
                                className="p-2 text-gray-400 hover:text-red-600 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                                title="削除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleEditResidentEntry(entry)}
                                disabled={
                                  isResidentSheetSaving ||
                                  isResidentFolderImporting ||
                                  isResidentListEntryWriting
                                }
                                className="p-2 text-gray-400 hover:text-blue-600 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                                title="編集"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 右側：PDFプレビュー / スプレッドシート / 漢字 */}
      <div className="w-1/2 bg-gray-100 flex flex-col">
        <div className="bg-white border-b border-gray-200">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2">
              {viewMode === "pdf" ? (
                <FileText className="w-5 h-5 text-gray-600" />
              ) : viewMode === "sheet" ? (
                <Table2 className="w-5 h-5 text-gray-600" />
              ) : (
                <FileUser className="w-5 h-5 text-gray-600" />
              )}
              <h2 className="text-lg text-gray-900">
                {viewMode === "pdf"
                  ? "PDFプレビュー"
                  : viewMode === "sheet"
                    ? "Googleスプレッドシート"
                    : "kanji.me"}
              </h2>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode("pdf")}
                className={`px-4 py-2 rounded flex items-center gap-2 transition-colors ${
                  viewMode === "pdf"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <FileText className="w-4 h-4" />
                PDF
              </button>
              <button
                onClick={() => setViewMode("sheet")}
                className={`px-4 py-2 rounded flex items-center gap-2 transition-colors ${
                  viewMode === "sheet"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <Table2 className="w-4 h-4" />
                シート
              </button>
              <button
                onClick={() => setViewMode("kanji")}
                className={`px-4 py-2 rounded flex items-center gap-2 transition-colors ${
                  viewMode === "kanji"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <FileUser className="w-4 h-4" />
                漢字
              </button>
            </div>
          </div>
          {viewMode === "sheet" && (
            <div className="px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500">
                  {sheetSelectionMessage}
                </span>
                {mode === "basic" && settings.isBasicSecondarySheetEnabled && (
                  <>
                    <button
                      type="button"
                      onClick={() => setBasicSheetSelection("basicPrimary")}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${
                        effectiveBasicSheetSelection === "basicPrimary"
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      基本シート1
                    </button>
                    <button
                      type="button"
                      onClick={() => setBasicSheetSelection("basicSecondary")}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${
                        effectiveBasicSheetSelection === "basicSecondary"
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      基本シート2
                    </button>
                  </>
                )}
                {mode === "resident" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setResidentSheetSelection("residentPrimary")}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${
                        residentSheetSelection === "residentPrimary"
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      住民票シート1
                    </button>
                    <button
                      type="button"
                      onClick={() => setResidentSheetSelection("residentSecondary")}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${
                        residentSheetSelection === "residentSecondary"
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      住民票シート2
                    </button>
                  </>
                )}
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-600 mb-1">
                  {mode === "resident" ? "表示/書き込み先シート" : "表示シート"}
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={activeSelectedSheetName}
                    onChange={(event) =>
                      handleActiveSheetTabSelectionChange(event.target.value)
                    }
                    disabled={isActiveSheetTabLoading || activeSheetTabs.length === 0}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">
                      {isActiveSheetTabLoading
                        ? "シートタブを取得中..."
                        : activeSheetTabs.length === 0
                          ? "シートタブを取得できません"
                          : "表示シートを選択"}
                    </option>
                    {activeSheetTabs.map((sheet) => (
                      <option
                        key={`${sheet.gid}-${sheet.name}`}
                        value={sheet.name}
                      >
                        {sheet.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleInitializeActiveSheet}
                    disabled={isInitializeButtonDisabled}
                    className="px-4 py-2 rounded bg-red-600 text-white text-sm hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed"
                  >
                    {isSheetInitializing ? "初期化中..." : "初期化"}
                  </button>
                </div>
                {mode === "resident" && (
                  <p className="mt-1 text-xs text-gray-500">
                    住民票書き込み時は、選択中のシートタブへ追記します。
                  </p>
                )}
                {activeSheetTabError && (
                  <p className="mt-1 text-xs text-red-600">{activeSheetTabError}</p>
                )}
                {sheetInitializeSuccess && (
                  <p className="mt-1 text-xs text-green-700">{sheetInitializeSuccess}</p>
                )}
                {sheetInitializeError && (
                  <p className="mt-1 text-xs text-red-600">{sheetInitializeError}</p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 p-4 overflow-hidden">
          <div className={`h-full ${viewMode === "pdf" ? "block" : "hidden"}`}>
            {/* PDFプレビュー */}
            <input
              ref={pdfUploadInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileUpload}
              className="hidden"
            />
            {pdfFile ? (
              <div className="w-full h-full flex flex-col gap-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleOpenPdfPicker}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    PDFを変更
                  </button>
                </div>
                <iframe
                  src={pdfFile}
                  className="w-full flex-1 border border-gray-300 rounded bg-white"
                  title="PDF Preview"
                />
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-white border-2 border-dashed border-gray-300 rounded">
                <div className="text-center mb-4">
                  <FileText className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-500 mb-2">PDFファイルをアップロードしてください</p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenPdfPicker}
                  className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 transition-colors"
                >
                  <Upload className="w-5 h-5" />
                  PDFをアップロード
                </button>
              </div>
            )}
          </div>

          <div className={`h-full ${viewMode === "sheet" ? "block" : "hidden"}`}>
            {/* Googleスプレッドシート表示 */}
            {sheetEmbedUrl ? (
              <iframe
                src={sheetEmbedUrl}
                className="w-full h-full border border-gray-300 rounded bg-white"
                title="Google Spreadsheet"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-white border-2 border-dashed border-gray-300 rounded">
                <div className="text-center">
                  <Table2 className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-500">
                    固定シートURLの読み込みに失敗しました
                  </p>
                  <p className="text-sm text-gray-400 mt-2">
                    ページを再読み込みして改善しない場合は設定を確認してください
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className={`h-full ${viewMode === "kanji" ? "block" : "hidden"}`}>
            {/* kanji.me 表示 */}
            <iframe
              src={KANJI_ME_EMBED_URL}
              className="w-full h-full border border-gray-300 rounded bg-white"
              title="kanji.me"
            />
          </div>
        </div>
      </div>

      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="設定"
            className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">設定</h2>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-2 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="設定を閉じる"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.isOperatorFixed}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    isOperatorFixed: e.target.checked,
                  }))
                }
              />
              入力者名を固定する
            </label>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                固定する入力者名
              </label>
              <input
                type="text"
                value={settings.fixedOperatorName}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    fixedOperatorName: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 田中 太郎"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.isFilenameFixed}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    isFilenameFixed: e.target.checked,
                  }))
                }
              />
              ファイル名を固定する
            </label>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                固定するファイル名
              </label>
              <input
                type="text"
                value={settings.fixedFilename}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    fixedFilename: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 001_A案件"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                シート書き込みフォントサイズ
              </label>
              <input
                type="number"
                min={MIN_SHEET_WRITE_FONT_SIZE}
                max={MAX_SHEET_WRITE_FONT_SIZE}
                step={1}
                value={settings.writeFontSize}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    writeFontSize: normalizeSheetWriteFontSize(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={`${DEFAULT_SHEET_WRITE_FONT_SIZE}`}
              />
              <p className="mt-1 text-[11px] text-gray-500">
                {MIN_SHEET_WRITE_FONT_SIZE}〜{MAX_SHEET_WRITE_FONT_SIZE}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.isAddressCheckEnabled}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    isAddressCheckEnabled: e.target.checked,
                  }))
                }
              />
              住所チェックを有効化する
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.isReloadStatePersistenceEnabled}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    isReloadStatePersistenceEnabled: e.target.checked,
                  }))
                }
              />
              リロード後も入力データとPDF表示を保持する
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.isResidentSelfNameFixed}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    isResidentSelfNameFixed: e.target.checked,
                  }))
                }
              />
              自分の名前を固定する
            </label>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                固定する自分の名前
              </label>
              <input
                type="text"
                value={settings.fixedResidentSelfName}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    fixedResidentSelfName: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 田中 花子"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.isBasicSecondarySheetEnabled}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    isBasicSecondarySheetEnabled: e.target.checked,
                  }))
                }
              />
              基本シート2を有効化する
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.isResidentSecondaryColumnBUppercase}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    isResidentSecondaryColumnBUppercase: e.target.checked,
                  }))
                }
              />
              住民票シート2のB列ファイル名を大文字化する
            </label>
            <details className="rounded border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-gray-700">
                シート/Webhook設定（詳細）
              </summary>
              <div className="mt-2 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSettings((prev) => ({
                          ...prev,
                          basicSheetWebhookUrl: DEFAULT_APP_SETTINGS.basicSheetWebhookUrl,
                          residentSheetWebhookUrl:
                            DEFAULT_APP_SETTINGS.residentSheetWebhookUrl,
                          writeFontSize: DEFAULT_APP_SETTINGS.writeFontSize,
                          basicSheetUrl: DEFAULT_APP_SETTINGS.basicSheetUrl,
                          basicSecondarySheetUrl:
                            DEFAULT_APP_SETTINGS.basicSecondarySheetUrl,
                          residentPrimarySheetUrl:
                            DEFAULT_APP_SETTINGS.residentPrimarySheetUrl,
                          residentSecondarySheetUrl:
                            DEFAULT_APP_SETTINGS.residentSecondarySheetUrl,
                          googleMapsEmbedApiKey:
                            DEFAULT_APP_SETTINGS.googleMapsEmbedApiKey,
                        }));
                        setSettingsEnvImportMessage(null);
                      }}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                    >
                      .envの値を読み込む
                    </button>
                    <button
                      type="button"
                      onClick={() => settingsEnvFileInputRef.current?.click()}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                    >
                      .envファイルを読み込む
                    </button>
                  </div>
                </div>
                <input
                  ref={settingsEnvFileInputRef}
                  type="file"
                  accept=".env,text/plain"
                  className="hidden"
                  onChange={handleImportSettingsFromEnvFile}
                />
                <p className="text-[11px] text-gray-500">
                  空欄にすると該当機能は実行できません。通常は .env の値を利用してください。
                </p>
                {settingsEnvImportMessage && (
                  <p
                    className={`text-[11px] ${
                      settingsEnvImportMessage.type === "success"
                        ? "text-green-700"
                        : "text-red-600"
                    }`}
                  >
                    {settingsEnvImportMessage.text}
                  </p>
                )}
                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">
                    基本モード Webhook URL
                  </label>
                  <input
                    type="text"
                    value={settings.basicSheetWebhookUrl}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        basicSheetWebhookUrl: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="VITE_BASIC_SHEET_WEBHOOK_URL"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">
                    住民票モード Webhook URL
                  </label>
                  <input
                    type="text"
                    value={settings.residentSheetWebhookUrl}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        residentSheetWebhookUrl: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="VITE_RESIDENT_SHEET_WEBHOOK_URL"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">
                    基本モード シートURL
                  </label>
                  <input
                    type="text"
                    value={settings.basicSheetUrl}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        basicSheetUrl: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="VITE_BASIC_SHEET_URL"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">
                    基本シート2 URL
                  </label>
                  <input
                    type="text"
                    value={settings.basicSecondarySheetUrl}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        basicSecondarySheetUrl: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="VITE_BASIC_SECONDARY_SHEET_URL"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">
                    住民票シート1 URL
                  </label>
                  <input
                    type="text"
                    value={settings.residentPrimarySheetUrl}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        residentPrimarySheetUrl: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="VITE_RESIDENT_PRIMARY_SHEET_URL"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">
                    住民票シート2 URL
                  </label>
                  <input
                    type="text"
                    value={settings.residentSecondarySheetUrl}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        residentSecondarySheetUrl: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="VITE_RESIDENT_SECONDARY_SHEET_URL"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">
                    Google Maps Embed APIキー
                  </label>
                  <input
                    type="password"
                    value={settings.googleMapsEmbedApiKey}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        googleMapsEmbedApiKey: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="VITE_GOOGLE_MAPS_EMBED_API_KEY"
                    autoComplete="off"
                  />
                </div>
              </div>
            </details>
            <p className="text-xs text-gray-500">
              電話番号は通常入力で携帯形式、Shiftキーを押して入力すると固定電話形式になります。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

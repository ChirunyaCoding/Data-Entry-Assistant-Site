import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  Save,
  Upload,
  FileText,
  User,
  Trash2,
  Table2,
  Link,
  FileUser,
  Copy,
  ChevronDown,
  Settings,
  X,
} from "lucide-react";
import { type KenAllAddress } from "../lib/kenAll";

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
}

interface SavedEntry extends FormData {
  id: number;
  savedAt: string;
}

interface SavedResidentEntry extends ResidentFormData {
  id: number;
  savedAt: string;
}

const FULL_WIDTH_SPACE = "　";
const SUGGESTION_ITEM_HEIGHT = 36;
const SUGGESTION_PANEL_MAX_HEIGHT = 288;
const SUGGESTION_OVERSCAN = 6;

const joinWithFullWidthSpace = (parts: string[]) => {
  return parts.filter(Boolean).join(FULL_WIDTH_SPACE);
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
const KANJI_ME_EMBED_URL = "https://kanji.me/";

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
const RESIDENT_FIELD_ORDER = [
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
] as const;
const RESIDENT_DETAIL_ADDRESS_FIELDS = new Set<string>([
  "departOoaza",
  "departAza",
  "departKoaza",
  "registryOoaza",
  "registryAza",
  "registryKoaza",
]);

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
}

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

const formatBanchiValue = (rawValue: string): string => {
  const normalized = rawValue.normalize("NFKC").trim();
  if (!normalized) {
    return "";
  }

  const numbers = normalized.match(/\d+/g);
  if (!numbers) {
    return normalized;
  }

  return numbers.map((part) => toFullWidthDigits(part)).join("ー");
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

const buildSheetEmbedUrl = (rawUrl: string): string => {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (parsedUrl.pathname.includes("/edit")) {
      parsedUrl.searchParams.set("rm", "minimal");
    }
    return parsedUrl.toString();
  } catch {
    if (!trimmedUrl.includes("/edit")) {
      return trimmedUrl;
    }
    if (trimmedUrl.includes("?")) {
      return trimmedUrl.includes("rm=")
        ? trimmedUrl
        : `${trimmedUrl}&rm=minimal`;
    }
    return trimmedUrl.replace("/edit", "/edit?rm=minimal");
  }
};

export function DataEntryForm() {
  const [mode, setMode] = useState<"basic" | "resident">("basic");
  const [showNotes, setShowNotes] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    isOperatorFixed: false,
    fixedOperatorName: "",
  });
  const [phoneInputMode, setPhoneInputMode] = useState<PhoneInputMode>("mobile");
  const [formData, setFormData] = useState<FormData>({
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
  });

  const [residentFormData, setResidentFormData] = useState<ResidentFormData>({
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
  });

  const [pdfFile, setPdfFile] = useState<string | null>(null);
  const [savedEntries, setSavedEntries] = useState<SavedEntry[]>([]);
  const [savedResidentEntries, setSavedResidentEntries] = useState<SavedResidentEntry[]>([]);
  const [viewMode, setViewMode] = useState<"pdf" | "sheet" | "kanji">("pdf");
  const [sheetUrl, setSheetUrl] = useState<string>("");
  const sheetEmbedUrl = buildSheetEmbedUrl(sheetUrl);
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
  const addressWorkerRef = useRef<Worker | null>(null);
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
      });
    } catch {
      // 設定の復元に失敗した場合は既定値を使う
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

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

    if (name === "banchi") {
      setFormData((prev) => ({
        ...prev,
        banchi: formatBanchiValue(value),
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
    const residentSection = getResidentSectionFromFieldName(currentName);
    if (residentSection) {
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
    if (!fieldName || !getResidentSectionFromFieldName(fieldName)) {
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
      setFormData((prev) => ({
        ...prev,
        postalCode: formatPostalCode(address.postalCode),
        prefecture: address.prefecture,
        city: address.city,
        town: sanitizeTownValue(address.town),
      }));
    } else {
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
      setFormData((prev) => ({
        ...prev,
        prefecture,
      }));
    } else {
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
      setFormData((prev) => ({
        ...prev,
        prefecture: address.prefecture,
        city: address.city,
      }));
    } else {
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

    setResidentFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      const url = URL.createObjectURL(file);
      setPdfFile(url);
    }
  };

  const handleSave = () => {
    const newEntry: SavedEntry = {
      ...formData,
      id: savedEntries.length + 1,
      savedAt: new Date().toISOString(),
    };
    setSavedEntries((prev) => [...prev, newEntry]);
    alert("データを保存しました");
  };

  const handleResidentSave = () => {
    const newEntry: SavedResidentEntry = {
      ...residentFormData,
      id: savedResidentEntries.length + 1,
      savedAt: new Date().toISOString(),
    };
    setSavedResidentEntries((prev) => [...prev, newEntry]);
    alert("データを保存しました");
  };

  const handleClear = () => {
    if (mode === "basic") {
      setFormData({
        operator: settings.isOperatorFixed ? settings.fixedOperatorName : "",
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
      });
      setPdfFile(null);
      setPhoneInputMode("mobile");
    } else {
      setResidentFormData({
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
      });
    }
  };

  const handleDeleteEntry = (id: number) => {
    setSavedEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const handleDeleteResidentEntry = (id: number) => {
    setSavedResidentEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const handleCopyBasicEntries = async () => {
    if (savedEntries.length === 0) {
      alert("コピーするデータがありません");
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
      alert(`${savedEntries.length}件のデータをコピーしました`);
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
        alert(`${savedEntries.length}件のデータをコピーしました`);
      } catch (fallbackErr) {
        alert("コピーに失敗しました");
        console.error(err, fallbackErr);
      }
    }
  };

  const handleCopyResidentEntries = async () => {
    if (savedResidentEntries.length === 0) {
      alert("コピーするデータがありません");
      return;
    }

    const tsvData = savedResidentEntries
      .map((entry) => {
        return [
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
        ].join("\t");
      })
      .join("\n");

    try {
      // Try modern Clipboard API first
      await navigator.clipboard.writeText(tsvData);
      alert(`${savedResidentEntries.length}件のデータをコピーしました`);
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
        alert(`${savedResidentEntries.length}件のデータをコピーしました`);
      } catch (fallbackErr) {
        alert("コピーに失敗しました");
        console.error(err, fallbackErr);
      }
    }
  };

  return (
    <div className="h-screen flex bg-gray-50">
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
                      value={formData.filename}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="ファイル名を入力"
                    />
                  </div>
                </div>

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
                  <label className="block text-sm text-gray-700 mb-1.5">
                    郵便番号
                  </label>
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
                    <label className="block text-sm text-gray-700 mb-1.5">
                      都道府県
                    </label>
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
                    <label className="block text-sm text-gray-700 mb-1.5">
                      市区町村
                    </label>
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
                    <label className="block text-sm text-gray-700 mb-1.5">
                      町域
                    </label>
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

                {/* 2列レイアウト - 会社名、肩書、氏名、電話番号 */}
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

              {/* ボタン */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleSave}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  保存
                </button>
                <button
                  onClick={handleClear}
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

              {/* 保存済みリスト */}
              <div className="mt-8">
                <h2 className="text-lg text-gray-900 mb-4">保存済みリスト ({savedEntries.length}件)</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {savedEntries.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      保存されたデータはありません
                    </div>
                  ) : (
                    savedEntries.map((entry) => (
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
                          <button
                            onClick={() => handleDeleteEntry(entry.id)}
                            className="ml-3 p-2 text-gray-400 hover:text-red-600 transition-colors"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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
                onKeyDown={handleResidentFormNavigation}
              >
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
                  </div>
                </div>
              </div>

              {/* ボタン */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleResidentSave}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  保存
                </button>
                <button
                  onClick={handleClear}
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

              {/* 保存済みリスト */}
              <div className="mt-8">
                <h2 className="text-lg text-gray-900 mb-4">保存済みリスト ({savedResidentEntries.length}件)</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {savedResidentEntries.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      保存されたデータはありません
                    </div>
                  ) : (
                    savedResidentEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-4 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            {/* 転出情報 */}
                            <div className="mb-3 pb-3 border-b border-gray-200">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">転出</span>
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
                                    entry.departBuilding
                                  ].filter(Boolean).join(" ") || "—"}
                                </div>
                              </div>
                            </div>
                            {/* 本籍情報 */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded">本籍</span>
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
                                    entry.registryBuilding
                                  ].filter(Boolean).join(" ") || "—"}
                                </div>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteResidentEntry(entry.id)}
                            className="ml-3 p-2 text-gray-400 hover:text-red-600 transition-colors"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
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
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="GoogleスプレッドシートのURLを入力..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                ※ スプレッドシートを「リンクを知っている全員」に共有設定してください
              </p>
            </div>
          )}
        </div>
        <div className="flex-1 p-4 overflow-hidden">
          <div className={`h-full ${viewMode === "pdf" ? "block" : "hidden"}`}>
            {/* PDFプレビュー */}
            {pdfFile ? (
              <iframe
                src={pdfFile}
                className="w-full h-full border border-gray-300 rounded bg-white"
                title="PDF Preview"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-white border-2 border-dashed border-gray-300 rounded">
                <div className="text-center mb-4">
                  <FileText className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-500 mb-2">PDFファイルをアップロードしてください</p>
                </div>
                <label className="px-6 py-3 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700 flex items-center gap-2 transition-colors">
                  <Upload className="w-5 h-5" />
                  PDFをアップロード
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
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
                  <p className="text-gray-500">GoogleスプレッドシートのURLを入力してください</p>
                  <p className="text-sm text-gray-400 mt-2">
                    上部の入力欄にスプレッドシートのURLを貼り付け
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
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl space-y-4"
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
            <p className="text-xs text-gray-500">
              電話番号は通常入力で携帯形式、Shiftキーを押して入力すると固定電話形式になります。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

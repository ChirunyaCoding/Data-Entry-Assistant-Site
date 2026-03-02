import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  type KenAllAddress,
  loadKenAllData,
} from "../lib/kenAll";
import {
  type PrefectureCandidate,
  findPrefectureSuggestions,
} from "../lib/prefectureSearch";
import { findCitySuggestions, findTownSuggestions } from "../lib/addressSuggestions";

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

const dedupeAddresses = (addresses: KenAllAddress[]) => {
  const seen = new Set<string>();
  const unique: KenAllAddress[] = [];

  for (const address of addresses) {
    const key = `${address.prefecture}|${address.city}|${address.town}|${address.postalCode}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(address);
  }

  return unique;
};

const FULL_WIDTH_SPACE = "　";

const joinWithFullWidthSpace = (parts: string[]) => {
  return parts.filter(Boolean).join(FULL_WIDTH_SPACE);
};

type SuggestionType = "postal" | "prefecture" | "city" | "town";

const INITIAL_ACTIVE_SUGGESTION_INDEX: Record<SuggestionType, number> = {
  postal: -1,
  prefecture: -1,
  city: -1,
  town: -1,
};

const APP_SETTINGS_STORAGE_KEY = "data-entry-tool.settings.v1";

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
  const [viewMode, setViewMode] = useState<"pdf" | "sheet">("pdf");
  const [sheetUrl, setSheetUrl] = useState<string>("");
  const [kenAllAddresses, setKenAllAddresses] = useState<KenAllAddress[]>([]);
  const [isKenAllLoading, setIsKenAllLoading] = useState(false);
  const [kenAllLoadError, setKenAllLoadError] = useState<string | null>(null);
  const [isPostalSuggestionVisible, setIsPostalSuggestionVisible] = useState(false);
  const [isPrefectureSuggestionVisible, setIsPrefectureSuggestionVisible] =
    useState(false);
  const [isCitySuggestionVisible, setIsCitySuggestionVisible] = useState(false);
  const [isTownSuggestionVisible, setIsTownSuggestionVisible] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<Record<
    SuggestionType,
    number
  >>(INITIAL_ACTIVE_SUGGESTION_INDEX);
  const [isPrefectureComposing, setIsPrefectureComposing] = useState(false);
  const [isCityComposing, setIsCityComposing] = useState(false);
  const [isTownComposing, setIsTownComposing] = useState(false);
  const basicFormRef = useRef<HTMLDivElement>(null);

  const prefectureCandidates = useMemo(() => {
    const uniquePrefectureCandidatesMap = new Map<string, PrefectureCandidate>();
    for (const address of kenAllAddresses) {
      if (uniquePrefectureCandidatesMap.has(address.prefecture)) {
        continue;
      }
      uniquePrefectureCandidatesMap.set(address.prefecture, {
        prefecture: address.prefecture,
        prefectureKana: address.prefectureKana,
        prefectureRomaji: address.prefectureRomaji,
      });
    }
    return Array.from(uniquePrefectureCandidatesMap.values());
  }, [kenAllAddresses]);

  useEffect(() => {
    let isCancelled = false;

    const fetchKenAll = async () => {
      setIsKenAllLoading(true);
      setKenAllLoadError(null);

      try {
        const loadedAddresses = await loadKenAllData();
        if (!isCancelled) {
          setKenAllAddresses(loadedAddresses);
        }
      } catch {
        if (!isCancelled) {
          setKenAllLoadError("住所マスタの読み込みに失敗しました");
        }
      } finally {
        if (!isCancelled) {
          setIsKenAllLoading(false);
        }
      }
    };

    fetchKenAll();

    return () => {
      isCancelled = true;
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

  // 市区町村入力中は市区町村候補を出す
  const citySuggestions = useMemo(() => {
    if (isCityComposing) {
      return [];
    }

    return findCitySuggestions(
      kenAllAddresses,
      {
        prefecture: formData.prefecture,
        city: formData.city,
        town: formData.town,
      }
    );
  }, [
    formData.prefecture,
    formData.city,
    formData.town,
    isCityComposing,
    kenAllAddresses,
  ]);

  // 町域入力中は町域候補を出す
  const townSuggestions = useMemo(() => {
    if (isTownComposing) {
      return [];
    }

    return findTownSuggestions(
      kenAllAddresses,
      {
        prefecture: formData.prefecture,
        city: formData.city,
        town: formData.town,
      }
    );
  }, [
    formData.prefecture,
    formData.city,
    formData.town,
    isTownComposing,
    kenAllAddresses,
  ]);

  // 都道府県のみ入力中は都道府県候補だけを出す
  const prefectureSuggestions = useMemo(() => {
    if (isPrefectureComposing) {
      return [];
    }

    const prefecture = formData.prefecture.trim();

    if (!prefecture) {
      return [];
    }

    return findPrefectureSuggestions(prefectureCandidates, prefecture);
  }, [
    formData.prefecture,
    isPrefectureComposing,
    prefectureCandidates,
  ]);

  // 郵便番号入力向けの候補
  const postalCodeSuggestions = useMemo(() => {
    const normalizedPostalCode = formData.postalCode.replace(/[^\d]/g, "");
    if (!normalizedPostalCode) {
      return [];
    }

    return dedupeAddresses(
      kenAllAddresses
        .filter((address) => address.postalCode.startsWith(normalizedPostalCode))
    );
  }, [formData.postalCode, kenAllAddresses]);

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

  const findNextFieldName = (
    currentName: string,
    direction: 1 | -1,
    includeDetailFields: boolean
  ): string | null => {
    const currentIndex = BASIC_FIELD_ORDER.indexOf(
      currentName as (typeof BASIC_FIELD_ORDER)[number]
    );

    if (currentIndex < 0) {
      return null;
    }

    let cursor = currentIndex;
    while (true) {
      cursor += direction;
      if (cursor < 0 || cursor >= BASIC_FIELD_ORDER.length) {
        return null;
      }

      const nextName = BASIC_FIELD_ORDER[cursor];
      if (!includeDetailFields && DETAIL_ADDRESS_FIELDS.has(nextName)) {
        continue;
      }

      return nextName;
    }
  };

  const focusByFieldName = (fieldName: string) => {
    const target = basicFormRef.current?.querySelector<
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
    const nextFieldName = findNextFieldName(fieldName, direction, e.shiftKey);
    if (!nextFieldName) {
      return;
    }

    if (focusByFieldName(nextFieldName)) {
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

  const applyAddressSuggestion = (address: KenAllAddress) => {
    setFormData((prev) => ({
      ...prev,
      postalCode: formatPostalCode(address.postalCode),
      prefecture: address.prefecture,
      city: address.city,
      town: sanitizeTownValue(address.town),
    }));
    setIsPostalSuggestionVisible(false);
    setIsPrefectureSuggestionVisible(false);
    setIsCitySuggestionVisible(false);
    setIsTownSuggestionVisible(false);
    setActiveSuggestionIndex(INITIAL_ACTIVE_SUGGESTION_INDEX);
  };

  const applyPrefectureSuggestion = (prefecture: string) => {
    setFormData((prev) => ({
      ...prev,
      prefecture,
    }));
    setIsPrefectureSuggestionVisible(false);
    resetSuggestionFocus("prefecture");
  };

  const applyCitySuggestion = (address: KenAllAddress) => {
    setFormData((prev) => ({
      ...prev,
      prefecture: address.prefecture,
      city: address.city,
    }));
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
    const isSuggestionShortcut = e.ctrlKey;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!isSuggestionShortcut) {
        return;
      }
      show(true);
      if (count === 0) {
        return;
      }
      e.preventDefault();
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
      if (!isSuggestionShortcut) {
        return;
      }
      if (!isVisible || count === 0) {
        return;
      }
      const index = activeSuggestionIndex[type];
      if (index < 0) {
        return;
      }
      if (index >= count) {
        return;
      }
      e.preventDefault();
      selectByIndex(index);
      hide(false);
      resetSuggestionFocus(type);
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
                        <div className="max-h-72 overflow-y-auto py-1">
                          {postalCodeSuggestions.map((suggestion, index) => (
                            <button
                              key={`postal-suggestion-${suggestion.postalCode}-${suggestion.prefecture}-${suggestion.city}-${suggestion.town}-${index}`}
                              type="button"
                              onClick={() => applyAddressSuggestion(suggestion)}
                              onMouseEnter={() =>
                                setActiveSuggestionIndex((prev) => ({
                                  ...prev,
                                  postal: index,
                                }))
                              }
                              className={`w-full text-left px-3 py-2 transition-colors text-sm text-gray-700 ${
                                activeSuggestionIndex.postal === index
                                  ? "bg-blue-100"
                                  : "hover:bg-blue-50"
                              }`}
                            >
                              {joinWithFullWidthSpace([
                                suggestion.postalCode,
                                suggestion.prefecture,
                                suggestion.city,
                                suggestion.town || "（町域なし）",
                              ])}
                            </button>
                          ))}
                        </div>
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
                          <div className="max-h-72 overflow-y-auto py-1">
                            {prefectureSuggestions.map((suggestion, index) => (
                              <button
                                key={`prefecture-suggestion-${suggestion}-${index}`}
                                type="button"
                                onClick={() => applyPrefectureSuggestion(suggestion)}
                                onMouseEnter={() =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    prefecture: index,
                                  }))
                                }
                                className={`w-full text-left px-3 py-2 transition-colors text-sm text-gray-700 ${
                                  activeSuggestionIndex.prefecture === index
                                    ? "bg-blue-100"
                                    : "hover:bg-blue-50"
                                }`}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
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
                          <div className="max-h-72 overflow-y-auto py-1">
                            {citySuggestions.map((suggestion, index) => (
                              <button
                                key={`city-suggestion-${suggestion.prefecture}-${suggestion.city}-${index}`}
                                type="button"
                                onClick={() => applyCitySuggestion(suggestion)}
                                onMouseEnter={() =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    city: index,
                                  }))
                                }
                                className={`w-full text-left px-3 py-2 transition-colors text-sm text-gray-700 ${
                                  activeSuggestionIndex.city === index
                                    ? "bg-blue-100"
                                    : "hover:bg-blue-50"
                                }`}
                              >
                                {joinWithFullWidthSpace([
                                  suggestion.prefecture,
                                  suggestion.city,
                                ])}
                              </button>
                            ))}
                          </div>
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
                          <div className="max-h-72 overflow-y-auto py-1">
                            {townSuggestions.map((suggestion, index) => (
                              <button
                                key={`town-suggestion-${suggestion.postalCode}-${suggestion.prefecture}-${suggestion.city}-${suggestion.town}-${index}`}
                                type="button"
                                onClick={() => applyAddressSuggestion(suggestion)}
                                onMouseEnter={() =>
                                  setActiveSuggestionIndex((prev) => ({
                                    ...prev,
                                    town: index,
                                  }))
                                }
                                className={`w-full text-left px-3 py-2 transition-colors text-sm text-gray-700 ${
                                  activeSuggestionIndex.town === index
                                    ? "bg-blue-100"
                                    : "hover:bg-blue-50"
                                }`}
                              >
                                {joinWithFullWidthSpace([
                                  suggestion.prefecture,
                                  suggestion.city,
                                  suggestion.town || "（町域なし）",
                                ])}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  補完候補をキーボードで選ぶ場合は Ctrl+↓/Ctrl+↑/Ctrl+Enter を使用します。
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
              <div className="space-y-4">
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
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        都道府県
                      </label>
                      <input
                        type="text"
                        name="departPrefecture"
                        value={residentFormData.departPrefecture}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出都道府県を入力"
                      />
                    </div>

                    {/* 転出市町村 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        市区町村
                      </label>
                      <input
                        type="text"
                        name="departCity"
                        value={residentFormData.departCity}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出市町村を入力"
                      />
                    </div>

                    {/* 住所補完表示エリア（転出） */}
                    {(residentFormData.departPrefecture || residentFormData.departCity) && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2">
                        <div className="text-xs text-blue-700 mb-1">住所補完候補</div>
                        <div className="text-xs text-gray-700">
                          <span className="text-gray-400 italic">補完機能は未実装です</span>
                        </div>
                      </div>
                    )}

                    {/* 転出町 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        町域
                      </label>
                      <input
                        type="text"
                        name="departTown"
                        value={residentFormData.departTown}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="転出町を入力"
                      />
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
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        都道府県
                      </label>
                      <input
                        type="text"
                        name="registryPrefecture"
                        value={residentFormData.registryPrefecture}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍都道府県を入力"
                      />
                    </div>

                    {/* 本籍市町村 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        市区町村
                      </label>
                      <input
                        type="text"
                        name="registryCity"
                        value={residentFormData.registryCity}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍市町村を入力"
                      />
                    </div>

                    {/* 住所補完表示エリア（本籍） */}
                    {(residentFormData.registryPrefecture || residentFormData.registryCity) && (
                      <div className="bg-green-50 border border-green-200 rounded p-2">
                        <div className="text-xs text-green-700 mb-1">住所補完候補</div>
                        <div className="text-xs text-gray-700">
                          <span className="text-gray-400 italic">補完機能は未実装です</span>
                        </div>
                      </div>
                    )}

                    {/* 本籍町 */}
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        町域
                      </label>
                      <input
                        type="text"
                        name="registryTown"
                        value={residentFormData.registryTown}
                        onChange={handleResidentChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="本籍町を入力"
                      />
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

      {/* 右側：PDFプレビュー / スプレッドシート */}
      <div className="w-1/2 bg-gray-100 flex flex-col">
        <div className="bg-white border-b border-gray-200">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2">
              {viewMode === "pdf" ? (
                <FileText className="w-5 h-5 text-gray-600" />
              ) : (
                <Table2 className="w-5 h-5 text-gray-600" />
              )}
              <h2 className="text-lg text-gray-900">
                {viewMode === "pdf" ? "PDFプレビュー" : "Googleスプレッドシート"}
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
          {viewMode === "pdf" ? (
            // PDFプレビュー
            pdfFile ? (
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
            )
          ) : (
            // Googleスプレッドシート表示
            sheetUrl ? (
              <iframe
                src={sheetUrl.includes('/edit') 
                  ? sheetUrl.replace('/edit', '/edit?rm=minimal') 
                  : sheetUrl}
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
            )
          )}
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

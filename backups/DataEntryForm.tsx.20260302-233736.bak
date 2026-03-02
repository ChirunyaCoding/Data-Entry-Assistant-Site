import { useEffect, useMemo, useState } from "react";
import { Save, Upload, FileText, User, Trash2, Table2, Link, FileUser, Copy, ChevronDown } from "lucide-react";
import {
  type KenAllAddress,
  loadKenAllData,
  searchKenAllAddresses,
} from "../lib/kenAll";

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

export function DataEntryForm() {
  const [mode, setMode] = useState<"basic" | "resident">("basic");
  const [showNotes, setShowNotes] = useState(false);
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

  // 基本モード（都道府県・市区町村・町域）入力向けの候補
  const addressSuggestions = useMemo(() => {
    return dedupeAddresses(
      searchKenAllAddresses(
        kenAllAddresses,
        {
          prefecture: formData.prefecture,
          city: formData.city,
          town: formData.town,
        },
        10
      )
    );
  }, [formData.prefecture, formData.city, formData.town, kenAllAddresses]);

  // 郵便番号入力向けの候補
  const postalCodeSuggestions = useMemo(() => {
    const normalizedPostalCode = formData.postalCode.replace(/[^\d]/g, "");
    if (!normalizedPostalCode) {
      return [];
    }

    return dedupeAddresses(
      kenAllAddresses
        .filter((address) => address.postalCode.startsWith(normalizedPostalCode))
        .slice(0, 10)
    );
  }, [formData.postalCode, kenAllAddresses]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const applyAddressSuggestion = (address: KenAllAddress) => {
    setFormData((prev) => ({
      ...prev,
      postalCode: address.postalCode,
      prefecture: address.prefecture,
      city: address.city,
      town: address.town,
    }));
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
      setPdfFile(null);
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
          <div className="mb-6 flex items-center gap-3">
            <User className="w-8 h-8 text-blue-600" />
            <h1 className="text-2xl text-gray-900">データ入力補助ツール</h1>
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
              <div className="space-y-4">
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
                      value={formData.operator}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <div>
                  <label className="block text-sm text-gray-700 mb-1.5">
                    郵便番号
                  </label>
                  <input
                    type="text"
                    name="postalCode"
                    value={formData.postalCode}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="000-0000"
                  />
                </div>

                {/* 住所補完表示エリア（郵便番号） */}
                {formData.postalCode && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                    <div className="text-xs text-blue-700 mb-1">住所補完候補</div>
                    {isKenAllLoading ? (
                      <div className="text-sm text-gray-600">住所マスタを読み込み中です...</div>
                    ) : kenAllLoadError ? (
                      <div className="text-sm text-red-600">{kenAllLoadError}</div>
                    ) : postalCodeSuggestions.length === 0 ? (
                      <div className="text-sm text-gray-500">該当する候補がありません</div>
                    ) : (
                      <div className="space-y-1">
                        {postalCodeSuggestions.map((suggestion, index) => (
                          <button
                            key={`postal-suggestion-${suggestion.postalCode}-${suggestion.prefecture}-${suggestion.city}-${suggestion.town}-${index}`}
                            type="button"
                            onClick={() => applyAddressSuggestion(suggestion)}
                            className="w-full text-left px-2 py-1.5 rounded hover:bg-blue-100 transition-colors text-sm text-gray-700"
                          >
                            <span className="font-mono text-xs text-gray-500 mr-2">
                              {suggestion.postalCode}
                            </span>
                            {suggestion.prefecture}
                            {suggestion.city}
                            {suggestion.town || "（町域なし）"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3列レイアウト - 都道府県、市区町村、町域 */}
                <div className="grid grid-cols-3 gap-4">
                  {/* 都道府県 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      都道府県
                    </label>
                    <input
                      type="text"
                      name="prefecture"
                      value={formData.prefecture}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="都道府県を入力"
                    />
                  </div>

                  {/* 市区町村 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      市区町村
                    </label>
                    <input
                      type="text"
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="市区町村を入力"
                    />
                  </div>

                  {/* 町域 */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">
                      町域
                    </label>
                    <input
                      type="text"
                      name="town"
                      value={formData.town}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="町域を入力"
                    />
                  </div>
                </div>

                {/* 住所補完表示エリア（都道府県・市区町村・町域） */}
                {(formData.prefecture || formData.city || formData.town) && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                    <div className="text-xs text-blue-700 mb-1">住所補完候補</div>
                    {isKenAllLoading ? (
                      <div className="text-sm text-gray-600">住所マスタを読み込み中です...</div>
                    ) : kenAllLoadError ? (
                      <div className="text-sm text-red-600">{kenAllLoadError}</div>
                    ) : addressSuggestions.length === 0 ? (
                      <div className="text-sm text-gray-500">該当する候補がありません</div>
                    ) : (
                      <div className="space-y-1">
                        {addressSuggestions.map((suggestion, index) => (
                          <button
                            key={`address-suggestion-${suggestion.postalCode}-${suggestion.prefecture}-${suggestion.city}-${suggestion.town}-${index}`}
                            type="button"
                            onClick={() => applyAddressSuggestion(suggestion)}
                            className="w-full text-left px-2 py-1.5 rounded hover:bg-blue-100 transition-colors text-sm text-gray-700"
                          >
                            <span className="font-mono text-xs text-gray-500 mr-2">
                              {suggestion.postalCode}
                            </span>
                            {suggestion.prefecture}
                            {suggestion.city}
                            {suggestion.town || "（町域なし）"}
                          </button>
                        ))}
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
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="000-0000-0000"
                    />
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
    </div>
  );
}

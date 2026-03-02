const HIRAGANA_TO_ROMAJI_DIGRAPH: Record<string, string> = {
  "きゃ": "kya",
  "きゅ": "kyu",
  "きょ": "kyo",
  "しゃ": "sha",
  "しゅ": "shu",
  "しょ": "sho",
  "ちゃ": "cha",
  "ちゅ": "chu",
  "ちょ": "cho",
  "にゃ": "nya",
  "にゅ": "nyu",
  "にょ": "nyo",
  "ひゃ": "hya",
  "ひゅ": "hyu",
  "ひょ": "hyo",
  "みゃ": "mya",
  "みゅ": "myu",
  "みょ": "myo",
  "りゃ": "rya",
  "りゅ": "ryu",
  "りょ": "ryo",
  "ぎゃ": "gya",
  "ぎゅ": "gyu",
  "ぎょ": "gyo",
  "じゃ": "ja",
  "じゅ": "ju",
  "じょ": "jo",
  "びゃ": "bya",
  "びゅ": "byu",
  "びょ": "byo",
  "ぴゃ": "pya",
  "ぴゅ": "pyu",
  "ぴょ": "pyo",
};

const HIRAGANA_TO_ROMAJI: Record<string, string> = {
  あ: "a",
  い: "i",
  う: "u",
  え: "e",
  お: "o",
  か: "ka",
  き: "ki",
  く: "ku",
  け: "ke",
  こ: "ko",
  さ: "sa",
  し: "shi",
  す: "su",
  せ: "se",
  そ: "so",
  た: "ta",
  ち: "chi",
  つ: "tsu",
  て: "te",
  と: "to",
  な: "na",
  に: "ni",
  ぬ: "nu",
  ね: "ne",
  の: "no",
  は: "ha",
  ひ: "hi",
  ふ: "fu",
  へ: "he",
  ほ: "ho",
  ま: "ma",
  み: "mi",
  む: "mu",
  め: "me",
  も: "mo",
  や: "ya",
  ゆ: "yu",
  よ: "yo",
  ら: "ra",
  り: "ri",
  る: "ru",
  れ: "re",
  ろ: "ro",
  わ: "wa",
  を: "wo",
  ん: "n",
  が: "ga",
  ぎ: "gi",
  ぐ: "gu",
  げ: "ge",
  ご: "go",
  ざ: "za",
  じ: "ji",
  ず: "zu",
  ぜ: "ze",
  ぞ: "zo",
  だ: "da",
  ぢ: "ji",
  づ: "zu",
  で: "de",
  ど: "do",
  ば: "ba",
  び: "bi",
  ぶ: "bu",
  べ: "be",
  ぼ: "bo",
  ぱ: "pa",
  ぴ: "pi",
  ぷ: "pu",
  ぺ: "pe",
  ぽ: "po",
  ぁ: "a",
  ぃ: "i",
  ぅ: "u",
  ぇ: "e",
  ぉ: "o",
  ゔ: "vu",
};

const ROMAJI_CACHE = new Map<string, string>();

export const normalizeAscii = (value: string): string => {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z]/g, "");
};

export const toKatakana = (value: string): string => {
  return value
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) + 0x60)
    );
};

const toHiragana = (value: string): string => {
  return value
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0x60)
    );
};

const lastVowel = (value: string): string => {
  const match = value.match(/[aeiou](?!.*[aeiou])/);
  return match ? match[0] : "";
};

export const kanaToRomaji = (value: string): string => {
  if (ROMAJI_CACHE.has(value)) {
    return ROMAJI_CACHE.get(value) ?? "";
  }

  const hira = toHiragana(value).replace(/[^ぁ-ゖー]/g, "");
  let result = "";
  let sokuon = false;

  for (let i = 0; i < hira.length; i += 1) {
    const char = hira[i];
    if (char === "っ") {
      sokuon = true;
      continue;
    }

    if (char === "ー") {
      const vowel = lastVowel(result);
      if (vowel) {
        result += vowel;
      }
      continue;
    }

    const digraph = hira.slice(i, i + 2);
    let romaji = HIRAGANA_TO_ROMAJI_DIGRAPH[digraph];
    if (romaji) {
      i += 1;
    } else {
      romaji = HIRAGANA_TO_ROMAJI[char] ?? "";
    }

    if (!romaji) {
      continue;
    }

    if (sokuon && /^[bcdfghjklmnpqrstvwxyz]/.test(romaji)) {
      result += romaji[0];
    }
    sokuon = false;
    result += romaji;
  }

  ROMAJI_CACHE.set(value, result);
  return result;
};

export interface MatchQueryTokens {
  raw: string;
  kana: string;
  romaji: string;
}

export const buildQueryTokens = (rawQuery: string): MatchQueryTokens => {
  const raw = rawQuery.trim();
  const kana = toKatakana(raw).replace(/[^ァ-ヶー]/g, "");
  const ascii = normalizeAscii(raw);
  const romaji = ascii || kanaToRomaji(kana);

  return {
    raw,
    kana,
    romaji,
  };
};

export const matchesWithTokens = (
  target: { kanji?: string; kana?: string; romaji?: string },
  tokens: MatchQueryTokens
): boolean => {
  if (!tokens.raw) {
    return false;
  }

  if (target.kanji && target.kanji.includes(tokens.raw)) {
    return true;
  }

  if (tokens.kana && target.kana && toKatakana(target.kana).includes(tokens.kana)) {
    return true;
  }

  if (!tokens.romaji) {
    return false;
  }

  const romajiTarget = normalizeAscii(target.romaji ?? "");
  if (!romajiTarget) {
    return false;
  }

  return (
    romajiTarget.startsWith(tokens.romaji) ||
    (tokens.romaji.length >= 2 && romajiTarget.includes(tokens.romaji))
  );
};

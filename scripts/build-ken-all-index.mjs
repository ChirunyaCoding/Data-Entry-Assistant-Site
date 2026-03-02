import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const sourcePath = path.resolve(projectRoot, "KEN_ALL.CSV");
const outputDir = path.resolve(projectRoot, "public");
const outputPath = path.resolve(outputDir, "ken_all_index.json");

const HIRAGANA_TO_ROMAJI_DIGRAPH = {
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

const HIRAGANA_TO_ROMAJI = {
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

const toKatakana = (value) => {
  return value
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) + 0x60)
    );
};

const toHiragana = (value) => {
  return value
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0x60)
    );
};

const lastVowel = (value) => {
  const match = value.match(/[aeiou](?!.*[aeiou])/);
  return match ? match[0] : "";
};

const kanaToRomaji = (value) => {
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

  return result;
};

const decodeKenAll = (buffer) => {
  const encodings = ["shift-jis", "windows-31j", "utf-8"];
  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      // next encoding
    }
  }
  throw new Error("KEN_ALL.CSV の文字コード判定に失敗しました");
};

const unquote = (value) => value.replace(/^"|"$/g, "").trim();

const parseLine = (line) => {
  const columns = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (columns.length < 9) {
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

  return [
    postalCode,
    prefecture,
    prefectureKana,
    kanaToRomaji(prefectureKana),
    city,
    cityKana,
    kanaToRomaji(cityKana),
    town,
    townKana,
    kanaToRomaji(townKana),
  ];
};

const needsRebuild = async () => {
  try {
    const [sourceStat, outputStat, scriptStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(outputPath),
      fs.stat(__filename),
    ]);
    return (
      sourceStat.mtimeMs > outputStat.mtimeMs ||
      scriptStat.mtimeMs > outputStat.mtimeMs
    );
  } catch {
    return true;
  }
};

const run = async () => {
  if (!(await needsRebuild())) {
    console.log("ken_all_index.json is up to date");
    return;
  }

  const csvBuffer = await fs.readFile(sourcePath);
  const csvText = decodeKenAll(csvBuffer.buffer.slice(csvBuffer.byteOffset, csvBuffer.byteOffset + csvBuffer.byteLength));
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);

  const records = [];
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseLine(lines[i]);
    if (parsed) {
      records.push(parsed);
    }
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(records));
  console.log(`generated ${outputPath} (${records.length} records)`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

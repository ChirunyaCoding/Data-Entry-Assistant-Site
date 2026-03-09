import assert from "node:assert/strict";

const SHIFTED_NUMBER_TO_DIGIT_MAP = {
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

const toFullWidthDigits = (rawValue) => {
  return rawValue.replace(/[0-9]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0xfee0)
  );
};

const toHalfWidthDigits = (rawValue) => {
  return rawValue.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
};

const toFullWidthAlphabet = (rawValue) => {
  return rawValue.replace(/[A-Za-z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0xfee0)
  );
};

const toHalfWidthAlphabet = (rawValue) => {
  return rawValue.replace(/[Ａ-Ｚａ-ｚ]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
};

const formatBanchiValue = (rawValue, options) => {
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
    /[-‐‑‒–—―ｰー]/g,
    options?.halfWidthHyphen ? "-" : "－"
  );
};

const normalizeBanchiValueAsHalfWidth = (rawValue) => {
  return formatBanchiValue(rawValue, {
    halfWidthAlphaNumeric: true,
    halfWidthHyphen: true,
  });
};

const cases = [
  {
    name: "全角数字の番地は半角化される",
    input: "１丁目７番１号",
    expected: "1丁目7番1号",
  },
  {
    name: "全角英字と全角ハイフンは半角化される",
    input: "Ａ－１２",
    expected: "A-12",
  },
  {
    name: "IMEの長音記号ーも半角ハイフンへ正規化される（回帰）",
    input: "１ー２",
    expected: "1-2",
  },
  {
    name: "空白だけの入力は空文字になる（異常系）",
    input: "  　",
    expected: "",
  },
];

for (const testCase of cases) {
  const actual = normalizeBanchiValueAsHalfWidth(testCase.input);
  assert.equal(actual, testCase.expected, testCase.name);
}

console.log("banchi halfwidth regression: ok");

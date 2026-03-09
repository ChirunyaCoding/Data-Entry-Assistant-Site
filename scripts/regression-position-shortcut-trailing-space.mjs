import assert from "node:assert/strict";

const POSITION_SHORTCUT_MAP = {
  da: "代表取締役",
  だ: "代表取締役",
};

const expandPositionShortcut = (rawValue) => {
  const key = rawValue.normalize("NFKC").trim().toLowerCase();
  if (!key) {
    return rawValue;
  }
  const expanded = POSITION_SHORTCUT_MAP[key];
  if (!expanded) {
    return rawValue;
  }
  return expanded.replace(/[ 　]+$/g, "");
};

const cases = [
  {
    name: "daショートカットは代表取締役になり末尾空白がない（回帰）",
    input: "da",
    expected: "代表取締役",
  },
  {
    name: "かなショートカットも代表取締役になり末尾空白がない（正常系）",
    input: "だ",
    expected: "代表取締役",
  },
  {
    name: "未定義ショートカットは原文維持（異常系）",
    input: "xx",
    expected: "xx",
  },
];

for (const testCase of cases) {
  const actual = expandPositionShortcut(testCase.input);
  assert.equal(actual, testCase.expected, testCase.name);
  assert.equal(/[ 　]$/.test(actual), false, `${testCase.name}: 末尾空白なし`);
}

console.log("position shortcut trailing-space regression: ok");

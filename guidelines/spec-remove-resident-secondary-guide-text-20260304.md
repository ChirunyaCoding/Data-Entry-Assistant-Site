# 住民票シート2 ガイド文言非表示仕様（2026-03-04）

## 対象
- `src/app/components/DataEntryForm.tsx`
- `guidelines/spec-remove-resident-secondary-guide-text-20260304.md`
- `package.json`
- `package-lock.json`

## スコープ
- 住民票シート2選択時に表示しているガイド文言を非表示にする。

## 制約
- 住民票シート2の入力欄生成・書き込みロジックは変更しない。

## 受け入れ条件
- 住民票シート2モードの説明文が表示されない。
- `npm run build` が成功する。

## 非対象
- 住民票シート1や基本モードのUI変更

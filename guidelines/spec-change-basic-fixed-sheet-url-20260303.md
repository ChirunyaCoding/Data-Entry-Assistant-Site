# 基本モード固定シートURL変更仕様（2026-03-03）

## 対象
- `src/app/components/DataEntryForm.tsx`
- `guidelines/spec-change-basic-fixed-sheet-url-20260303.md`
- `package.json`
- `package-lock.json`

## スコープ
- 基本モードの固定シートURLを、指定されたGoogleスプレッドシートURLへ変更する。

## 制約
- 住民票モードの固定URL2件は変更しない。
- 既存のモード切替、シート表示、保存処理ロジックは変更しない。

## 受け入れ条件
- 基本モードで表示されるシートが指定URLのスプレッドシートになる。
- `npm run build` が成功する。

## 非対象
- Apps Script側コード変更
- 住民票モードの挙動変更

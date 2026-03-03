# 基本/住民票Webhook分離仕様（2026-03-03）

## 対象
- `src/app/components/DataEntryForm.tsx`
- `guidelines/resident-sheet-webhook-setup-20260303.md`
- `guidelines/spec-separate-webhook-basic-resident-20260303.md`
- `package.json`
- `package-lock.json`

## スコープ
- 基本モードと住民票モードで別々のWebhook URLを利用できるようにする。
- 環境変数を以下の2系統で扱う。
  - `VITE_BASIC_SHEET_WEBHOOK_URL`
  - `VITE_RESIDENT_SHEET_WEBHOOK_URL`
- シートタブ取得、書き込み、初期化の各処理がモードに応じたWebhookへ送信されるようにする。

## 制約
- 既存のシートID/シート名/列マッピング仕様は変更しない。
- 既存のUIや保存済みリスト機能を壊さない。

## 受け入れ条件
- 基本モードのシート操作は `VITE_BASIC_SHEET_WEBHOOK_URL` を使う。
- 住民票モードのシート操作は `VITE_RESIDENT_SHEET_WEBHOOK_URL` を使う。
- 未設定時は不足している環境変数名を含むエラーメッセージが表示される。
- `npm run build` が成功する。

## 非対象
- Apps Scriptロジック自体の機能変更

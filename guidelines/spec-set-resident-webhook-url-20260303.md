# 住民票Webhook URL設定仕様（2026-03-03）

## 対象
- `.env`

## スコープ
- `VITE_RESIDENT_SHEET_WEBHOOK_URL` に、指定されたApps Script WebアプリURLを設定する。

## 制約
- 既存の他の環境変数は変更しない。
- URL文字列は改変しない。

## 受け入れ条件
- `.env` 内の `VITE_RESIDENT_SHEET_WEBHOOK_URL` が指定URLになっている。

## 非対象
- Apps Script側コード変更。
- アプリ機能の実装修正。

# ローカルExcel自動保存機能の取り下げ仕様（2026-03-04）

## 対象
- `src/app/components/DataEntryForm.tsx`
- `package.json`
- `package-lock.json`

## スコープ
- 直前に追加した「書き込み時ローカルExcel自動保存」機能を削除する。
- 保存先選択UI、File System Access API連携、xlsx生成処理を削除する。
- 書き込み/上書きの既存フロー（Webhook連携）は従来どおり維持する。

## 制約
- 既存のリスト保存・上書き・シート書き込み機能は壊さない。
- 有料APIやサーバー追加は行わない。

## 受け入れ条件
- 画面上に「ローカルExcel自動保存」のUIが表示されない。
- `xlsx` 依存が `package.json` から削除される。
- 書き込み/上書きが従来どおり実行できる。

## 非対象
- 以前の仕様書ファイルの履歴整理

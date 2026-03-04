# GitHub公開時のシートURL秘匿化仕様（2026-03-04）

## 対象
- `src/app/components/DataEntryForm.tsx`
- `.gitignore`
- `.env.example`（新規）
- `README.md`
- `guidelines/spec-mode-fixed-sheet-switch-20260303.md`

## スコープ
- ハードコードされているGoogleスプレッドシートURLをソースコードから削除し、`.env` 経由へ移行する。
- `.env` をGit管理対象から除外する（`--cached` で追跡解除）。
- 公開ドキュメント内の実URLをプレースホルダへ置換する。
- 最低限の環境変数テンプレート `.env.example` を追加する。

## 制約
- 既存のWebhook書き込み処理フローは維持する。
- 既存のシート操作UI構成は大きく変更しない。
- 有料サービスや新規サーバーは追加しない。

## 受け入れ条件
- `DataEntryForm.tsx` に実URLが残らない。
- Git管理ファイルから `.env` が外れる。
- `README.md` と `.env.example` で必要な環境変数名が確認できる。
- `npm run build` が成功する。

## 非対象
- 既に公開済みGit履歴の完全削除（履歴改変）
- フロントエンド実行時のネットワーク先秘匿（クライアント配信上は不可）

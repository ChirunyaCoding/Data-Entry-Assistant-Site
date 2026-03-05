
# データ入力補助ツール

業務用のデータ入力補助ツールです。

## 環境変数設定

1. `.env.example` をコピーして `.env` を作成してください。
2. 次の値を設定してください。

```env
VITE_BASIC_SHEET_WEBHOOK_URL=
VITE_RESIDENT_SHEET_WEBHOOK_URL=
VITE_BASIC_SHEET_URL=
VITE_BASIC_SECONDARY_SHEET_URL=
VITE_RESIDENT_PRIMARY_SHEET_URL=
VITE_RESIDENT_SECONDARY_SHEET_URL=
```

- `.env` はGitへコミットしないでください（`.gitignore` で除外）。
- 公開リポジトリには実際のシートURLを書かない運用にしてください。

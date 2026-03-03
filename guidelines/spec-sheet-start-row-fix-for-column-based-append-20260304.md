# 列基準追記の開始行ずれ修正仕様（2026-03-04）

## 対象
- `guidelines/resident-sheet-webhook-setup-20260303.md`
- `guidelines/spec-sheet-start-row-fix-for-column-based-append-20260304.md`
- `package.json`
- `package-lock.json`

## スコープ
- Apps Scriptの列基準追記処理で `sheet.getLastRow()` を使っていたため開始行が後ろへずれる問題を修正する。
- 対象処理:
  - `appendBasicFileNameRows`（B列）
  - `appendResidentFolderRows`（C:E列）
  - `appendResidentSecondaryRows`（B:C列）
- 対象列範囲のみを見て、開始行以降の最初の空行へ追記する。

## 制約
- 既存アクション名とレスポンス形式（`startRow`/`endRow` など）は維持する。
- フロント側コードは変更しない（Apps Scriptコード更新のみで解決）。

## 受け入れ条件
- 住民票シート2書き込み時、B/C列が空なら `3` 行目から書き込まれる。
- 他列にデータが存在しても、対象列の空行探索結果が優先される。
- 末尾追記でシート行数不足時は自動で行追加される。

## 非対象
- A〜J全体を使う通常の基本/住民票書き込みロジック変更

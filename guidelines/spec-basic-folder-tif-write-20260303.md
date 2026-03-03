# 基本モード フォルダ内tifファイル名書き込み仕様（2026-03-03）

## 対象
- `src/app/components/DataEntryForm.tsx`
- `guidelines/resident-sheet-webhook-setup-20260303.md`
- `guidelines/spec-basic-folder-tif-write-20260303.md`
- `package.json`
- `package-lock.json`

## スコープ
- 基本モードに「フォルダを読み込み」ボタンを追加する。
- 選択フォルダ配下の `tif/tiff` ファイル名（拡張子付き）を抽出し、シートへ一括書き込みする。
- 書き込みは `B` 列のみ、`5` 行目から下へ追記する。

## 制約
- 書き込み先は基本モードの選択中シートタブを使用する。
- 既存の基本モード通常書き込み（A〜J列）仕様は維持する。
- サーバー常駐は追加しない。既存Apps Script Webhookを拡張して利用する。

## 受け入れ条件
- 基本モードで「フォルダを読み込み」ボタンが表示される。
- フォルダ選択後、`tif/tiff` のファイル名が `B5` 以降へ順に追記される。
- `tif/tiff` が1件もない場合にエラーメッセージが表示される。
- `npm run build` が成功する。

## 非対象
- 住民票モードの列マッピング変更
- 既存のリスト保存・編集UI仕様変更

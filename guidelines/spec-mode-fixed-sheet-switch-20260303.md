# モード別固定シート切替仕様（2026-03-03）

## 対象
- `src/app/components/DataEntryForm.tsx`
- `package.json`
- `package-lock.json`

## スコープ
- 基本モードでは、表示シートを以下のURLに固定する。
  - `https://docs.google.com/spreadsheets/d/1ihPDR7CxURU27nerMxHcuz4LsnleEn5w/edit?usp=sharing&ouid=103802180099597441912&rtpof=true&sd=true`
- 住民票モードでは、表示シートを以下2つの固定URLから切替可能にする。
  - `https://docs.google.com/spreadsheets/d/1rXxUwKkhnzholAW7AfNSJ_jfhSL2oPCHhobkZt96rh0/edit?usp=sharing`
  - `https://docs.google.com/spreadsheets/d/1vhmwu7PC_VYxmTgWHYChstsNeZEY0JgRgf_t2bWKQuI/edit?usp=sharing`
- 既存の手入力URL欄を廃止し、固定選択UIに置き換える。
- 住民票モードの選択状態は `localStorage` に保存し、再訪時に復元する。

## 制約
- 既存のPDFプレビュー・漢字表示・フォーム入力機能を壊さない。
- サーバー追加や外部課金API利用を行わない。
- 既存のGoogleスプレッドシート埋め込み表示方式（iframe）を維持する。

## 受け入れ条件
- 基本モード時に「シート」表示へ切替えると、常に基本モード固定URLが表示される。
- 住民票モード時に「シート」表示へ切替えると、2つの固定シートをボタンで切替できる。
- 住民票モードで選択したシートはリロード後も保持される。
- `npm run build` が成功する。

## 非対象
- Google側の共有権限設定変更。
- シート内容の編集・自動入力ロジック追加。
- 住民票モード以外での複数シート切替。

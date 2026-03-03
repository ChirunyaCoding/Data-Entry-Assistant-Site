# 住民票シートWebhook設定手順（2026-03-03）

## 1. Apps Script を作成
Google Apps Script で以下を `Code.gs` に配置し、Webアプリとしてデプロイしてください。

```javascript
function doPost(e) {
  try {
    var raw = e.parameter.payload || "{}";
    var payload = JSON.parse(raw);

    var sheetId = String(payload.sheetId || "").trim();
    var sheetName = String(payload.sheetName || "").trim();
    var startRow = Number(payload.startRow || 6);
    var values = payload.values || {};

    if (!sheetId) {
      return jsonResponse({ ok: false, message: "sheetId が未指定です" });
    }
    if (!sheetName) {
      return jsonResponse({ ok: false, message: "sheetName が未指定です" });
    }

    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return jsonResponse({
        ok: false,
        message: "指定されたシート名が見つかりません: " + sheetName
      });
    }

    var lastRow = sheet.getLastRow();
    var nextRow = Math.max(startRow, lastRow + 1);

    sheet.getRange(nextRow, 2).setValue(values.B || "");  // B
    sheet.getRange(nextRow, 6).setValue(values.F || "");  // F
    sheet.getRange(nextRow, 7).setValue(values.G || "");  // G
    sheet.getRange(nextRow, 8).setValue(values.H || "");  // H
    sheet.getRange(nextRow, 9).setValue(values.I || "");  // I
    sheet.getRange(nextRow, 10).setValue(values.J || ""); // J
    sheet.getRange(nextRow, 11).setValue(values.K || ""); // K
    sheet.getRange(nextRow, 12).setValue(values.L || ""); // L

    return jsonResponse({ ok: true, row: nextRow, sheetName: sheetName });
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) });
  }
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 2. フロントにWebhook URLを設定
プロジェクトルートに `.env` を作成し、次を設定してください。

```env
VITE_RESIDENT_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec
```

## 3. 反映確認
住民票モードで書き込み先シート名を入力して `保存` を押し、
`シート「xxx」のn行目へ反映しました。` が表示されることを確認します。

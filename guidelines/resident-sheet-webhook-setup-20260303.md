# シートWebhook設定手順（2026-03-03）

## 1. Apps Script を作成
Google Apps Script で以下を `Code.gs` に配置し、Webアプリとしてデプロイしてください。

```javascript
function doPost(e) {
  try {
    var raw = e.parameter.payload || "{}";
    var payload = JSON.parse(raw);
    var action = String(payload.action || "appendResidentRow").trim();

    if (action === "listSheets") {
      return handleListSheets(payload);
    }
    if (action === "clearSheetRange") {
      return handleClearSheetRange(payload);
    }
    if (action === "appendBasicRow") {
      return handleAppendBasicRow(payload);
    }
    if (action === "appendBasicFileNameRows") {
      return handleAppendBasicFileNameRows(payload);
    }
    if (action === "appendResidentSecondaryRows") {
      return handleAppendResidentSecondaryRows(payload);
    }
    if (action === "appendResidentFolderRows") {
      return handleAppendResidentFolderRows(payload);
    }
    if (action === "appendResidentRow" || action === "appendRow") {
      return handleAppendResidentRow(payload);
    }

    return jsonResponse({ ok: false, message: "未対応の action です: " + action });
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) });
  }
}

function handleListSheets(payload) {
  var sheetId = String(payload.sheetId || "").trim();
  if (!sheetId) {
    return jsonResponse({ ok: false, message: "sheetId が未指定です" });
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheets = ss.getSheets().map(function (sheet) {
    return {
      name: sheet.getName(),
      gid: String(sheet.getSheetId()),
    };
  });

  return jsonResponse({
    ok: true,
    sheetId: sheetId,
    sheets: sheets,
  });
}

function handleClearSheetRange(payload) {
  var sheetId = String(payload.sheetId || "").trim();
  var sheetName = String(payload.sheetName || "").trim();
  var startRow = Number(payload.startRow || 1);
  var endRow = Number(payload.endRow || startRow);
  var clearAllColumns = Boolean(payload.clearAllColumns);
  var startColumn = Number(payload.startColumn || 1);
  var endColumn = Number(payload.endColumn || startColumn);

  if (!sheetId) {
    return jsonResponse({ ok: false, message: "sheetId が未指定です" });
  }
  if (!sheetName) {
    return jsonResponse({ ok: false, message: "sheetName が未指定です" });
  }
  if (startRow < 1 || endRow < startRow) {
    return jsonResponse({ ok: false, message: "行範囲が不正です" });
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return jsonResponse({
      ok: false,
      message: "指定されたシート名が見つかりません: " + sheetName
    });
  }

  var rowCount = endRow - startRow + 1;
  var clearedRange;
  if (clearAllColumns) {
    var maxColumns = sheet.getMaxColumns();
    sheet.getRange(startRow, 1, rowCount, maxColumns).clearContent();
    clearedRange = "A" + startRow + ":" + columnToLetter(maxColumns) + endRow;
  } else {
    if (startColumn < 1 || endColumn < startColumn) {
      return jsonResponse({ ok: false, message: "列範囲が不正です" });
    }
    var columnCount = endColumn - startColumn + 1;
    sheet.getRange(startRow, startColumn, rowCount, columnCount).clearContent();
    clearedRange =
      columnToLetter(startColumn) +
      startRow +
      ":" +
      columnToLetter(endColumn) +
      endRow;
  }

  return jsonResponse({
    ok: true,
    sheetName: sheetName,
    clearedRange: clearedRange,
  });
}

function handleAppendBasicRow(payload) {
  var sheetId = String(payload.sheetId || "").trim();
  var sheetName = String(payload.sheetName || "").trim();
  var startRow = Number(payload.startRow || 5);
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

  var nextRow = findFirstEmptyRowInColumns(sheet, startRow, 1, 10);
  ensureRowsForWrite(sheet, nextRow, 1);

  sheet.getRange(nextRow, 1).setValue(values.A || "");  // A
  sheet.getRange(nextRow, 2).setValue(values.B || "");  // B
  sheet.getRange(nextRow, 3).setValue(values.C || "");  // C
  sheet.getRange(nextRow, 4).setValue(values.D || "");  // D
  sheet.getRange(nextRow, 5).setValue(values.E || "");  // E
  sheet.getRange(nextRow, 6).setValue(values.F || "");  // F
  sheet.getRange(nextRow, 7).setValue(values.G || "");  // G
  sheet.getRange(nextRow, 8).setValue(values.H || "");  // H
  sheet.getRange(nextRow, 9).setValue(values.I || "");  // I
  sheet.getRange(nextRow, 10).setValue(values.J || ""); // J

  // 書き込み時の表示書式を統一（メイリオ / 10）
  sheet.getRange(nextRow, 1, 1, 10).setFontFamily("Meiryo").setFontSize(10);

  return jsonResponse({ ok: true, row: nextRow, sheetName: sheetName });
}

function handleAppendBasicFileNameRows(payload) {
  var sheetId = String(payload.sheetId || "").trim();
  var sheetName = String(payload.sheetName || "").trim();
  var startRow = Number(payload.startRow || 5);
  var fileNames = Array.isArray(payload.fileNames) ? payload.fileNames : [];

  if (!sheetId) {
    return jsonResponse({ ok: false, message: "sheetId が未指定です" });
  }
  if (!sheetName) {
    return jsonResponse({ ok: false, message: "sheetName が未指定です" });
  }
  if (fileNames.length === 0) {
    return jsonResponse({ ok: false, message: "fileNames が空です" });
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return jsonResponse({
      ok: false,
      message: "指定されたシート名が見つかりません: " + sheetName
    });
  }

  var values = fileNames.map(function (name) {
    return [String(name || "")];
  });

  var nextRow = findFirstEmptyRowInColumns(sheet, startRow, 2, 1);
  ensureRowsForWrite(sheet, nextRow, values.length);
  sheet.getRange(nextRow, 2, values.length, 1).setValues(values); // B列
  sheet.getRange(nextRow, 2, values.length, 1).setFontFamily("Meiryo").setFontSize(10);

  return jsonResponse({
    ok: true,
    sheetName: sheetName,
    rowsWritten: values.length,
    startRow: nextRow,
    endRow: nextRow + values.length - 1,
  });
}

function handleAppendResidentRow(payload) {
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

  var nextRow = findFirstEmptyRowByColumns(sheet, startRow, [2, 6, 7, 8, 9, 10, 11, 12]);
  ensureRowsForWrite(sheet, nextRow, 1);

  sheet.getRange(nextRow, 2).setValue(values.B || "");  // B
  sheet.getRange(nextRow, 6).setValue(values.F || "");  // F
  sheet.getRange(nextRow, 7).setValue(values.G || "");  // G
  sheet.getRange(nextRow, 8).setValue(values.H || "");  // H
  sheet.getRange(nextRow, 9).setValue(values.I || "");  // I
  sheet.getRange(nextRow, 10).setValue(values.J || ""); // J
  sheet.getRange(nextRow, 11).setValue(values.K || ""); // K
  sheet.getRange(nextRow, 12).setValue(values.L || ""); // L

  // 書き込み時の表示書式を統一（メイリオ / 10）
  sheet.getRange(nextRow, 2).setFontFamily("Meiryo").setFontSize(10);      // B
  sheet.getRange(nextRow, 6, 1, 7).setFontFamily("Meiryo").setFontSize(10); // F-L

  return jsonResponse({ ok: true, row: nextRow, sheetName: sheetName });
}

function handleAppendResidentFolderRows(payload) {
  var sheetId = String(payload.sheetId || "").trim();
  var sheetName = String(payload.sheetName || "").trim();
  var startRow = Number(payload.startRow || 6);
  var rows = Array.isArray(payload.rows) ? payload.rows : [];

  if (!sheetId) {
    return jsonResponse({ ok: false, message: "sheetId が未指定です" });
  }
  if (!sheetName) {
    return jsonResponse({ ok: false, message: "sheetName が未指定です" });
  }
  if (rows.length === 0) {
    return jsonResponse({ ok: false, message: "rows が空です" });
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return jsonResponse({
      ok: false,
      message: "指定されたシート名が見つかりません: " + sheetName
    });
  }

  var values = rows.map(function (row) {
    return [String(row.C || ""), String(row.D || ""), String(row.E || "")];
  });
  if (values.length === 0) {
    return jsonResponse({ ok: false, message: "書き込み対象データがありません" });
  }

  var nextRow = findFirstEmptyRowInColumns(sheet, startRow, 3, 3);
  ensureRowsForWrite(sheet, nextRow, values.length);
  sheet.getRange(nextRow, 3, values.length, 3).setValues(values); // C:D:E
  sheet.getRange(nextRow, 3, values.length, 3).setFontFamily("Meiryo").setFontSize(10);

  return jsonResponse({
    ok: true,
    sheetName: sheetName,
    rowsWritten: values.length,
    startRow: nextRow,
    endRow: nextRow + values.length - 1,
  });
}

function handleAppendResidentSecondaryRows(payload) {
  var sheetId = String(payload.sheetId || "").trim();
  var sheetName = String(payload.sheetName || "").trim();
  var startRow = Number(payload.startRow || 3);
  var rows = Array.isArray(payload.rows) ? payload.rows : [];

  if (!sheetId) {
    return jsonResponse({ ok: false, message: "sheetId が未指定です" });
  }
  if (!sheetName) {
    return jsonResponse({ ok: false, message: "sheetName が未指定です" });
  }
  if (rows.length === 0) {
    return jsonResponse({ ok: false, message: "rows が空です" });
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return jsonResponse({
      ok: false,
      message: "指定されたシート名が見つかりません: " + sheetName
    });
  }

  var normalizedRows = rows
    .map(function (row) {
      return {
        B: String(row.B || ""),
        C: String(row.C || "").trim(),
      };
    })
    .filter(function (row) {
      return row.C !== "";
    });
  if (normalizedRows.length === 0) {
    return jsonResponse({ ok: false, message: "C列に書き込む値がありません" });
  }

  var writtenRows = [];
  normalizedRows.forEach(function (row) {
    var targetRow = row.B
      ? findFirstRowByColumnValue(sheet, startRow, 2, row.B)
      : -1;

    if (targetRow < startRow) {
      targetRow = findFirstEmptyRowInColumns(sheet, startRow, 3, 1); // C列
    }

    ensureRowsForWrite(sheet, targetRow, 1);

    if (row.B) {
      var currentB = String(sheet.getRange(targetRow, 2).getDisplayValue() || "").trim();
      if (currentB === "") {
        sheet.getRange(targetRow, 2).setValue(row.B);
      }
    }

    sheet.getRange(targetRow, 3).setValue(row.C);
    sheet.getRange(targetRow, 2, 1, 2).setFontFamily("Meiryo").setFontSize(10);
    writtenRows.push(targetRow);
  });

  writtenRows.sort(function (a, b) {
    return a - b;
  });

  return jsonResponse({
    ok: true,
    sheetName: sheetName,
    rowsWritten: writtenRows.length,
    startRow: writtenRows[0],
    endRow: writtenRows[writtenRows.length - 1],
  });
}

function findFirstEmptyRowInColumns(sheet, startRow, startColumn, columnCount) {
  var maxRows = sheet.getMaxRows();
  if (startRow > maxRows) {
    return startRow;
  }

  var rowCount = maxRows - startRow + 1;
  var values = sheet
    .getRange(startRow, startColumn, rowCount, columnCount)
    .getDisplayValues();

  for (var i = 0; i < values.length; i++) {
    var rowValues = values[i];
    var hasValue = rowValues.some(function (value) {
      return String(value || "").trim() !== "";
    });
    if (!hasValue) {
      return startRow + i;
    }
  }

  return maxRows + 1;
}

function findFirstEmptyRowByColumns(sheet, startRow, columns) {
  var maxRows = sheet.getMaxRows();
  if (startRow > maxRows) {
    return startRow;
  }

  var rowCount = maxRows - startRow + 1;
  var columnValues = columns.map(function (column) {
    return sheet.getRange(startRow, column, rowCount, 1).getDisplayValues();
  });

  for (var rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    var hasValue = columnValues.some(function (values) {
      return String(values[rowIndex][0] || "").trim() !== "";
    });
    if (!hasValue) {
      return startRow + rowIndex;
    }
  }

  return maxRows + 1;
}

function findFirstRowByColumnValue(sheet, startRow, column, value) {
  var maxRows = sheet.getMaxRows();
  if (startRow > maxRows) {
    return -1;
  }

  var targetValue = String(value || "").trim();
  if (targetValue === "") {
    return -1;
  }

  var rowCount = maxRows - startRow + 1;
  var values = sheet.getRange(startRow, column, rowCount, 1).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === targetValue) {
      return startRow + i;
    }
  }

  return -1;
}

function ensureRowsForWrite(sheet, startRow, rowCount) {
  var requiredLastRow = startRow + rowCount - 1;
  var maxRows = sheet.getMaxRows();
  if (requiredLastRow > maxRows) {
    sheet.insertRowsAfter(maxRows, requiredLastRow - maxRows);
  }
}

function columnToLetter(column) {
  var letter = "";
  var temp = column;
  while (temp > 0) {
    var remainder = (temp - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
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
VITE_BASIC_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec
VITE_RESIDENT_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec
```

- 基本モードのシート操作は `VITE_BASIC_SHEET_WEBHOOK_URL` を使用します。
- 住民票モードのシート操作は `VITE_RESIDENT_SHEET_WEBHOOK_URL` を使用します。

## 3. 反映確認
- 住民票モード: 書き込み先シートを選択して `書き込み` を押し、反映成功メッセージが表示されること。
- 基本モード: 表示シートを選択して `書き込み` を押し、反映成功メッセージが表示されること。
- 基本モード: `フォルダを読み込み` でフォルダを選択し、`B5` 以降へ `tif/tiff` ファイル名が追記されること。
- 住民票モード（住民票シート1）: `フォルダを読み込み` でフォルダを選択し、`C/D/E` 列へ `6` 行目以降に追記されること。
- 住民票モード（住民票シート2）: `フォルダを読み込み` 後に氏名を入力し、`書き込み` で `B3:C` へ件数分追記されること。

## 4. 初期化確認
- シート選択UIの `初期化` を押し、対象レンジがクリアされること。
- クリア対象ルール:
  - 基本モード: 全列 `5` 行目から `1000` 行目
  - 住民票モード（住民票シート1）: 全列 `6` 行目から `1000` 行目
  - 住民票モード（住民票シート2）: `B3:C1000`

const CONFIG = {
  spreadsheetId: '171G8dMhMLTkTEOayurEhVB8KFXmiuvLymk9XvdBhfzA',
  token: '',
  timezone: 'Europe/Istanbul',
  dailySheetPrefix: 'Gunluk',
  cacheKey: 'LAST_SYNC_PAYLOAD',
  sheets: {
    departures: 'Departures',
    specialServices: 'Special Services',
    inventory: 'Inventory Summary',
    handovers: 'Shift Handovers',
  },
};

function doGet() {
  return jsonResponse({
    ok: true,
    message: 'Google Sheets senkron endpointi calisiyor.',
    mode: 'daily-sheet',
    targetSheet: getDailySheetName_(),
    sheets: CONFIG.sheets,
    spreadsheetId: CONFIG.spreadsheetId,
    timestamp: new Date().toISOString(),
  });
}

function doPost(e) {
  try {
    enforceToken_(e);

    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Request body is required.' }, 400);
    }

    const payload = JSON.parse(e.postData.contents);
    validatePayload_(payload);

    const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const sections = buildSections_(payload);
    const targetSheetName = getDailySheetName_();

    upsertUnifiedSheet_(spreadsheet, sections, targetSheetName);
    saveLastPayload_(payload);

    return jsonResponse({
      ok: true,
      targetSheet: targetSheetName,
      summary: {
        departures: (payload.departures || []).length,
        specialServices: (payload.specialServices || []).length,
        inventorySummary: (payload.inventorySummary || []).length,
        handovers: (payload.handovers || []).length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

function buildSections_(payload) {
  const departuresHeaders = [
    'Ucus Kodu',
    'Kuyruk Kodu',
    'Kalkis Saati',
    'Varis Noktasi',
    'Kapi',
    'WCH Sayisi',
  ];

  const specialServicesHeaders = [
    'Kayit Tarihi',
    'Kayit Saati',
    'Ucus Kodu',
    'Havayolu',
    'Varis Noktasi',
    'Terminal',
    'Kapi',
    'Yolcu Tipi',
    'Atanan Personel',
    'Kaydi Acan',
    'Sandalye ID',
    'Ozel Not',
  ];

  const inventoryHeaders = [
    'Guncelleme Tarihi',
    'Guncelleme Saati',
    'Terminal',
    'Musait',
    'Eksik',
    'Bakimda',
    'Toplam',
  ];

  const handoversHeaders = [
    'Kayit Tarihi',
    'Kayit Saati',
    'Terminal',
    'Devir Eden',
    'Devir Alan',
    'Durum Ozeti',
    'Checklist',
  ];

  return {
    departures: { headers: departuresHeaders, rows: mapDepartures_(payload.departures || []) },
    specialServices: { headers: specialServicesHeaders, rows: mapSpecialServices_(payload.specialServices || []) },
    inventory: { headers: inventoryHeaders, rows: mapInventory_(payload.inventorySummary || []) },
    handovers: { headers: handoversHeaders, rows: mapHandovers_(payload.handovers || []) },
  };
}

function enforceToken_(e) {
  if (!CONFIG.token) {
    return;
  }

  const requestToken = (e.parameter && e.parameter.token) || '';
  if (requestToken !== CONFIG.token) {
    throw new Error('Unauthorized request.');
  }
}

function validatePayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be a JSON object.');
  }

  const keys = ['departures', 'specialServices', 'inventorySummary', 'handovers'];
  keys.forEach(function(key) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      throw new Error(key + ' must be an array when provided.');
    }
  });
}

function upsertUnifiedSheet_(spreadsheet, sections, targetSheetName) {
  const sheet = getOrCreateSheet_(spreadsheet, targetSheetName);

  // Eski merge'ler kalirsa sonraki yazimlarda kolonlar kayabilir.
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();

  sheet.clearContents();
  sheet.clearFormats();

  const maxColumns = Math.max(
    sections.departures.headers.length,
    sections.specialServices.headers.length,
    sections.inventory.headers.length,
    sections.handovers.headers.length,
  );

  let nextRow = 1;
  nextRow = writeSectionBlock_(sheet, nextRow, 'DEPARTURES', sections.departures.headers, sections.departures.rows, {
    titleBg: '#1D4ED8',
    headerBg: '#DBEAFE',
  }, maxColumns);

  nextRow = writeSectionBlock_(sheet, nextRow, 'OZEL HIZMETLER', sections.specialServices.headers, sections.specialServices.rows, {
    titleBg: '#0F766E',
    headerBg: '#CCFBF1',
  }, maxColumns);

  nextRow = writeSectionBlock_(sheet, nextRow, 'ENVANTER OZETI', sections.inventory.headers, sections.inventory.rows, {
    titleBg: '#166534',
    headerBg: '#DCFCE7',
  }, maxColumns);

  writeSectionBlock_(sheet, nextRow, 'VARDIYA DEVIRLERI', sections.handovers.headers, sections.handovers.rows, {
    titleBg: '#6D28D9',
    headerBg: '#EDE9FE',
  }, maxColumns);

  sheet.setTabColor('#2563EB');
  sheet.autoResizeColumns(1, maxColumns);

  // F kolonu (WCH Sayisi) auto-resize sonrasi biraz daha genis olsun.
  if (maxColumns >= 6) {
    const currentFWidth = sheet.getColumnWidth(6);
    sheet.setColumnWidth(6, Math.min(currentFWidth + 20, 220));
  }

  // DEPARTURES satirlari icin saat bazli renklendirme (sadece Ucus Kodu sutunu).
  styleDeparturesRows_(sheet, 3, sections.departures.rows, sections.departures.headers.length);

  sheet.setFrozenRows(0);
}

function styleDeparturesRows_(sheet, dataStartRow, rows, columnCount) {
  if (!rows || rows.length === 0 || columnCount <= 0) {
    return;
  }

  const nowMinutes = getCurrentMinutesOfDay_();
  const adjustedDepartureMinutes = buildAdjustedDepartureMinutes_(rows, 2);
  const backgrounds = [];
  const fontColors = [];

  rows.forEach(function(row, index) {
    const departureMinutes = adjustedDepartureMinutes[index];
    const rowBackgrounds = Array(columnCount).fill('#FFFFFF');
    const rowFontColors = Array(columnCount).fill('#111827');

    if (departureMinutes !== null) {
      const minutesUntilDeparture = departureMinutes - nowMinutes;

      if (minutesUntilDeparture < 0) {
        // Ucan (saati gecmis) ucuslar: sadece Ucus Kodu sutunu yesil.
        rowBackgrounds[0] = '#09ff00';
        rowFontColors[0] = '#14532D';
      }
    }

    backgrounds.push(rowBackgrounds);
    fontColors.push(rowFontColors);
  });

  const range = sheet.getRange(dataStartRow, 1, rows.length, columnCount);
  range.setBackgrounds(backgrounds);
  range.setFontColors(fontColors);
}

function buildAdjustedDepartureMinutes_(rows, timeColumnIndex) {
  const nowMinutes = getCurrentMinutesOfDay_();

  return rows.map(function(row) {
    const rawMinutes = parseTimeToMinutes_(row[timeColumnIndex]);
    if (rawMinutes === null) {
      return null;
    }

    // Eger bu saat 2 saatten fazla geri kaldiysa ertesi gunun ucusu say.
    if (rawMinutes < nowMinutes - 120) {
      return rawMinutes + 1440;
    }
    return rawMinutes;
  });
}

function getCurrentMinutesOfDay_() {
  const nowTime = Utilities.formatDate(new Date(), CONFIG.timezone, 'HH:mm');
  const parsed = parseTimeToMinutes_(nowTime);
  return parsed === null ? 0 : parsed;
}

function parseTimeToMinutes_(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2}):(\d{2})/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function getDailySheetName_(date) {
  const current = date || new Date();
  const dayKey = Utilities.formatDate(current, CONFIG.timezone, 'yyyy-MM-dd');
  return `${CONFIG.dailySheetPrefix}-${dayKey}`;
}

function saveLastPayload_(payload) {
  PropertiesService.getScriptProperties().setProperty(CONFIG.cacheKey, JSON.stringify(payload));
}

function getLastPayload_() {
  const raw = PropertiesService.getScriptProperties().getProperty(CONFIG.cacheKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Zaman tetikleyicisi bu fonksiyonu cagirabilir.
function autoSyncFromCache() {
  const payload = getLastPayload_();
  if (!payload) {
    return;
  }

  validatePayload_(payload);

  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sections = buildSections_(payload);
  upsertUnifiedSheet_(spreadsheet, sections, getDailySheetName_());
}

// Her gun 00:10 civarinda calisarak yeni gun sekmesini olusturur/gunceller.
function dailyRefreshAt0010() {
  const payload = getLastPayload_();
  if (!payload) {
    return;
  }

  validatePayload_(payload);

  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sections = buildSections_(payload);
  upsertUnifiedSheet_(spreadsheet, sections, getDailySheetName_(new Date()));
}

// Bir kez calistirarak otomatik tetikleyicileri olustur:
// - autoSyncFromCache: her 1 dakika
// - dailyRefreshAt0010: her gun 00:10 civari
function installAutoSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === 'autoSyncFromCache' || handler === 'dailyRefreshAt0010') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('autoSyncFromCache')
    .timeBased()
    .everyMinutes(1)
    .create();

  ScriptApp.newTrigger('dailyRefreshAt0010')
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .nearMinute(10)
    .create();
}

function getOrCreateSheet_(spreadsheet, name) {
  const existing = spreadsheet.getSheetByName(name);
  if (existing) {
    return existing;
  }

  return spreadsheet.insertSheet(name);
}

function writeSectionBlock_(sheet, startRow, title, headers, rows, palette, maxColumns) {
  const titleRange = sheet.getRange(startRow, 1, 1, maxColumns);
  titleRange
    .merge()
    .setValue(title)
    .setBackground(palette.titleBg)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');

  const headerRow = startRow + 1;
  sheet.getRange(headerRow, 1, 1, headers.length)
    .setValues([headers])
    .setBackground(palette.headerBg)
    .setFontColor('#111827')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.getRange(headerRow, 1, 1, headers.length)
    .setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  if (rows.length === 0) {
    const placeholder = headers.map(function(_, index) {
      return index === 0 ? 'Veri yok' : '';
    });

    sheet.getRange(headerRow + 1, 1, 1, headers.length)
      .setValues([placeholder])
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.getRange(headerRow + 1, 1, 1, headers.length)
      .setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

    return headerRow + 3;
  }

  sheet.getRange(headerRow + 1, 1, rows.length, headers.length)
    .setValues(rows)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.getRange(headerRow + 1, 1, rows.length, headers.length)
    .setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  return headerRow + rows.length + 2;
}

function mapDepartures_(departures) {
  return departures
    .map(function(item) {
      const tailCode = String(
        item.tailCode ||
        item.aircraftRegistration ||
        item.tail ||
        item.tailNumber ||
        item.aircraftReg ||
        item.registration ||
        item.aircraft_registration ||
        ''
      ).trim();

      return [
        String(item.flightCode || '').trim(),
        tailCode || '-',
        String(item.departureTime || '').trim(),
        String(item.destination || '').trim(),
        String(item.gate || '').trim(),
        Number(item.wheelchairCount || 0) || '',
      ];
    })
    .filter(function(row) {
      // Varis noktasi bos olan ucuslar listelenmesin.
      return row[3] !== '';
    });
}

function mapSpecialServices_(services) {
  return services.map(function(item) {
    const dateTimeParts = splitDateTimeParts_(item.createdAt);

    return [
      dateTimeParts[0],
      dateTimeParts[1],
      item.flightCode || '',
      item.airline || '',
      item.destination || '',
      item.terminal || '',
      item.gate || '',
      translatePassengerType_(item.passengerType),
      item.assignedStaff || '',
      item.createdBy || '',
      item.wheelchairId || '',
      item.specialNotes || '',
    ];
  });
}

function mapInventory_(items) {
  return items.map(function(item) {
    const available = Number(item.available || 0);
    const missing = Number(item.missing || 0);
    const maintenance = Number(item.maintenance || 0);
    const dateTimeParts = splitDateTimeParts_(item.updatedAt);

    return [
      dateTimeParts[0],
      dateTimeParts[1],
      item.terminal || '',
      available,
      missing,
      maintenance,
      available + missing + maintenance,
    ];
  });
}

function mapHandovers_(items) {
  return items.map(function(item) {
    const dateTimeParts = splitDateTimeParts_(item.createdAt);

    return [
      dateTimeParts[0],
      dateTimeParts[1],
      item.terminal || '',
      item.fromStaff || '',
      item.toStaff || '',
      item.snapshot || '',
      item.checklist || '',
    ];
  });
}

function valueOrNow_(value) {
  return value || formatTimestamp_(new Date());
}

function formatTimestamp_(value) {
  return Utilities.formatDate(new Date(value), CONFIG.timezone, 'yyyy-MM-dd HH:mm:ss');
}

function splitDateTimeParts_(value) {
  const fallback = new Date();
  const parsed = new Date(value || fallback);

  if (!Number.isNaN(parsed.getTime())) {
    return [
      Utilities.formatDate(parsed, CONFIG.timezone, 'yyyy-MM-dd'),
      Utilities.formatDate(parsed, CONFIG.timezone, 'HH:mm:ss'),
    ];
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return [
      Utilities.formatDate(fallback, CONFIG.timezone, 'yyyy-MM-dd'),
      Utilities.formatDate(fallback, CONFIG.timezone, 'HH:mm:ss'),
    ];
  }

  const parts = raw.split(' ');
  return [parts[0] || '', parts[1] || ''];
}

function translatePassengerType_(value) {
  const normalized = String(value || '').trim().toUpperCase();

  const map = {
    STEP: 'Merdiven',
    RAMP: 'Rampa',
    CABIN: 'Kabin',
  };

  return map[normalized] || (value || '');
}

function jsonResponse(payload, statusCode) {
  const output = ContentService
    .createTextOutput(JSON.stringify(payload, null, 2))
    .setMimeType(ContentService.MimeType.JSON);

  if (statusCode && output.setResponseCode) {
    output.setResponseCode(statusCode);
  }

  return output;
}
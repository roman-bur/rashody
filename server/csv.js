// Формирует CSV с BOM (для корректного открытия в Excel на Windows) из массива объектов.
function toCsv(rows, columns) {
  const BOM = '﻿';
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (/[",;\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map((c) => escape(c.label)).join(';');
  const lines = rows.map((row) => columns.map((c) => escape(row[c.key])).join(';'));
  return BOM + [header, ...lines].join('\r\n');
}

module.exports = { toCsv };

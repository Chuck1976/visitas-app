import test from "node:test";
import assert from "node:assert/strict";
import writeExcelFile from "write-excel-file/node";
import { readSheet } from "read-excel-file/node";
import { unzipSync, strFromU8 } from "fflate";
import { buildVisitSheet, getVisitSheetOptions, selectedVisitColumns, visitSheetOptions, visitsInRange } from "./visit-export.mjs";

const visits = [
  { id: 3, date: "2026-10-02", businessName: "Última" },
  { id: 2, date: "2026-10-01", createdAt: "2026-10-01T12:00:00Z" },
  { id: 1, date: "2026-10-01", createdAt: "2026-10-01T09:00:00Z", businessName: "=1+1", postalCode: "00123", notes: "Café & té\nSegunda línea", latitude: 0 },
  { id: 4, date: "2026-10-03" },
];

test("selected columns produce an aligned XLSX without omitted data", async () => {
  const ids = ["reminderDate", "postalCode", "businessName", "businessName", "unknown"];
  const data = buildVisitSheet([visits[2]], [
    { sourceVisitId: 1, dueDate: "2026-11-05", status: "pending" },
  ], () => "Normal", ids);
  const options = getVisitSheetOptions(ids);
  assert.deepEqual(options.columns, [{ width: 30 }, { width: 16 }, { width: 24 }]);
  const buffer = await writeExcelFile(data, options).toBuffer();
  const rows = await readSheet(buffer);
  assert.deepEqual(rows[0], ["Negocio", "Código postal", "Fecha del recordatorio"]);
  assert.deepEqual(rows[1], ["=1+1", "00123", new Date("2026-11-05T00:00:00Z")]);
  assert.equal(visits[2].notes, "Café & té\nSegunda línea");
  const single = buildVisitSheet([visits[2]], [], () => "Normal", ["date"]);
  assert.equal(single[1][0].backgroundColor, "#FFF0DB");
  assert.equal(single[0].length, 1);
  assert.throws(() => buildVisitSheet(visits, [], () => "Normal", []), /al menos una/);
  assert.deepEqual(selectedVisitColumns(["unknown"]), []);
});

test("inclusive range, chronological order, single day, invalid and empty ranges", () => {
  assert.deepEqual(visitsInRange(visits, "2026-10-01", "2026-10-02").map(v => v.id), [1, 2, 3]);
  assert.deepEqual(visitsInRange(visits, "2026-10-02", "2026-10-02").map(v => v.id), [3]);
  for (const [from, to] of [["", "2026-10-02"], ["2026-10-02", "2026-10-01"], ["2026-02-30", "2026-10-02"], ["2025-01-01", "2025-01-02"]]) {
    assert.deepEqual(visitsInRange(visits, from, to), []);
  }
  assert.deepEqual(visits.map(v => v.id), [3, 2, 1, 4]);
});

test("real XLSX round trip preserves dates, reminder associations, text and highlights", async () => {
  const reminders = [
    { sourceVisitId: "1", dueDate: "2026-11-01", status: "pending", updatedAt: "2026-10-01" },
    { sourceVisitId: 1, dueDate: "2026-11-05", status: "pending", updatedAt: "2026-10-02" },
    { sourceVisitId: 1, dueDate: "2026-11-09", status: "done", updatedAt: "2026-10-03" },
    { sourceVisitId: 3, dueDate: "2026-12-01", status: "done" },
  ];
  const data = buildVisitSheet(visitsInRange(visits, "2026-10-01", "2026-10-02"), reminders, () => "Normal");
  const buffer = await writeExcelFile(data, visitSheetOptions).toBuffer();
  const rows = await readSheet(buffer);
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0], "Fecha de visita");
  assert.equal(rows[0].at(-1), "Fecha del recordatorio");
  assert.equal(rows[1][0].toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(rows[1][1], "=1+1");
  assert.equal(rows[1][7], "00123");
  assert.equal(rows[1][12], "Café & té\nSegunda línea");
  assert.equal(rows[1][13], "0");
  assert.equal(rows[1][16].toISOString(), "2026-11-05T00:00:00.000Z");
  assert.equal(rows[2][16], null);
  assert.equal(rows[3][16].toISOString(), "2026-12-01T00:00:00.000Z");
  const files = unzipSync(buffer);
  const workbookXml = strFromU8(files["xl/workbook.xml"]);
  assert.equal((workbookXml.match(/<sheet /g) || []).length, 1);
  assert.match(workbookXml, /name="Visitas"/);
  assert.match(strFromU8(files["xl/styles.xml"]), /FFF0DB/);
  assert.match(strFromU8(files["xl/worksheets/sheet1.xml"]), /state="frozen"/);
  assert.doesNotMatch(strFromU8(files["xl/worksheets/sheet1.xml"]), /<f[ >]/);
});

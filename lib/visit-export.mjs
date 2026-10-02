export function isExportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function visitsInRange(visits, from, to) {
  if (!isExportDate(from) || !isExportDate(to) || from > to) return [];
  return visits
    .filter(visit => isExportDate(visit.date) && visit.date >= from && visit.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) ||
      String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export const visitExportColumns = [
  ["date", "Fecha de visita", 18], ["businessName", "Negocio", 30],
  ["category", "Categoría", 24], ["contactName", "Referente", 24],
  ["phone", "Teléfono", 20], ["locality", "Localidad", 24],
  ["neighborhood", "Barrio/Zona", 24], ["postalCode", "Código postal", 16],
  ["address", "Dirección", 40], ["googleMaps", "Google Maps", 40],
  ["visitType", "Tipo visita", 44], ["visitValue", "Valor", 36],
  ["notes", "Notas", 60], ["latitude", "Latitud", 18],
  ["longitude", "Longitud", 18], ["locationAccuracy", "Precisión metros", 20],
  ["reminderDate", "Fecha del recordatorio", 24],
].map(([id, label, width]) => ({ id, label, width }));

export function selectedVisitColumns(ids = visitExportColumns.map(column => column.id)) {
  return visitExportColumns.filter(column => ids.includes(column.id));
}

export function getVisitSheetOptions(ids) {
  return {
    sheet: "Visitas",
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
    columns: selectedVisitColumns(ids).map(({ width }) => ({ width })),
  };
}

export const visitSheetOptions = getVisitSheetOptions();

export function buildVisitSheet(visits, reminders, labelValue, ids) {
  const columns = selectedVisitColumns(ids);
  if (!columns.length) throw new Error("Selecciona al menos una columna.");
  // Prefer the current pending reminder; otherwise retain the latest saved one.
  const byVisit = new Map();
  for (const reminder of reminders) {
    if (!isExportDate(reminder.dueDate)) continue;
    const key = String(reminder.sourceVisitId);
    const previous = byVisit.get(key);
    const pending = reminder.status === "pending";
    const previousPending = previous?.status === "pending";
    if (!previous || (pending && !previousPending) ||
      (pending === previousPending && String(reminder.updatedAt || reminder.createdAt || "") >=
        String(previous.updatedAt || previous.createdAt || ""))) {
      byVisit.set(key, reminder);
    }
  }

  const dateCell = (key, highlight = false) => ({
    value: key ? new Date(`${key}T00:00:00Z`) : null,
    type: Date,
    format: "dd/mm/yyyy",
    ...(highlight ? { fontWeight: "bold", backgroundColor: "#FFF0DB" } : {}),
  });
  const textCell = value => ({ value: String(value ?? ""), type: String, wrap: true });

  return [
    columns.map(({ label }) => ({ value: label, fontWeight: "bold", backgroundColor: "#1F2937", textColor: "#FFFFFF" })),
    ...visits.map(visit => columns.map(({ id }) => {
      if (id === "date") return dateCell(visit.date, true);
      if (id === "reminderDate") return dateCell(byVisit.get(String(visit.id))?.dueDate);
      return textCell(id === "visitValue" ? labelValue(visit.visitValue) : visit[id]);
    })),
  ];
}

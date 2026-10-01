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

export const visitSheetOptions = {
  sheet: "Visitas",
  stickyRowsCount: 1,
  stickyColumnsCount: 1,
  columns: [18, 30, 24, 24, 20, 24, 24, 16, 40, 40, 44, 36, 60, 18, 18, 20, 24]
    .map(width => ({ width })),
};

export function buildVisitSheet(visits, reminders, labelValue) {
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

  const headers = ["Fecha de visita", "Negocio", "Categoría", "Referente", "Teléfono",
    "Localidad", "Barrio/Zona", "Código postal", "Dirección", "Google Maps",
    "Tipo visita", "Valor", "Notas", "Latitud", "Longitud", "Precisión metros", "Fecha del recordatorio"];
  const dateCell = (key, highlight = false) => ({
    value: key ? new Date(`${key}T00:00:00Z`) : null,
    type: Date,
    format: "dd/mm/yyyy",
    ...(highlight ? { fontWeight: "bold", backgroundColor: "#FFF0DB" } : {}),
  });
  const textCell = value => ({ value: String(value ?? ""), type: String, wrap: true });

  return [
    headers.map(value => ({ value, fontWeight: "bold", backgroundColor: "#1F2937", textColor: "#FFFFFF" })),
    ...visits.map(visit => [
      dateCell(visit.date, true),
      ...[visit.businessName, visit.category, visit.contactName, visit.phone,
        visit.locality, visit.neighborhood, visit.postalCode, visit.address, visit.googleMaps,
        visit.visitType, labelValue(visit.visitValue), visit.notes,
        visit.latitude, visit.longitude, visit.locationAccuracy].map(textCell),
      dateCell(byVisit.get(String(visit.id))?.dueDate),
    ]),
  ];
}

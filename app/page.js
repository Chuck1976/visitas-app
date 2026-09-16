"use client";
import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { readSheet } from "read-excel-file/browser";

const STORAGE_KEY = "visitas_app_pro_v4";
const OLD_KEYS = ["visitas_app_pro_v3", "visitas_app_pro_v2"];

const valores = [
  { value: "malo", label: "Malo - no volver", color: "#ef4444" },
  { value: "normal", label: "Normal - pasar más adelante", color: "#f59e0b" },
  { value: "buena", label: "Buena - recontactar pronto", color: "#3b82f6" },
  { value: "muy_buena", label: "Muy buena - cita/listo para agendar", color: "#22c55e" },
];

const tiposVisita = [
  "Cliente potencial - Primera visita",
  "Cliente potencial - Cita/Demo/Presentación",
  "Ya cliente - Resolución de problemas/asesoramiento",
  "Ya cliente - Seguimiento/nuevas propuestas",
];

const REMINDER_PRESETS = {
  muy_buena: [
    { label: "3 días", days: 3 },
    { label: "7 días", days: 7 },
    { label: "10 días", days: 10 },
  ],
  buena: [
    { label: "2 semanas", weeks: 2 },
    { label: "4 semanas", weeks: 4 },
    { label: "6 semanas", weeks: 6 },
  ],
  normal: [
    { label: "3 meses", months: 3 },
    { label: "6 meses", months: 6 },
    { label: "9 meses", months: 9 },
  ],
};

const REMINDER_STATUS = {
  pending: "pending",
  done: "done",
  dismissed: "dismissed",
};

const LEAD_STATUS = {
  pending: "pending",
  visited: "visited",
  discarded: "discarded",
};

const EMPTY_VISIT_FORM = {
  businessName: "",
  category: "",
  contactName: "",
  phone: "",
  locality: "",
  neighborhood: "",
  postalCode: "",
  address: "",
  googleMaps: "",
  visitType: tiposVisita[0],
  notes: "",
  visitValue: "normal",
  sourceLeadId: "",
  sourceListId: "",
  linkedLeadIds: [],
  latitude: "",
  longitude: "",
  locationAccuracy: "",
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MOBILE_LAYOUT_QUERY = "(max-width: 850px), (max-device-width: 850px), (hover: none) and (pointer: coarse) and (max-width: 1200px)";

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDaysKey(key, days) {
  const date = parseKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function addWeeksKey(key, weeks) {
  return addDaysKey(key, weeks * 7);
}

function addMonthsKey(key, months) {
  const date = parseKey(key);
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, maxDay));
  return dateKey(target);
}

function suggestedReminderDateKey(baseDate, preset) {
  if (preset.days) return addDaysKey(baseDate, preset.days);
  if (preset.weeks) return addWeeksKey(baseDate, preset.weeks);
  if (preset.months) return addMonthsKey(baseDate, preset.months);
  return baseDate;
}

function reminderPresetsForValue(value) {
  return REMINDER_PRESETS[value] || [];
}

function visitCanHaveReminder(visit) {
  return reminderPresetsForValue(visit?.visitValue).length > 0;
}

function buildReminderFromVisit(visit, dueDate, existingReminder = null) {
  if (!visitCanHaveReminder(visit) || !dueDate) return null;

  const now = new Date().toISOString();

  return {
    id: existingReminder?.id || `reminder-${visit.id}-${Date.now()}`,
    sourceVisitId: visit.id,
    sourceVisitValue: visit.visitValue,
    status: existingReminder?.status || REMINDER_STATUS.pending,
    dueDate,
    businessName: visit.businessName || "",
    contactName: visit.contactName || "",
    locality: visit.locality || "",
    neighborhood: visit.neighborhood || "",
    postalCode: visit.postalCode || "",
    address: visit.address || "",
    originalVisitDate: visit.date,
    createdAt: existingReminder?.createdAt || now,
    updatedAt: now,
    completedAt: existingReminder?.completedAt || "",
    completedVisitId: existingReminder?.completedVisitId || "",
  };
}

function syncReminderSnapshotForVisit(currentReminders, visit) {
  const sourceMatches = reminder =>
    String(reminder.sourceVisitId) === String(visit.id);

  return currentReminders.map(reminder => {
    if (!sourceMatches(reminder)) return reminder;

    return {
      ...reminder,
      sourceVisitValue: visit.visitValue,
      businessName: visit.businessName || "",
      contactName: visit.contactName || "",
      locality: visit.locality || "",
      neighborhood: visit.neighborhood || "",
      postalCode: visit.postalCode || "",
      address: visit.address || "",
      originalVisitDate: visit.date,
      updatedAt: new Date().toISOString(),
    };
  });
}

function removePendingRemindersForVisit(currentReminders, visitId) {
  return currentReminders.filter(reminder =>
    String(reminder.sourceVisitId) !== String(visitId) ||
    reminder.status !== REMINDER_STATUS.pending
  );
}

function upsertPendingReminderForVisit(currentReminders, visit, dueDate) {
  const existingIndex = currentReminders.findIndex(reminder =>
    String(reminder.sourceVisitId) === String(visit.id) &&
    reminder.status === REMINDER_STATUS.pending
  );
  const existingReminder = existingIndex >= 0 ? currentReminders[existingIndex] : null;
  const reminder = buildReminderFromVisit(visit, dueDate, existingReminder);

  if (!reminder) return currentReminders;

  if (existingIndex >= 0) {
    return currentReminders.map((currentReminder, index) =>
      index === existingIndex ? reminder : currentReminder
    );
  }

  return [...currentReminders, reminder];
}

function completeReminderInList(currentReminders, reminderId, completedVisitId, completedAt) {
  if (!reminderId) return currentReminders;

  return currentReminders.map(reminder => {
    if (String(reminder.id) !== String(reminderId)) return reminder;

    return {
      ...reminder,
      status: REMINDER_STATUS.done,
      completedAt,
      completedVisitId,
      updatedAt: completedAt,
    };
  });
}

function normalizeData(data) {
  const visits = Array.isArray(data?.visits) ? data.visits : [];

  return {
    visits,
    closedDays: Array.isArray(data?.closedDays) ? data.closedDays : [],
    reminders: Array.isArray(data?.reminders) ? data.reminders : [],
    targetLists: Array.isArray(data?.targetLists) ? data.targetLists : [],
  };
}

function validateImportedData(data) {
  if (!data || !Array.isArray(data.visits) || !Array.isArray(data.closedDays)) {
    throw new Error("Estructura de backup no válida");
  }

  const visitsAreValid = data.visits.every(visit =>
    visit &&
    (typeof visit.id === "string" || typeof visit.id === "number") &&
    typeof visit.date === "string" &&
    DATE_KEY_PATTERN.test(visit.date) &&
    typeof visit.businessName === "string" &&
    visit.businessName.trim().length > 0
  );

  const closedDaysAreValid = data.closedDays.every(closedDay =>
    closedDay &&
    (typeof closedDay.id === "string" || typeof closedDay.id === "number") &&
    typeof closedDay.date === "string" &&
    DATE_KEY_PATTERN.test(closedDay.date) &&
    typeof closedDay.type === "string"
  );

  const hasImportedReminders = Array.isArray(data.reminders);
  const reminders = hasImportedReminders ? data.reminders : [];
  const remindersAreValid = reminders.every(reminder =>
    reminder &&
    (typeof reminder.id === "string" || typeof reminder.id === "number") &&
    (typeof reminder.sourceVisitId === "string" || typeof reminder.sourceVisitId === "number") &&
    typeof reminder.dueDate === "string" &&
    DATE_KEY_PATTERN.test(reminder.dueDate) &&
    typeof reminder.businessName === "string" &&
    [REMINDER_STATUS.pending, REMINDER_STATUS.done, REMINDER_STATUS.dismissed].includes(reminder.status)
  );

  const hasImportedTargetLists = Object.prototype.hasOwnProperty.call(data, "targetLists");
  const targetLists = hasImportedTargetLists ? data.targetLists : [];
  const targetListsAreValid = Array.isArray(targetLists) && targetLists.every(list =>
    list &&
    (typeof list.id === "string" || typeof list.id === "number") &&
    typeof list.name === "string" &&
    Array.isArray(list.leads) &&
    list.leads.every(lead =>
      lead &&
      (typeof lead.id === "string" || typeof lead.id === "number") &&
      typeof lead.businessName === "string"
    )
  );

  if (!visitsAreValid || !closedDaysAreValid || !remindersAreValid || !targetListsAreValid) {
    throw new Error("El backup contiene registros no válidos");
  }

  return normalizeData({
    visits: data.visits,
    closedDays: data.closedDays,
    ...(hasImportedReminders ? { reminders } : {}),
    ...(hasImportedTargetLists ? { targetLists } : {}),
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function loadData() {
  if (typeof window === "undefined") return normalizeData();

  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return normalizeData(JSON.parse(current));

    for (const key of OLD_KEYS) {
      const old = localStorage.getItem(key);
      if (old) return normalizeData(JSON.parse(old));
    }

    return normalizeData();
  } catch {
    return normalizeData();
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
}

function labelValue(value) {
  return valores.find(v => v.value === value)?.label || value;
}

function colorValue(value) {
  return valores.find(v => v.value === value)?.color || "#94a3b8";
}

function normalizeSearchText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function businessKey(visit) {
  const name = normalizeSearchText(visit.businessName);
  const postalCode = normalizeSearchText(visit.postalCode);
  const locality = normalizeSearchText(visit.locality);
  return [name, postalCode, locality].filter(Boolean).join("|");
}

function formatVisitDate(date) {
  if (!date) return "Sin fecha";
  return parseKey(date).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function reminderStatusLabel(status) {
  if (status === REMINDER_STATUS.done) return "Pasado";
  if (status === REMINDER_STATUS.dismissed) return "Descartado";
  return "Pendiente";
}

function reminderMatchesSearch(reminder, term, mode) {
  if (!term) return true;

  if (mode === "postalCode") {
    return normalizeSearchText(reminder.postalCode).includes(term);
  }

  const businessName = normalizeSearchText(reminder.businessName);
  return businessName.length > 0 && businessName.includes(term);
}

function leadStatusLabel(status) {
  if (status === LEAD_STATUS.visited) return "Visitado";
  if (status === LEAD_STATUS.discarded) return "Descartado";
  return "Pendiente";
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  return digits;
}

function uniqueIds(ids) {
  return [...new Set((ids || []).filter(Boolean).map(String))];
}

function extractPostalCode(...values) {
  const text = values.filter(Boolean).join(" ");
  return text.match(/\b(?:0[1-9]|[1-4]\d|5[0-2])\d{3}\b/)?.[0] || "";
}

function extractPhone(...values) {
  const text = values.filter(Boolean).join(" ");
  const match = text.match(/(?:\+34\s*)?(?:[6789]\s*\d){8}\b/);
  return match ? match[0].replace(/\s/g, "") : "";
}

function importColumnValue(row, acceptedHeaders) {
  const wanted = acceptedHeaders.map(normalizeSearchText);
  const entry = Object.entries(row || {}).find(([header]) =>
    wanted.includes(normalizeSearchText(header))
  );
  return entry ? String(entry[1] ?? "").trim() : "";
}

function importedLeadFromRow(row, id) {
  const businessName = importColumnValue(row, [
    "Negocio",
    "Nombre negocio",
    "Nombre del negocio",
    "Establecimiento",
    "Empresa",
  ]);
  const category = importColumnValue(row, ["Categoría", "Categoria", "Segmento", "Tipo", "Sector"]);
  const address = importColumnValue(row, ["Dirección", "Direccion", "Dirección aproximada", "Calle", "Domicilio"]);
  const locality = importColumnValue(row, ["Localidad", "Municipio", "Población", "Poblacion", "Ciudad"]);
  const postalCode = importColumnValue(row, ["Código postal", "Codigo postal", "CP", "Postal"]);
  const phone = importColumnValue(row, ["Teléfono", "Telefono", "Móvil", "Movil", "Tel", "Phone"]);
  const googleMaps = importColumnValue(row, [
    "Google Maps",
    "Enlace Google Maps",
    "Google Maps URL",
    "Maps",
    "Enlace Maps",
    "Mapa",
  ]);

  return {
    id,
    businessName,
    category,
    address,
    locality,
    postalCode: postalCode || extractPostalCode(address, locality),
    phone: phone || extractPhone(address, locality),
    googleMaps,
    status: LEAD_STATUS.pending,
    visitIds: [],
    createdAt: new Date().toISOString(),
  };
}

function rowsFromMatrix(matrix) {
  const [headerRow, ...dataRows] = matrix || [];
  if (!Array.isArray(headerRow) || headerRow.length === 0) return [];

  const headers = headerRow.map(header => String(header ?? "").trim());
  return dataRows
    .filter(row => Array.isArray(row) && row.some(value => String(value ?? "").trim()))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function csvRows(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes("\t")
    ? "\t"
    : firstLine.split(";").length > firstLine.split(",").length
      ? ";"
      : ",";
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(value.trim());
      value = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(cell => cell)) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += character;
  }

  row.push(value.trim());
  if (row.some(cell => cell)) rows.push(row);
  return rows;
}

function leadKey(lead) {
  const name = normalizeSearchText(lead.businessName);
  const phone = normalizePhone(lead.phone);
  const address = normalizeSearchText(lead.address);
  const locality = normalizeSearchText(lead.locality);
  const postalCode = normalizeSearchText(lead.postalCode);
  const googleMaps = String(lead.googleMaps || "").trim();
  return [name, phone, address, postalCode, locality, googleMaps]
    .filter(Boolean)
    .join("|");
}

const GENERIC_BUSINESS_NAME_TOKENS = new Set([
  "barber", "barberia", "barbero", "belleza", "canina", "centro", "clinica",
  "dog", "estetica", "estilista", "fisioterapia", "hair", "nail", "nails",
  "peluqueria", "peluquero", "pet", "salon", "spa", "unas",
]);

function businessNameTokens(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function businessNamesClearlyMatch(firstName, secondName) {
  const firstTokens = businessNameTokens(firstName);
  const secondTokens = businessNameTokens(secondName);
  const firstComparable = firstTokens.join(" ");
  const secondComparable = secondTokens.join(" ");

  if (!firstComparable || !secondComparable) return false;
  if (firstComparable === secondComparable) return true;

  const [shorter, longer] = firstTokens.length <= secondTokens.length
    ? [firstTokens, secondTokens]
    : [secondTokens, firstTokens];
  const distinctiveTokens = shorter.filter(token =>
    token.length >= 3 && !GENERIC_BUSINESS_NAME_TOKENS.has(token)
  );

  return distinctiveTokens.length > 0 &&
    distinctiveTokens.every(token => longer.includes(token)) &&
    (distinctiveTokens.length >= 2 || distinctiveTokens[0].length >= 5);
}

function visitLeadMatchReasons(visit, lead) {
  const visitName = normalizeSearchText(visit.businessName);
  const visitPhone = normalizePhone(visit.phone);
  const visitAddress = normalizeSearchText(visit.address);
  const visitPostalCode = normalizeSearchText(visit.postalCode);
  const visitLocality = normalizeSearchText(visit.locality);
  const leadName = normalizeSearchText(lead.businessName);
  const leadPhone = normalizePhone(lead.phone);
  const leadAddress = normalizeSearchText(lead.address);
  const leadPostalCode = normalizeSearchText(lead.postalCode);
  const leadLocality = normalizeSearchText(lead.locality);

  if (!visitName && !visitPhone && !visitAddress) return [];

  const reasons = [];
  const sameName = businessNamesClearlyMatch(visit.businessName, lead.businessName);
  const exactName = Boolean(visitName && leadName && visitName === leadName);

  if (sameName) {
    reasons.push(exactName ? "nombre" : "nombre equivalente");
  }

  if (visitPhone.length >= 9 && leadPhone.length >= 9 && visitPhone === leadPhone) {
    reasons.push("teléfono");
  }
  if (sameName && visitAddress && leadAddress && visitAddress === leadAddress) {
    reasons.push("nombre y dirección");
  }
  if (sameName && visitPostalCode && leadPostalCode && visitPostalCode === leadPostalCode) {
    reasons.push("nombre y código postal");
  }
  if (sameName && visitLocality && leadLocality && visitLocality === leadLocality) {
    reasons.push("nombre y localidad");
  }

  return reasons;
}

function mapSearchUrl(record) {
  const savedUrl = String(record?.googleMaps || "").trim();
  if (/^https?:\/\//i.test(savedUrl)) return savedUrl;

  const query = [record?.businessName, record?.address, record?.postalCode, record?.locality]
    .filter(Boolean)
    .join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : "";
}

function mapDirectionsUrl(record) {
  const query = [record?.businessName, record?.address, record?.postalCode, record?.locality]
    .filter(Boolean)
    .join(", ");
  return query ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}` : mapSearchUrl(record);
}

function makeCalendarDays(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = (first.getDay() + 6) % 7;
  const days = [];

  for (let i = 0; i < startOffset; i++) {
    days.push(new Date(year, month, 1 - startOffset + i));
  }

  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

  while (days.length % 7 !== 0) {
    const lastDay = days[days.length - 1];
    days.push(new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1));
  }

  return days;
}

export default function App() {
  const today = new Date();
  const todayKey = dateKey(today);
  const importInputRef = useRef(null);
  const leadImportInputRef = useRef(null);
  const calendarRef = useRef(null);
  const summaryRef = useRef(null);

  const [visits, setVisits] = useState([]);
  const [closedDays, setClosedDays] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [targetLists, setTargetLists] = useState([]);
  const [monthDate, setMonthDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const [showForm, setShowForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [openVisit, setOpenVisit] = useState(null);
  const [openBusiness, setOpenBusiness] = useState(null);
  const [editingVisitId, setEditingVisitId] = useState(null);
  const [activeReminderId, setActiveReminderId] = useState(null);
  const [openClosedDay, setOpenClosedDay] = useState(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [showTargetLists, setShowTargetLists] = useState(false);
  const [openTargetListId, setOpenTargetListId] = useState(null);
  const [newTargetListName, setNewTargetListName] = useState("");
  const [leadImportMessage, setLeadImportMessage] = useState("");
  const [leadSearchTerm, setLeadSearchTerm] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");
  const [pendingLeadMatch, setPendingLeadMatch] = useState(null);
  const [openLeadVisits, setOpenLeadVisits] = useState(null);

  const [form, setForm] = useState({ ...EMPTY_VISIT_FORM });
  const [pendingVisitSave, setPendingVisitSave] = useState(null);
  const [reminderMonthDate, setReminderMonthDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [reminderSelectedDate, setReminderSelectedDate] = useState(todayKey);
  const [reminderToReschedule, setReminderToReschedule] = useState(null);
  const [searchScope, setSearchScope] = useState("visits");
  const [searchMode, setSearchMode] = useState("businessName");
  const [searchTerm, setSearchTerm] = useState("");
  const [reminderSearchFilter, setReminderSearchFilter] = useState("pending");
  const [showBadSearchResults, setShowBadSearchResults] = useState(false);

  const [closeForm, setCloseForm] = useState({
    type: "Día completo",
    reason: "",
  });

  const activeModalKey = pendingLeadMatch
    ? "lead-match"
    : openLeadVisits
      ? "lead-visits"
    : pendingVisitSave
      ? "reminder-schedule"
    : reminderToReschedule
      ? "reminder-reschedule"
    : openClosedDay
      ? "closed-day"
      : openBusiness
        ? "business"
        : showSearch
          ? "search"
          : openVisit
            ? "visit-details"
            : showCloseForm
              ? "close-day"
              : showForm
                ? "visit-form"
                : showTargetLists
                  ? "target-lists"
                  : "";
  const hasOpenModal = Boolean(activeModalKey);

  useEffect(() => {
    if (!hasOpenModal) return;

    const root = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };

    function syncVisibleViewport() {
      const viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const offsetTop = viewport?.offsetTop || 0;
      const offsetLeft = viewport?.offsetLeft || 0;

      root.style.setProperty("--visible-viewport-width", `${width}px`);
      root.style.setProperty("--visible-viewport-height", `${height}px`);
      root.style.setProperty("--visible-viewport-top", `${offsetTop}px`);
      root.style.setProperty("--visible-viewport-left", `${offsetLeft}px`);
    }

    syncVisibleViewport();
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    window.addEventListener("resize", syncVisibleViewport);
    window.visualViewport?.addEventListener("resize", syncVisibleViewport);
    window.visualViewport?.addEventListener("scroll", syncVisibleViewport);

    return () => {
      window.removeEventListener("resize", syncVisibleViewport);
      window.visualViewport?.removeEventListener("resize", syncVisibleViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisibleViewport);

      Object.entries(previousBodyStyles).forEach(([property, value]) => {
        body.style[property] = value;
      });

      root.style.removeProperty("--visible-viewport-width");
      root.style.removeProperty("--visible-viewport-height");
      root.style.removeProperty("--visible-viewport-top");
      root.style.removeProperty("--visible-viewport-left");
      window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
    };
  }, [hasOpenModal]);

  useEffect(() => {
    if (!activeModalKey) return;

    const frame = window.requestAnimationFrame(() => {
      const modals = document.querySelectorAll(".modal");
      const activeModal = modals[modals.length - 1];
      const activeBox = activeModal?.querySelector(".box");

      if (activeModal) activeModal.scrollTop = 0;
      if (activeBox) activeBox.scrollTop = 0;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeModalKey]);

  useEffect(() => {
    function refreshData() {
      const data = loadData();
      setVisits(data.visits);
      setClosedDays(data.closedDays);
      setReminders(data.reminders);
      setTargetLists(data.targetLists);
    }

    function refreshVisibleData() {
      if (document.visibilityState === "visible") refreshData();
    }

    refreshData();
    window.addEventListener("focus", refreshData);
    document.addEventListener("visibilitychange", refreshVisibleData);

    return () => {
      window.removeEventListener("focus", refreshData);
      document.removeEventListener("visibilitychange", refreshVisibleData);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let refreshing = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    if ("caches" in window) {
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(key => key.startsWith("visitas-pro-app-"))
              .map(key => caches.delete(key))
          )
        )
        .catch(() => undefined);
    }

    navigator.serviceWorker.register("/sw.js").then(registration => {
      registration.update().catch(() => undefined);

      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    }).catch(() => {
      // La app sigue funcionando aunque el móvil no permita instalarla como PWA.
    });
  }, []);

  useEffect(() => {
    if (!window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return;

    const frame = window.requestAnimationFrame(() => {
      const viewport = calendarRef.current;
      const selectedDay = viewport?.querySelector(`[data-date-key="${selectedDate}"]`);
      if (!viewport || !selectedDay) return;

      const centeredLeft = selectedDay.offsetLeft
        - (viewport.clientWidth - selectedDay.offsetWidth) / 2;

      viewport.scrollTo({
        left: Math.max(0, centeredLeft),
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, monthDate]);

  const days = useMemo(() => makeCalendarDays(monthDate), [monthDate]);
  const reminderCalendarDays = useMemo(() => makeCalendarDays(reminderMonthDate), [reminderMonthDate]);
  const reminderPresetOptions = pendingVisitSave
    ? reminderPresetsForValue(pendingVisitSave.visit.visitValue)
    : [];

  const activeReminders = useMemo(() => {
    return reminders.filter(reminder => reminder.status === REMINDER_STATUS.pending);
  }, [reminders]);

  const visitsByDay = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      if (!map[v.date]) map[v.date] = [];
      map[v.date].push(v);
    });
    return map;
  }, [visits]);

  const remindersByDay = useMemo(() => {
    const map = {};
    activeReminders.forEach(reminder => {
      if (!map[reminder.dueDate]) map[reminder.dueDate] = [];
      map[reminder.dueDate].push(reminder);
    });
    return map;
  }, [activeReminders]);

  const closedByDay = useMemo(() => {
    const map = {};
    closedDays.forEach(c => {
      map[c.date] = c;
    });
    return map;
  }, [closedDays]);

  const selectedVisits = visits.filter(v => v.date === selectedDate);
  const selectedReminders = remindersByDay[selectedDate] || [];
  const selectedClosed = closedByDay[selectedDate];
  const activeTargetList = targetLists.find(list => String(list.id) === String(openTargetListId)) || null;
  const visibleTargetLeads = activeTargetList
    ? activeTargetList.leads.filter(lead => {
        const status = lead.status || LEAD_STATUS.pending;
        const term = normalizeSearchText(leadSearchTerm);
        const matchesStatus = leadStatusFilter === "all" || status === leadStatusFilter;
        const matchesSearch = !term || [
          lead.businessName,
          lead.category,
          lead.address,
          lead.locality,
          lead.postalCode,
          lead.phone,
        ].some(value => normalizeSearchText(value).includes(term));
        return matchesStatus && matchesSearch;
      })
    : [];

  const searchResults = useMemo(() => {
    const term = normalizeSearchText(searchTerm);
    if (!term) return [];

    const filtered = visits.filter(visit => {
      if (!showBadSearchResults && visit.visitValue === "malo") {
        return false;
      }

      if (searchMode === "postalCode") {
        return normalizeSearchText(visit.postalCode).includes(term);
      }

      const businessName = normalizeSearchText(visit.businessName);
      return businessName.length > 0 && businessName.includes(term);
    });

    const grouped = new Map();

    filtered.forEach(visit => {
      const key = businessKey(visit) || String(visit.id);
      const current = grouped.get(key);

      if (current) {
        current.visits.push(visit);
      } else {
        grouped.set(key, { key, visits: [visit] });
      }
    });

    return Array.from(grouped.values())
      .map(group => {
        const sortedVisits = [...group.visits].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const latestVisit = sortedVisits[0];

        return {
          ...group,
          visits: sortedVisits,
          latestVisit,
          totalVisits: sortedVisits.length,
        };
      })
      .sort((a, b) => String(b.latestVisit.date).localeCompare(String(a.latestVisit.date)));
  }, [searchMode, searchTerm, showBadSearchResults, visits]);

  const reminderSearchResults = (() => {
    const term = normalizeSearchText(searchTerm);

    return reminders
      .filter(reminder => {
        if (reminderSearchFilter === "pending" && reminder.status !== REMINDER_STATUS.pending) {
          return false;
        }

        if (
          reminderSearchFilter === "overdue" &&
          !(reminder.status === REMINDER_STATUS.pending && String(reminder.dueDate) < String(todayKey))
        ) {
          return false;
        }

        return reminderMatchesSearch(reminder, term, searchMode);
      })
      .sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === REMINDER_STATUS.pending ? -1 : 1;
        }

        return String(a.dueDate).localeCompare(String(b.dueDate));
      });
  })();

  function persist(
    updatedVisits,
    updatedClosedDays,
    updatedReminders = reminders,
    updatedTargetLists = targetLists
  ) {
    saveData({
      visits: updatedVisits,
      closedDays: updatedClosedDays,
      reminders: updatedReminders,
      targetLists: updatedTargetLists,
    });
  }

  function openTargetList(listId) {
    setOpenTargetListId(listId);
    setLeadImportMessage("");
    setLeadSearchTerm("");
    setLeadStatusFilter("all");
  }

  function createTargetList(e) {
    e.preventDefault();
    const name = newTargetListName.trim();
    if (!name) return;

    const exists = targetLists.some(list => normalizeSearchText(list.name) === normalizeSearchText(name));
    if (exists) {
      setLeadImportMessage("Ya existe una lista con ese nombre.");
      return;
    }

    const newList = {
      id: `target-list-${Date.now()}`,
      name,
      createdAt: new Date().toISOString(),
      leads: [],
    };
    const updatedTargetLists = [...targetLists, newList];

    setTargetLists(updatedTargetLists);
    persist(visits, closedDays, reminders, updatedTargetLists);
    setNewTargetListName("");
    setLeadImportMessage("");
    openTargetList(newList.id);
  }

  function deleteTargetList(list) {
    if (!window.confirm(`¿Eliminar la lista “${list.name}” y sus ${list.leads.length} leads?`)) return;

    const updatedTargetLists = targetLists.filter(currentList => String(currentList.id) !== String(list.id));
    setTargetLists(updatedTargetLists);
    persist(visits, closedDays, reminders, updatedTargetLists);
    setOpenTargetListId(null);
    setLeadImportMessage("");
  }

  function updateLeadStatus(listId, leadId, status) {
    const now = new Date().toISOString();
    const updatedTargetLists = targetLists.map(list => {
      if (String(list.id) !== String(listId)) return list;

      return {
        ...list,
        leads: list.leads.map(lead => {
          if (String(lead.id) !== String(leadId)) return lead;
          return {
            ...lead,
            status,
            visitedAt: status === LEAD_STATUS.visited ? (lead.visitedAt || now) : lead.visitedAt,
            updatedAt: now,
          };
        }),
      };
    });

    setTargetLists(updatedTargetLists);
    persist(visits, closedDays, reminders, updatedTargetLists);
  }

  function leadsAfterVisit(targetListsToUpdate, visit, leadIds) {
    const idsToMark = new Set(uniqueIds(leadIds));
    if (idsToMark.size === 0) return targetListsToUpdate;

    const now = new Date().toISOString();
    return targetListsToUpdate.map(list => ({
      ...list,
      leads: list.leads.map(lead => {
        if (!idsToMark.has(String(lead.id))) return lead;

        return {
          ...lead,
          status: LEAD_STATUS.visited,
          visitedAt: lead.visitedAt || now,
          visitIds: uniqueIds([...(lead.visitIds || []), visit.id]),
          updatedAt: now,
        };
      }),
    }));
  }

  function leadsAfterDeletingVisit(targetListsToUpdate, visitId) {
    return targetListsToUpdate.map(list => ({
      ...list,
      leads: list.leads.map(lead => {
        const visitIds = uniqueIds(lead.visitIds || []).filter(id => String(id) !== String(visitId));
        if (visitIds.length === (lead.visitIds || []).length) return lead;

        return {
          ...lead,
          visitIds,
          status: visitIds.length === 0 && lead.status === LEAD_STATUS.visited
            ? LEAD_STATUS.pending
            : lead.status,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  }

  function matchingLeadsForVisit(visit) {
    return targetLists.flatMap(list =>
      (list.leads || [])
        .filter(lead => (lead.status || LEAD_STATUS.pending) === LEAD_STATUS.pending)
        .map(lead => {
          const reasons = visitLeadMatchReasons(visit, lead);

          return reasons.length ? { listId: list.id, listName: list.name, lead, reasons } : null;
        })
        .filter(Boolean)
    );
  }

  function matchingVisitsForLead(lead) {
    return visits
      .map(visit => {
        const reasons = visitLeadMatchReasons(visit, lead);
        return reasons.length ? { visit, reasons } : null;
      })
      .filter(Boolean);
  }

  function reconcileTargetListWithVisitHistory(list) {
    let matchedLeads = 0;
    const now = new Date().toISOString();
    const updatedTargetLists = targetLists.map(currentList => {
      if (String(currentList.id) !== String(list.id)) return currentList;

      return {
        ...currentList,
        leads: currentList.leads.map(lead => {
          if ((lead.status || LEAD_STATUS.pending) !== LEAD_STATUS.pending) return lead;

          const matchingVisits = matchingVisitsForLead(lead);
          if (matchingVisits.length === 0) return lead;

          matchedLeads += 1;
          return {
            ...lead,
            status: LEAD_STATUS.visited,
            visitedAt: now,
            visitIds: uniqueIds([...(lead.visitIds || []), ...matchingVisits.map(match => match.visit.id)]),
            updatedAt: now,
          };
        }),
      };
    });

    setTargetLists(updatedTargetLists);
    persist(visits, closedDays, reminders, updatedTargetLists);
    setLeadImportMessage(
      matchedLeads
        ? `Cruce terminado: ${matchedLeads} ${matchedLeads === 1 ? "lead marcado como visitado" : "leads marcados como visitados"} por el historial.`
        : "Cruce terminado: no hay coincidencias claras con el historial de visitas."
    );
  }

  function continueVisitSave(pendingSave) {
    if (!visitCanHaveReminder(pendingSave.visit)) {
      finishVisitSave(pendingSave);
      return;
    }

    startReminderSchedule(pendingSave);
  }

  function openVisitFromLead(list, lead) {
    setEditingVisitId(null);
    setActiveReminderId(null);
    setSelectedDate(todayKey);
    setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setForm({
      ...EMPTY_VISIT_FORM,
      businessName: lead.businessName || "",
      category: lead.category || "",
      phone: lead.phone || "",
      locality: lead.locality || "",
      postalCode: lead.postalCode || "",
      address: lead.address || "",
      googleMaps: lead.googleMaps || "",
      sourceLeadId: String(lead.id),
      sourceListId: String(list.id),
      linkedLeadIds: [String(lead.id)],
    });
    setLocationStatus("");
    setShowTargetLists(false);
    setShowForm(true);
  }

  function openVisitsForLead(list, lead) {
    const recordedVisitIds = new Set(uniqueIds(lead.visitIds || []).map(String));
    const leadVisits = visits
      .filter(visit => {
        const linkedIds = uniqueIds([...(visit.linkedLeadIds || []), visit.sourceLeadId]);
        return linkedIds.includes(String(lead.id)) || recordedVisitIds.has(String(visit.id));
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    setOpenLeadVisits({ listId: list.id, listName: list.name, lead, visits: leadVisits });
    setShowTargetLists(false);
  }

  async function importLeadsFile(e) {
    const file = e.target.files?.[0];
    const listId = openTargetListId;
    if (!file || !listId) return;

    if (file.size > 5 * 1024 * 1024) {
      setLeadImportMessage("El archivo es demasiado grande (máximo 5 MB).");
      e.target.value = "";
      return;
    }

    try {
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
      if (!isCsv && !isXlsx) {
        throw new Error("unsupported-file");
      }

      const matrix = isCsv
        ? csvRows(await file.text())
        : await readSheet(file);
      const rows = rowsFromMatrix(matrix);

      if (rows.length === 0) throw new Error("empty");

      const targetList = targetLists.find(list => String(list.id) === String(listId));
      if (!targetList) throw new Error("missing-list");

      const existingKeys = new Set(targetList.leads.map(leadKey).filter(Boolean));
      const importedLeads = [];
      let skipped = 0;
      let excludedOutOfZone = 0;
      let matchedExistingLeads = 0;

      rows.forEach((row, index) => {
        const review = normalizeSearchText(importColumnValue(row, ["Revisión", "Revision"]));
        if (review === "fuera de zona") {
          excludedOutOfZone += 1;
          return;
        }

        const lead = importedLeadFromRow(row, `lead-${Date.now()}-${index}`);
        const key = leadKey(lead);
        if (!lead.businessName) {
          skipped += 1;
          return;
        }
        if (key && existingKeys.has(key)) {
          skipped += 1;
          return;
        }

        const matchingVisits = matchingVisitsForLead(lead);
        if (matchingVisits.length > 0) {
          const now = new Date().toISOString();
          lead.status = LEAD_STATUS.visited;
          lead.visitedAt = now;
          lead.visitIds = uniqueIds(matchingVisits.map(match => match.visit.id));
          lead.updatedAt = now;
          matchedExistingLeads += 1;
        }

        if (key) existingKeys.add(key);
        importedLeads.push(lead);
      });

      if (importedLeads.length === 0) {
        setLeadImportMessage(
          excludedOutOfZone
            ? `No se han importado leads nuevos. ${excludedOutOfZone} fuera de zona excluido${excludedOutOfZone === 1 ? "" : "s"}.`
            : "No se han encontrado leads nuevos. Revisa que exista la columna Negocio."
        );
        return;
      }

      const updatedTargetLists = targetLists.map(list =>
        String(list.id) === String(listId)
          ? {
              ...list,
              leads: [...list.leads, ...importedLeads],
              lastImportedAt: new Date().toISOString(),
              lastImportedFileName: file.name,
            }
          : list
      );

      setTargetLists(updatedTargetLists);
      persist(visits, closedDays, reminders, updatedTargetLists);
      setLeadImportMessage(
        `${importedLeads.length} ${importedLeads.length === 1 ? "lead importado" : "leads importados"}${matchedExistingLeads ? ` · ${matchedExistingLeads} ${matchedExistingLeads === 1 ? "marcado como visitado por el historial" : "marcados como visitados por el historial"}` : ""}${excludedOutOfZone ? ` · ${excludedOutOfZone} fuera de zona excluido${excludedOutOfZone === 1 ? "" : "s"}` : ""}${skipped ? ` · ${skipped} omitido${skipped === 1 ? "" : "s"}` : ""}.`
      );
    } catch {
      setLeadImportMessage("No se pudo leer el archivo. Usa un Excel .xlsx o CSV con la columna Negocio.");
    } finally {
      e.target.value = "";
    }
  }

  function startReminderSchedule(pendingSave) {
    const presets = reminderPresetsForValue(pendingSave.visit.visitValue);
    const defaultDate = suggestedReminderDateKey(pendingSave.visit.date, presets[0]);

    setPendingVisitSave(pendingSave);
    setReminderSelectedDate(defaultDate);
    setReminderMonthDate(new Date(parseKey(defaultDate).getFullYear(), parseKey(defaultDate).getMonth(), 1));
  }

  function cancelReminderSchedule() {
    setPendingVisitSave(null);
  }

  function finishVisitSave(pendingSave, dueDate = "") {
    let updatedReminders = pendingSave.reminders;
    const updatedTargetLists = pendingSave.targetLists || targetLists;

    if (dueDate) {
      updatedReminders = upsertPendingReminderForVisit(updatedReminders, pendingSave.visit, dueDate);
    }

    updatedReminders = completeReminderInList(
      updatedReminders,
      pendingSave.completedReminderId,
      pendingSave.visit?.id,
      pendingSave.completedAt
    );

    setVisits(pendingSave.visits);
    setReminders(updatedReminders);
    setTargetLists(updatedTargetLists);
    persist(pendingSave.visits, closedDays, updatedReminders, updatedTargetLists);
    setPendingVisitSave(null);
    closeVisitForm();
  }

  function confirmReminderSchedule() {
    if (!pendingVisitSave || !reminderSelectedDate) return;
    finishVisitSave(pendingVisitSave, reminderSelectedDate);
  }

  function confirmLeadMatches() {
    if (!pendingLeadMatch) return;

    const selectedLeadIds = uniqueIds(pendingLeadMatch.selectedLeadIds);
    const linkedVisit = {
      ...pendingLeadMatch.pendingSave.visit,
      linkedLeadIds: uniqueIds([
        ...(pendingLeadMatch.pendingSave.visit.linkedLeadIds || []),
        ...selectedLeadIds,
      ]),
    };
    const updatedVisits = pendingLeadMatch.pendingSave.visits.map(visit =>
      String(visit.id) === String(linkedVisit.id) ? linkedVisit : visit
    );
    const updatedTargetLists = leadsAfterVisit(targetLists, linkedVisit, selectedLeadIds);

    setPendingLeadMatch(null);
    continueVisitSave({
      ...pendingLeadMatch.pendingSave,
      visits: updatedVisits,
      visit: linkedVisit,
      targetLists: updatedTargetLists,
    });
  }

  function skipLeadMatches() {
    if (!pendingLeadMatch) return;
    const pendingSave = pendingLeadMatch.pendingSave;
    setPendingLeadMatch(null);
    continueVisitSave(pendingSave);
  }

  function closeVisitForm() {
    setShowForm(false);
    setEditingVisitId(null);
    setActiveReminderId(null);
    setPendingVisitSave(null);
    setForm({ ...EMPTY_VISIT_FORM });
    setLocationStatus("");
  }

  function openNewVisitForm() {
    setEditingVisitId(null);
    setActiveReminderId(null);
    setForm({ ...EMPTY_VISIT_FORM });
    setLocationStatus("");
    setShowForm(true);
  }

  function selectCalendarDay(key) {
    setSelectedDate(key);

    if (!window.matchMedia(MOBILE_LAYOUT_QUERY).matches) return;

    window.requestAnimationFrame(() => {
      summaryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function scrollToCalendar() {
    calendarRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function openVisitFromReminder(reminder) {
    setEditingVisitId(null);
    setActiveReminderId(reminder.id);
    setSelectedDate(todayKey);
    setForm({
      ...EMPTY_VISIT_FORM,
      businessName: reminder.businessName || "",
      contactName: reminder.contactName || "",
      locality: reminder.locality || "",
      neighborhood: reminder.neighborhood || "",
      postalCode: reminder.postalCode || "",
      address: reminder.address || "",
      visitType: tiposVisita[1],
    });
    setLocationStatus("");
    setOpenVisit(null);
    setOpenBusiness(null);
    setShowSearch(false);
    setShowForm(true);
  }

  async function reverseGeocode(latitude, longitude) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1&accept-language=es`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("No se pudo traducir la ubicación.");

    const data = await response.json();
    const address = data.address || {};

    return {
      locality:
        address.city ||
        address.town ||
        address.village ||
        address.municipality ||
        address.county ||
        "",
            neighborhood:
        address.neighbourhood ||
        address.suburb ||
        address.quarter ||
        address.city_district ||
        address.district ||
        "",
      postalCode: address.postcode || "",
      addressText:
        data.display_name ||
        [
          address.road,
          address.house_number,
          address.postcode,
          address.city || address.town || address.village,
        ].filter(Boolean).join(", "),
    };
  }

  function getCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("Este navegador no permite geolocalización.");
      return;
    }

    setLocationStatus("Buscando ubicación...");

    navigator.geolocation.getCurrentPosition(
      async position => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const accuracy = Math.round(position.coords.accuracy);

        setForm(prev => ({
          ...prev,
          latitude,
          longitude,
          locationAccuracy: accuracy,
        }));

        try {
          setLocationStatus("Ubicación encontrada. Traduciendo dirección...");
          const geo = await reverseGeocode(latitude, longitude);

          setForm(prev => ({
            ...prev,
            latitude,
            longitude,
            locationAccuracy: accuracy,
            locality: prev.locality || geo.locality,
            neighborhood: prev.neighborhood || geo.neighborhood,
            postalCode: prev.postalCode || geo.postalCode,
            address: prev.address || geo.addressText,
          }));

          setLocationStatus("Ubicación y dirección guardadas correctamente.");
        } catch {
          setLocationStatus("Ubicación guardada, pero no se pudo obtener localidad/barrio.");
        }
      },
      () => {
        setLocationStatus("No se pudo obtener la ubicación. Revisa permisos del navegador.");
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  }

  function addVisit(e) {
    e.preventDefault();

    const now = new Date().toISOString();

    if (editingVisitId) {
      let editedVisit = null;
      const updatedVisits = visits.map(v => {
        if (v.id !== editingVisitId) return v;

        editedVisit = {
          ...v,
          ...form,
          updatedAt: now,
        };

        return editedVisit;
      });

      let updatedReminders = editedVisit
        ? syncReminderSnapshotForVisit(reminders, editedVisit)
        : reminders;

      if (!editedVisit) {
        closeVisitForm();
        return;
      }

      if (!visitCanHaveReminder(editedVisit)) {
        updatedReminders = removePendingRemindersForVisit(updatedReminders, editedVisit.id);
        finishVisitSave({
          visits: updatedVisits,
          reminders: updatedReminders,
          visit: editedVisit,
          completedAt: now,
          targetLists,
        });
        return;
      }

      startReminderSchedule({
        visits: updatedVisits,
        reminders: updatedReminders,
        visit: editedVisit,
        completedAt: now,
        targetLists,
      });
      return;
    }

    const newVisit = {
      id: Date.now(),
      date: selectedDate,
      createdAt: now,
      ...form,
    };

    let pendingSave = {
      visits: [...visits, newVisit],
      reminders,
      visit: newVisit,
      completedReminderId: activeReminderId,
      completedAt: now,
      targetLists,
    };

    const sourceLeadIds = uniqueIds([...(newVisit.linkedLeadIds || []), newVisit.sourceLeadId]);
    if (sourceLeadIds.length > 0) {
      pendingSave = {
        ...pendingSave,
        targetLists: leadsAfterVisit(targetLists, newVisit, sourceLeadIds),
      };
      continueVisitSave(pendingSave);
      return;
    }

    const matchingLeads = matchingLeadsForVisit(newVisit);
    if (matchingLeads.length > 0) {
      setPendingLeadMatch({
        pendingSave,
        matches: matchingLeads,
        selectedLeadIds: matchingLeads.map(match => String(match.lead.id)),
      });
      return;
    }

    continueVisitSave(pendingSave);
  }

  function closeDay(e) {
    e.preventDefault();

    const newClosed = {
      id: Date.now(),
      date: selectedDate,
      ...closeForm,
    };

    const updatedClosedDays = [
      ...closedDays.filter(c => c.date !== selectedDate),
      newClosed,
    ];

    setClosedDays(updatedClosedDays);
    persist(visits, updatedClosedDays, reminders);

    setCloseForm({ type: "Día completo", reason: "" });
    setShowCloseForm(false);
  }
    function editVisit(visit) {
  setEditingVisitId(visit.id);
  setActiveReminderId(null);

  setForm({
    businessName: visit.businessName || "",
    category: visit.category || "",
    contactName: visit.contactName || "",
    phone: visit.phone || "",
    locality: visit.locality || "",
    neighborhood: visit.neighborhood || "",
    postalCode: visit.postalCode || "",
    address: visit.address || "",
    googleMaps: visit.googleMaps || "",
    visitType: visit.visitType || tiposVisita[0],
    notes: visit.notes || "",
    visitValue: visit.visitValue || "normal",
    sourceLeadId: visit.sourceLeadId || "",
    sourceListId: visit.sourceListId || "",
    linkedLeadIds: uniqueIds(visit.linkedLeadIds || []),
    latitude: visit.latitude || "",
    longitude: visit.longitude || "",
    locationAccuracy: visit.locationAccuracy || "",
  });

  setSelectedDate(visit.date);
  setOpenVisit(null);
  setOpenBusiness(null);
  setShowForm(true);
}
  function deleteVisit(id) {
    if (!window.confirm("¿Seguro que quieres eliminar esta visita?")) return;

    const updated = visits.filter(v => v.id !== id);
    const updatedReminders = reminders.filter(reminder =>
      String(reminder.sourceVisitId) !== String(id)
    );
    const updatedTargetLists = leadsAfterDeletingVisit(targetLists, id);
    setVisits(updated);
    setReminders(updatedReminders);
    setTargetLists(updatedTargetLists);
    persist(updated, closedDays, updatedReminders, updatedTargetLists);
    setOpenVisit(null);
  }

  function updateReminderStatus(id, status, extra = {}) {
    const updatedReminders = reminders.map(reminder => {
      if (String(reminder.id) !== String(id)) return reminder;

      return {
        ...reminder,
        ...extra,
        status,
        updatedAt: new Date().toISOString(),
      };
    });

    setReminders(updatedReminders);
    persist(visits, closedDays, updatedReminders);
  }

  function markReminderDone(reminder) {
    updateReminderStatus(reminder.id, REMINDER_STATUS.done, {
      completedAt: new Date().toISOString(),
    });
  }

  function dismissReminder(reminder) {
    updateReminderStatus(reminder.id, REMINDER_STATUS.dismissed);
  }

  function openReminderReschedule(reminder) {
    if (reminder.status !== REMINDER_STATUS.pending) return;

    const sourceVisit = visits.find(visit =>
      String(visit.id) === String(reminder.sourceVisitId)
    );
    const dueDate = reminder.dueDate || todayKey;
    const parsedDueDate = parseKey(dueDate);

    setReminderToReschedule({
      ...reminder,
      originalVisitDate: reminder.originalVisitDate || sourceVisit?.date || "",
    });
    setReminderSelectedDate(dueDate);
    setReminderMonthDate(new Date(parsedDueDate.getFullYear(), parsedDueDate.getMonth(), 1));
    setShowSearch(false);
  }

  function saveRescheduledReminder() {
    if (!reminderToReschedule || !reminderSelectedDate) return;

    const updatedAt = new Date().toISOString();
    const updatedReminders = reminders.map(reminder =>
      String(reminder.id) === String(reminderToReschedule.id)
        ? { ...reminder, dueDate: reminderSelectedDate, updatedAt }
        : reminder
    );

    setReminders(updatedReminders);
    persist(visits, closedDays, updatedReminders);
    setReminderToReschedule(null);
  }

  function deleteReminder(reminder) {
    if (!window.confirm("¿Seguro que quieres eliminar este recordatorio?")) return;

    const updatedReminders = reminders.filter(currentReminder =>
      String(currentReminder.id) !== String(reminder.id)
    );

    setReminders(updatedReminders);
    persist(visits, closedDays, updatedReminders);
  }

  function openSourceVisitFromReminder(reminder) {
    const sourceVisit = visits.find(visit =>
      String(visit.id) === String(reminder.sourceVisitId)
    );

    if (sourceVisit) {
      setOpenVisit(sourceVisit);
      setShowSearch(false);
    }
  }

  function deleteClosedDay(date) {
    if (!window.confirm("¿Seguro que quieres eliminar este cierre?")) return;

    const updatedClosedDays = closedDays.filter(c => c.date !== date);
    setClosedDays(updatedClosedDays);
    persist(visits, updatedClosedDays, reminders);
    setOpenClosedDay(null);
  }

  function exportCSV() {
    const rows = [
      ["Fecha", "Negocio", "Referente", "Localidad", "Barrio/Zona", "Código postal", "Dirección", "Tipo visita", "Valor", "Notas", "Latitud", "Longitud", "Precisión metros"],
      ...selectedVisits.map(v => [
        v.date,
        v.businessName,
        v.contactName,
        v.locality || "",
        v.neighborhood || "",
        v.postalCode || "",
        v.address || "",
        v.visitType || "",
        labelValue(v.visitValue),
        v.notes,
        v.latitude || "",
        v.longitude || "",
        v.locationAccuracy || "",
      ]),
    ];

    const csv = rows
      .map(row => row.map(cell => `"${String(cell || "").replaceAll('"', '""')}"`).join(";"))
      .join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `visitas-${selectedDate}.csv`);
  }

  function exportAllBackup() {
    const backup = {
      app: "visitas-app",
      version: 6,
      exportedAt: new Date().toISOString(),
      data: { visits, closedDays, reminders, targetLists },
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json;charset=utf-8;",
    });

    downloadBlob(blob, `backup-visitas-${todayKey}.json`);

    setBackupStatus("Backup completo descargado.");
  }

  function importBackupFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setBackupStatus("El backup es demasiado grande (máximo 5 MB).");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = event => {
      try {
        const parsed = JSON.parse(event.target.result);
        const importedData = validateImportedData(parsed.data || parsed);

        const ok = window.confirm(
          "¿Quieres importar este backup? Esto sustituirá las visitas actuales de este navegador."
        );

        if (!ok) return;

        setVisits(importedData.visits);
        setClosedDays(importedData.closedDays);
        setReminders(importedData.reminders);
        setTargetLists(importedData.targetLists);
        saveData(importedData);
        setBackupStatus("Backup importado correctamente.");
      } catch {
        setBackupStatus("No se pudo importar el archivo. Revisa que sea un backup válido.");
      } finally {
        e.target.value = "";
      }
    };

    reader.readAsText(file);
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brandBlock">
          <Image
            className="brandLogo"
            src="/visitas-pro-logo.png"
            alt="Visitas Pro App"
            width={335}
            height={335}
            priority
          />
          <div>
            <div className="small">Agenda de visitas realizadas</div>
            <h1>
              {monthDate.toLocaleDateString("es-ES", {
                month: "long",
                year: "numeric",
              })}
            </h1>
          </div>
        </div>

        <div className="buttons">
          <button onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}>‹</button>
          <button onClick={() => { setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(todayKey); }}>Hoy</button>
          <button onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}>›</button>
        </div>
      </div>

      <div className="layout">
        <div className="calendarViewport" ref={calendarRef}>
          <div className="calendar">
          {["L", "M", "X", "J", "V", "S", "D"].map(d => (
            <div className="weekday" key={d}>{d}</div>
          ))}

          {days.map(day => {
            const key = dateKey(day);
            const dayVisits = visitsByDay[key] || [];
            const closed = closedByDay[key];
            const isCurrentMonth = day.getMonth() === monthDate.getMonth();
            const isToday = key === todayKey;
            const isSelected = key === selectedDate;
            const isSunday = day.getDay() === 0;

            return (
              <button
                key={key}
                data-date-key={key}
                className={`day ${!isCurrentMonth ? "muted" : ""} ${isSelected ? "selected" : ""} ${closed ? "closed" : ""}`}
                onClick={() => selectCalendarDay(key)}
              >
                {(() => {
                  const dayReminders = remindersByDay[key] || [];
                  const visitTagCount = Math.min(dayVisits.length, 4);
                  const reminderTagCount = Math.max(0, 5 - visitTagCount);
                  const totalDayItems = dayVisits.length + dayReminders.length;

                  return (
                    <>
                <div className="dayHead">
                  <span className={`${isToday ? "today" : ""} ${isSunday ? "holiday" : ""}`}>
                    {day.getDate()}
                  </span>
                      {totalDayItems > 0 && <b>{totalDayItems}</b>}
                </div>

                {closed && <div className="closedTag">Cerrado / no trabajado</div>}

                <div className="tags">
                      {dayVisits.slice(0, 4).map(v => (
                    <div
                      key={v.id}
                      className="tag"
                      style={{ backgroundColor: colorValue(v.visitValue) }}
                    >
                      {v.businessName}
                    </div>
                  ))}
                      {dayReminders.slice(0, reminderTagCount).map(reminder => (
                        <div
                          key={reminder.id}
                          className="tag reminderTag"
                        >
                          Volver: {reminder.businessName}
                        </div>
                      ))}
                      {totalDayItems > 5 && <div className="more">+{totalDayItems - 5} más</div>}
                </div>
                    </>
                  );
                })()}
              </button>
            );
          })}
          </div>
        </div>

        <div className="side" ref={summaryRef}>
          <button type="button" className="backToCalendarBtn" onClick={scrollToCalendar}>
            ↑ Volver al calendario
          </button>

          <h2>
            {parseKey(selectedDate).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </h2>

          <button className="mainBtn" onClick={openNewVisitForm}>
            + Añadir visita
          </button>

          <button className="orangeBtn" onClick={() => setShowCloseForm(true)}>
            Cerrar día / parte del día
          </button>

          <button className="secondaryBtn" onClick={() => setShowSearch(true)}>
            🔎 Buscar visitas y recordatorios
          </button>

          <button
            className="secondaryBtn"
            onClick={() => {
              setShowTargetLists(true);
              setOpenTargetListId(null);
              setLeadImportMessage("");
            }}
          >
            Listas de clientes objetivos{targetLists.length ? ` (${targetLists.length})` : ""}
          </button>

          <button className="secondaryBtn" onClick={exportCSV} disabled={selectedVisits.length === 0}>
            Exportar día a Excel/CSV
          </button>

          <button className="secondaryBtn" onClick={exportAllBackup}>
            Exportar backup completo
          </button>

          <button className="secondaryBtn" onClick={() => importInputRef.current?.click()}>
            Importar backup
          </button>

          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={importBackupFile}
            style={{ display: "none" }}
          />

          {backupStatus && <p className="small">{backupStatus}</p>}

          {selectedClosed && (
            <button className="closedCard" onClick={() => setOpenClosedDay(selectedClosed)}>
              <strong>{selectedClosed.type}</strong>
              <span>{selectedClosed.reason || "Sin motivo indicado"}</span>
            </button>
          )}

          <div className="visitList">
            {selectedVisits.length === 0 && selectedReminders.length === 0 && !selectedClosed && (
              <div className="empty">No hay visitas ni cierre marcado en este día.</div>
            )}

            {selectedReminders.map(reminder => (
              <div
                className="reminderCard"
                key={reminder.id}
              >
                <strong>Volver a pasar</strong>
                <span>{reminder.businessName}</span>
                <span>{reminder.contactName || "Sin referente"}</span>
                <small>
                  Previsto para {formatVisitDate(reminder.dueDate)} · Origen: {labelValue(reminder.sourceVisitValue)}
                </small>
                <em>{reminderStatusLabel(reminder.status)}</em>
                <div className="reminderActions">
                  <button type="button" onClick={() => openReminderReschedule(reminder)}>
                    Cambiar fecha
                  </button>
                  <button type="button" onClick={() => openVisitFromReminder(reminder)}>
                    Registrar visita
                  </button>
                  <button type="button" onClick={() => markReminderDone(reminder)}>
                    Marcar pasado
                  </button>
                  <button type="button" onClick={() => dismissReminder(reminder)}>
                    Descartar
                  </button>
                  <button type="button" onClick={() => openSourceVisitFromReminder(reminder)}>
                    Ver origen
                  </button>
                </div>
              </div>
            ))}

            {selectedVisits.map(v => (
              <button className="visitCard" key={v.id} onClick={() => setOpenVisit(v)}>
                <strong>{v.businessName}</strong>
                <span>{v.contactName || "Sin referente"}</span>
                <span>{v.locality || "Sin localidad"}{v.neighborhood ? ` · ${v.neighborhood}` : ""}</span>
                {v.postalCode && <span>CP {v.postalCode}</span>}
                <small>{v.visitType}</small>
                <em style={{ backgroundColor: colorValue(v.visitValue) }}>
                  {labelValue(v.visitValue)}
                </em>
              </button>
            ))}
          </div>
        </div>
      </div>

      {showForm && (
        <div className="modal">
          <form className="box" onSubmit={addVisit}>
            <div className="modalHead">
              <h2>{editingVisitId ? "Editar visita" : "Nueva visita"}</h2>
              <button type="button" onClick={closeVisitForm}>×</button>
            </div>

            <label>Fecha</label>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />

            <label>Tipo de visita</label>
            <select value={form.visitType} onChange={e => setForm({ ...form, visitType: e.target.value })}>
              {tiposVisita.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <label>Nombre negocio</label>
            <input required value={form.businessName} onChange={e => setForm({ ...form, businessName: e.target.value })} />

            <label>Categoría</label>
            <input
              placeholder="Ej. Barbería, peluquería, estética..."
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
            />

            <label>Nombre referente</label>
            <input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />

            <label>Teléfono</label>
            <input
              inputMode="tel"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
            />

            <label>Localidad</label>
            <input value={form.locality} onChange={e => setForm({ ...form, locality: e.target.value })} />

            <label>Barrio / zona</label>
            <input value={form.neighborhood} onChange={e => setForm({ ...form, neighborhood: e.target.value })} />

            <label>Código postal</label>
            <input
              inputMode="numeric"
              value={form.postalCode}
              onChange={e => setForm({ ...form, postalCode: e.target.value })}
            />

            <label>Dirección aproximada</label>
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />

            <label>Enlace de Google Maps</label>
            <input
              type="url"
              placeholder="https://maps.google.com/..."
              value={form.googleMaps}
              onChange={e => setForm({ ...form, googleMaps: e.target.value })}
            />

            <label>Valor de la visita</label>
            <select value={form.visitValue} onChange={e => setForm({ ...form, visitValue: e.target.value })}>
              {valores.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>

            <button type="button" className="secondaryBtn" onClick={getCurrentLocation}>
              📍 Guardar ubicación actual
            </button>

            {locationStatus && <p className="small">{locationStatus}</p>}

            {form.latitude && form.longitude && (
              <p className="small">
                Ubicación: {Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}
              </p>
            )}

            <label>Notas</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />

            <button className="mainBtn" type="submit">
  {editingVisitId ? "Guardar cambios" : "Guardar visita"}
</button>
          </form>
        </div>
      )}

      {showTargetLists && (
        <div className="modal">
          <div className="box targetListsBox">
            <div className="modalHead">
              <h2>{activeTargetList ? activeTargetList.name : "Listas de clientes objetivos"}</h2>
              <button type="button" onClick={() => setShowTargetLists(false)}>×</button>
            </div>

            {!activeTargetList ? (
              <>
                <p className="small">Crea una lista y después importa su Excel o CSV.</p>
                <form className="targetListCreate" onSubmit={createTargetList}>
                  <input
                    required
                    placeholder="Ej. Potenciales clientes El Ejido"
                    value={newTargetListName}
                    onChange={e => setNewTargetListName(e.target.value)}
                  />
                  <button className="mainBtn" type="submit">Crear lista</button>
                </form>

                {leadImportMessage && <p className="small targetListMessage">{leadImportMessage}</p>}

                <div className="targetListCards">
                  {targetLists.length === 0 && (
                    <div className="empty">Todavía no hay listas. Crea la primera para importar tus leads.</div>
                  )}
                  {targetLists.map(list => {
                    const pendingCount = list.leads.filter(lead => (lead.status || LEAD_STATUS.pending) === LEAD_STATUS.pending).length;
                    const visitedCount = list.leads.filter(lead => lead.status === LEAD_STATUS.visited).length;
                    return (
                      <button type="button" className="targetListCard" key={list.id} onClick={() => openTargetList(list.id)}>
                        <strong>{list.name}</strong>
                        <span>{list.leads.length} {list.leads.length === 1 ? "lead" : "leads"}</span>
                        <small>{pendingCount} pendientes · {visitedCount} visitados</small>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="backToListsBtn"
                  onClick={() => {
                    setOpenTargetListId(null);
                    setLeadImportMessage("");
                  }}
                >
                  ← Todas las listas
                </button>

                <div className="targetListTools">
                  <button type="button" className="mainBtn" onClick={() => leadImportInputRef.current?.click()}>
                    Importar Excel o CSV
                  </button>
                  <button type="button" className="secondaryBtn" onClick={() => reconcileTargetListWithVisitHistory(activeTargetList)}>
                    Cruzar con historial
                  </button>
                  <button type="button" className="deleteBtn compactDeleteBtn" onClick={() => deleteTargetList(activeTargetList)}>
                    Eliminar lista
                  </button>
                </div>
                {leadImportMessage && <p className="small targetListMessage">{leadImportMessage}</p>}
                <input
                  ref={leadImportInputRef}
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={importLeadsFile}
                  style={{ display: "none" }}
                />

                <p className="small">Columnas: Negocio, Categoría, Dirección, Localidad, Código postal, Teléfono y Google Maps.</p>

                <input
                  className="leadSearchInput"
                  placeholder="Buscar en esta lista"
                  value={leadSearchTerm}
                  onChange={e => setLeadSearchTerm(e.target.value)}
                />
                <div className="searchTabs three leadFilters">
                  <button type="button" className={leadStatusFilter === "all" ? "active" : ""} onClick={() => setLeadStatusFilter("all")}>Todos</button>
                  <button type="button" className={leadStatusFilter === LEAD_STATUS.pending ? "active" : ""} onClick={() => setLeadStatusFilter(LEAD_STATUS.pending)}>Pendientes</button>
                  <button type="button" className={leadStatusFilter === LEAD_STATUS.visited ? "active" : ""} onClick={() => setLeadStatusFilter(LEAD_STATUS.visited)}>Visitados</button>
                </div>

                <div className="targetLeadList">
                  {visibleTargetLeads.length === 0 && (
                    <div className="empty">No hay leads que coincidan con este filtro.</div>
                  )}
                  {visibleTargetLeads.map(lead => {
                    const recordedVisitIds = new Set(uniqueIds(lead.visitIds || []).map(String));
                    const linkedVisits = visits.filter(visit =>
                      uniqueIds([...(visit.linkedLeadIds || []), visit.sourceLeadId]).includes(String(lead.id)) ||
                      recordedVisitIds.has(String(visit.id))
                    );
                    const status = lead.status || LEAD_STATUS.pending;

                    return (
                      <article className={`targetLeadCard ${status}`} key={lead.id}>
                        <div className="targetLeadHead">
                          <div>
                            <h3>{lead.businessName}</h3>
                            {lead.category && <span>{lead.category}</span>}
                          </div>
                          <em className={`leadStatus ${status}`}>{leadStatusLabel(status)}</em>
                        </div>

                        <p>{[lead.address, lead.postalCode, lead.locality].filter(Boolean).join(" · ") || "Sin dirección"}</p>
                        {lead.phone && <p>Tel. {lead.phone}</p>}

                        <div className="mapActions">
                          {mapSearchUrl(lead) && <a href={mapSearchUrl(lead)} target="_blank" rel="noreferrer">Abrir en Maps</a>}
                          {mapDirectionsUrl(lead) && <a href={mapDirectionsUrl(lead)} target="_blank" rel="noreferrer">Cómo llegar</a>}
                        </div>

                        <div className="leadActions">
                          <button type="button" className="mainBtn" onClick={() => openVisitFromLead(activeTargetList, lead)}>Crear visita</button>
                          {status !== LEAD_STATUS.visited && (
                            <button type="button" onClick={() => updateLeadStatus(activeTargetList.id, lead.id, LEAD_STATUS.visited)}>Marcar visitado</button>
                          )}
                          {status !== LEAD_STATUS.pending && (
                            <button type="button" onClick={() => updateLeadStatus(activeTargetList.id, lead.id, LEAD_STATUS.pending)}>Marcar pendiente</button>
                          )}
                          {status !== LEAD_STATUS.discarded && (
                            <button type="button" onClick={() => updateLeadStatus(activeTargetList.id, lead.id, LEAD_STATUS.discarded)}>Descartar</button>
                          )}
                          {linkedVisits.length > 0 && (
                            <button type="button" onClick={() => openVisitsForLead(activeTargetList, lead)}>
                              Ver visitas ({linkedVisits.length})
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pendingLeadMatch && (
        <div className="modal">
          <div className="box leadMatchBox">
            <div className="modalHead">
              <h2>Coincidencia con una lista</h2>
              <button type="button" onClick={() => setPendingLeadMatch(null)}>×</button>
            </div>

            <p>
              Esta visita coincide con {pendingLeadMatch.matches.length} {pendingLeadMatch.matches.length === 1 ? "lead" : "leads"}.
              Selecciona cuáles quieres marcar como visitados.
            </p>

            <div className="leadMatchList">
              {pendingLeadMatch.matches.map(match => {
                const leadId = String(match.lead.id);
                const isSelected = pendingLeadMatch.selectedLeadIds.includes(leadId);
                return (
                  <label className="leadMatchItem" key={`${match.listId}-${leadId}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={e => {
                        setPendingLeadMatch(current => ({
                          ...current,
                          selectedLeadIds: e.target.checked
                            ? uniqueIds([...current.selectedLeadIds, leadId])
                            : current.selectedLeadIds.filter(id => String(id) !== leadId),
                        }));
                      }}
                    />
                    <span>
                      <strong>{match.lead.businessName}</strong>
                      <small>{match.listName} · Coincide por {match.reasons.join(", ")}</small>
                    </span>
                  </label>
                );
              })}
            </div>

            <button type="button" className="mainBtn" onClick={confirmLeadMatches}>
              Guardar visita y marcar seleccionados
            </button>
            <button type="button" className="secondaryBtn" onClick={skipLeadMatches}>
              Guardar sin marcar en la lista
            </button>
            <button type="button" className="secondaryBtn" onClick={() => setPendingLeadMatch(null)}>
              Volver a editar
            </button>
          </div>
        </div>
      )}

      {openLeadVisits && (
        <div className="modal">
          <div className="box">
            <div className="modalHead">
              <h2>Visitas de {openLeadVisits.lead.businessName}</h2>
              <button
                type="button"
                onClick={() => {
                  setOpenLeadVisits(null);
                  setOpenTargetListId(openLeadVisits.listId);
                  setShowTargetLists(true);
                }}
              >
                ×
              </button>
            </div>

            {openLeadVisits.visits.length === 0 ? (
              <div className="empty">Todavía no hay visitas asociadas a este lead.</div>
            ) : (
              <div className="historyList">
                {openLeadVisits.visits.map(visit => (
                  <button
                    type="button"
                    className="historyCard"
                    key={visit.id}
                    onClick={() => {
                      setOpenLeadVisits(null);
                      setOpenVisit(visit);
                    }}
                  >
                    <strong>{formatVisitDate(visit.date)}</strong>
                    <span>{visit.visitType || "Sin tipo de visita"}</span>
                    <em style={{ backgroundColor: colorValue(visit.visitValue) }}>{labelValue(visit.visitValue)}</em>
                    {visit.notes && <small>{visit.notes}</small>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {pendingVisitSave && (
        <div className="modal reminderScheduleModal">
          <div className="box reminderScheduleBox">
            <div className="modalHead">
              <h2>Recordatorio</h2>
              <button type="button" onClick={cancelReminderSchedule}>×</button>
            </div>

            <h3>{pendingVisitSave.visit.businessName}</h3>
            <p className="small">
              {labelValue(pendingVisitSave.visit.visitValue)} · Visita del {formatVisitDate(pendingVisitSave.visit.date)}
            </p>

            <div className="presetGrid">
              {reminderPresetOptions.map(preset => {
                const presetDate = suggestedReminderDateKey(pendingVisitSave.visit.date, preset);

                return (
                  <button
                    type="button"
                    key={preset.label}
                    className={reminderSelectedDate === presetDate ? "active" : ""}
                    onClick={() => {
                      const parsedDate = parseKey(presetDate);
                      setReminderSelectedDate(presetDate);
                      setReminderMonthDate(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
                    }}
                  >
                    <strong>{preset.label}</strong>
                    <span>{formatVisitDate(presetDate)}</span>
                  </button>
                );
              })}
            </div>

            <div className="scheduleMonthHead">
              <button
                type="button"
                onClick={() => setReminderMonthDate(new Date(reminderMonthDate.getFullYear(), reminderMonthDate.getMonth() - 1, 1))}
              >
                ‹
              </button>
              <strong>
                {reminderMonthDate.toLocaleDateString("es-ES", {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              <button
                type="button"
                onClick={() => setReminderMonthDate(new Date(reminderMonthDate.getFullYear(), reminderMonthDate.getMonth() + 1, 1))}
              >
                ›
              </button>
            </div>

            <div className="scheduleCalendar">
              {["L", "M", "X", "J", "V", "S", "D"].map(d => (
                <div className="scheduleWeekday" key={d}>{d}</div>
              ))}

              {reminderCalendarDays.map(day => {
                const key = dateKey(day);
                const isCurrentMonth = day.getMonth() === reminderMonthDate.getMonth();
                const isSelected = key === reminderSelectedDate;
                const isBeforeVisit = key < pendingVisitSave.visit.date;

                return (
                  <button
                    type="button"
                    key={key}
                    disabled={isBeforeVisit}
                    className={`scheduleDay ${!isCurrentMonth ? "muted" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => setReminderSelectedDate(key)}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <p className="scheduleDateText">
              Recordatorio para {formatVisitDate(reminderSelectedDate)}
            </p>

            <button type="button" className="mainBtn" onClick={confirmReminderSchedule}>
              Guardar visita y recordatorio
            </button>
            <button type="button" className="secondaryBtn" onClick={cancelReminderSchedule}>
              Volver a editar
            </button>
          </div>
        </div>
      )}

      {reminderToReschedule && (
        <div className="modal reminderScheduleModal">
          <div className="box reminderScheduleBox">
            <div className="modalHead">
              <h2>Cambiar fecha del recordatorio</h2>
              <button type="button" onClick={() => setReminderToReschedule(null)}>×</button>
            </div>

            <h3>{reminderToReschedule.businessName}</h3>
            <p className="small">
              Fecha actual: {formatVisitDate(reminderToReschedule.dueDate)}
            </p>

            <div className="scheduleMonthHead">
              <button
                type="button"
                onClick={() => setReminderMonthDate(new Date(reminderMonthDate.getFullYear(), reminderMonthDate.getMonth() - 1, 1))}
              >
                ‹
              </button>
              <strong>
                {reminderMonthDate.toLocaleDateString("es-ES", {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              <button
                type="button"
                onClick={() => setReminderMonthDate(new Date(reminderMonthDate.getFullYear(), reminderMonthDate.getMonth() + 1, 1))}
              >
                ›
              </button>
            </div>

            <div className="scheduleCalendar">
              {["L", "M", "X", "J", "V", "S", "D"].map(day => (
                <div className="scheduleWeekday" key={day}>{day}</div>
              ))}

              {reminderCalendarDays.map(day => {
                const key = dateKey(day);
                const isCurrentMonth = day.getMonth() === reminderMonthDate.getMonth();
                const isSelected = key === reminderSelectedDate;
                const isBeforeSourceVisit = Boolean(
                  reminderToReschedule.originalVisitDate && key < reminderToReschedule.originalVisitDate
                );

                return (
                  <button
                    type="button"
                    key={key}
                    disabled={isBeforeSourceVisit}
                    className={`scheduleDay ${!isCurrentMonth ? "muted" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => setReminderSelectedDate(key)}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <p className="scheduleDateText">
              Nueva fecha: {formatVisitDate(reminderSelectedDate)}
            </p>

            <button type="button" className="mainBtn" onClick={saveRescheduledReminder}>
              Guardar nueva fecha
            </button>
            <button type="button" className="secondaryBtn" onClick={() => setReminderToReschedule(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showCloseForm && (
        <div className="modal">
          <form className="box" onSubmit={closeDay}>
            <div className="modalHead">
              <h2>Cerrar día / parte del día</h2>
              <button type="button" onClick={() => setShowCloseForm(false)}>×</button>
            </div>

            <label>Fecha</label>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />

            <label>Tipo</label>
            <select value={closeForm.type} onChange={e => setCloseForm({ ...closeForm, type: e.target.value })}>
              <option>Día completo</option>
              <option>Mañana</option>
              <option>Tarde</option>
              <option>Horas sueltas</option>
            </select>

            <label>Motivo</label>
            <textarea
              placeholder="Ej. Administrativo, médico, avería coche, lluvia, formación..."
              value={closeForm.reason}
              onChange={e => setCloseForm({ ...closeForm, reason: e.target.value })}
            />

            <button className="orangeBtn full" type="submit">Guardar cierre</button>
          </form>
        </div>
      )}

      {openVisit && (
        <div className="modal">
          <div className="box">
            <div className="modalHead">
              <h2>Ficha de visita</h2>
              <button onClick={() => setOpenVisit(null)}>×</button>
            </div>

            <h3>{openVisit.businessName}</h3>
            <p><b>Categoría:</b> {openVisit.category || "—"}</p>
            <p><b>Referente:</b> {openVisit.contactName || "—"}</p>
            <p><b>Teléfono:</b> {openVisit.phone || "—"}</p>
            <p><b>Localidad:</b> {openVisit.locality || "—"}</p>
            <p><b>Barrio/Zona:</b> {openVisit.neighborhood || "—"}</p>
            <p><b>Código postal:</b> {openVisit.postalCode || "—"}</p>
            <p><b>Dirección:</b> {openVisit.address || "—"}</p>
            <p><b>Tipo:</b> {openVisit.visitType || "—"}</p>
            <p><b>Valor:</b> {labelValue(openVisit.visitValue)}</p>

            {openVisit.latitude && openVisit.longitude && (
              <p>
                <b>Ubicación:</b>{" "}
                <a
                  href={`https://www.google.com/maps?q=${openVisit.latitude},${openVisit.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver en Google Maps
                </a>
              </p>
            )}

            {mapSearchUrl(openVisit) && (
              <div className="mapActions">
                <a href={mapSearchUrl(openVisit)} target="_blank" rel="noreferrer">Abrir en Maps</a>
                <a href={mapDirectionsUrl(openVisit)} target="_blank" rel="noreferrer">Cómo llegar</a>
              </div>
            )}

            <p><b>Notas:</b></p>
            <div className="notes">{openVisit.notes || "Sin notas"}</div>
<button
  className="mainBtn"
  onClick={() => editVisit(openVisit)}
>
  ✏️ Editar visita
</button>
            <button className="deleteBtn" onClick={() => deleteVisit(openVisit.id)}>
              Eliminar visita
            </button>
          </div>
        </div>
      )}

      {showSearch && (
        <div className="modal">
          <div className="box searchBox">
            <div className="modalHead">
              <h2>{searchScope === "reminders" ? "Buscar recordatorios" : "Buscar visitas"}</h2>
              <button onClick={() => setShowSearch(false)}>×</button>
            </div>

            <div className="searchTabs">
              <button
                type="button"
                className={searchScope === "visits" ? "active" : ""}
                onClick={() => {
                  setSearchScope("visits");
                  setSearchTerm("");
                }}
              >
                Visitas
              </button>
              <button
                type="button"
                className={searchScope === "reminders" ? "active" : ""}
                onClick={() => {
                  setSearchScope("reminders");
                  setSearchTerm("");
                }}
              >
                Recordatorios
              </button>
            </div>

            <div className="searchTabs">
              <button
                type="button"
                className={searchMode === "businessName" ? "active" : ""}
                onClick={() => {
                  setSearchMode("businessName");
                  setSearchTerm("");
                }}
              >
                Por negocio
              </button>
              <button
                type="button"
                className={searchMode === "postalCode" ? "active" : ""}
                onClick={() => {
                  setSearchMode("postalCode");
                  setSearchTerm("");
                }}
              >
                Por código postal
              </button>
            </div>

            {searchScope === "reminders" && (
              <div className="searchTabs three">
                <button
                  type="button"
                  className={reminderSearchFilter === "pending" ? "active" : ""}
                  onClick={() => setReminderSearchFilter("pending")}
                >
                  Pendientes
                </button>
                <button
                  type="button"
                  className={reminderSearchFilter === "overdue" ? "active" : ""}
                  onClick={() => setReminderSearchFilter("overdue")}
                >
                  Vencidos
                </button>
                <button
                  type="button"
                  className={reminderSearchFilter === "all" ? "active" : ""}
                  onClick={() => setReminderSearchFilter("all")}
                >
                  Todos
                </button>
              </div>
            )}

            <label>{searchMode === "postalCode" ? "Código postal" : "Nombre del negocio"}</label>
            <input
              autoFocus
              value={searchTerm}
              inputMode={searchMode === "postalCode" ? "numeric" : "text"}
              placeholder={
                searchScope === "reminders"
                  ? searchMode === "postalCode" ? "Opcional, ej. 04001" : "Opcional, ej. Bar Radiance"
                  : searchMode === "postalCode" ? "Ej. 28010" : "Ej. Bar Radiance"
              }
              onChange={e => setSearchTerm(e.target.value)}
            />

            {searchScope === "visits" && (
              <label className="checkLine">
                <input
                  type="checkbox"
                  checked={showBadSearchResults}
                  onChange={e => setShowBadSearchResults(e.target.checked)}
                />
                Mostrar también los marcados como “Malo - no volver”
              </label>
            )}

            {searchScope === "visits" && searchTerm.trim() && (
              <p className="small">
                {searchResults.length} {searchResults.length === 1 ? "negocio encontrado" : "negocios encontrados"}
              </p>
            )}

            {searchScope === "reminders" && (
              <p className="small">
                {reminderSearchResults.length} {reminderSearchResults.length === 1 ? "recordatorio encontrado" : "recordatorios encontrados"}
              </p>
            )}

            <div className="searchResults">
              {searchScope === "visits" && !searchTerm.trim() && (
                <div className="empty">Escribe algo para empezar la búsqueda.</div>
              )}

              {searchScope === "visits" && searchTerm.trim() && searchResults.length === 0 && (
                <div className="empty">No he encontrado negocios con esa búsqueda.</div>
              )}

              {searchScope === "visits" && searchResults.map(result => (
                <button
                  type="button"
                  className="businessCard"
                  key={result.key}
                  onClick={() => setOpenBusiness(result)}
                >
                  <strong>{result.latestVisit.businessName}</strong>
                  <span>
                    {[
                      result.latestVisit.postalCode ? `CP ${result.latestVisit.postalCode}` : "",
                      result.latestVisit.locality,
                      result.latestVisit.neighborhood,
                    ].filter(Boolean).join(" · ") || "Sin zona indicada"}
                  </span>
                  <span>Última visita: {formatVisitDate(result.latestVisit.date)}</span>
                  <span>{result.totalVisits} {result.totalVisits === 1 ? "visita registrada" : "visitas registradas"}</span>
                  <em style={{ backgroundColor: colorValue(result.latestVisit.visitValue) }}>
                    {labelValue(result.latestVisit.visitValue)}
                  </em>
                </button>
              ))}

              {searchScope === "reminders" && reminderSearchResults.length === 0 && (
                <div className="empty">No hay recordatorios con ese filtro.</div>
              )}

              {searchScope === "reminders" && reminderSearchResults.map(reminder => (
                <div
                  className={`reminderCard searchReminderCard ${reminder.status !== REMINDER_STATUS.pending ? "mutedReminder" : ""}`}
                  key={reminder.id}
                >
                  <strong>{reminder.businessName}</strong>
                  <span>
                    {[reminder.postalCode ? `CP ${reminder.postalCode}` : "", reminder.locality, reminder.neighborhood]
                      .filter(Boolean)
                      .join(" · ") || "Sin zona indicada"}
                  </span>
                  <span>Previsto: {formatVisitDate(reminder.dueDate)}</span>
                  <small>Origen: {labelValue(reminder.sourceVisitValue)} el {formatVisitDate(reminder.originalVisitDate)}</small>
                  <em>{reminderStatusLabel(reminder.status)}</em>
                  <div className="reminderActions">
                    {reminder.status === REMINDER_STATUS.pending && (
                      <>
                        <button type="button" onClick={() => openVisitFromReminder(reminder)}>
                          Registrar visita
                        </button>
                        <button type="button" onClick={() => openReminderReschedule(reminder)}>
                          Cambiar fecha
                        </button>
                        <button type="button" onClick={() => markReminderDone(reminder)}>
                          Marcar pasado
                        </button>
                        <button type="button" onClick={() => dismissReminder(reminder)}>
                          Descartar
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => openSourceVisitFromReminder(reminder)}>
                      Ver origen
                    </button>
                    <button type="button" className="dangerMiniBtn" onClick={() => deleteReminder(reminder)}>
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {openBusiness && (
        <div className="modal">
          <div className="box">
            <div className="modalHead">
              <h2>Ficha de negocio</h2>
              <button onClick={() => setOpenBusiness(null)}>×</button>
            </div>

            <h3>{openBusiness.latestVisit.businessName}</h3>
            <p><b>Referente:</b> {openBusiness.latestVisit.contactName || "—"}</p>
            <p><b>Localidad:</b> {openBusiness.latestVisit.locality || "—"}</p>
            <p><b>Barrio/Zona:</b> {openBusiness.latestVisit.neighborhood || "—"}</p>
            <p><b>Código postal:</b> {openBusiness.latestVisit.postalCode || "—"}</p>
            <p><b>Dirección:</b> {openBusiness.latestVisit.address || "—"}</p>
            <p><b>Última valoración:</b> {labelValue(openBusiness.latestVisit.visitValue)}</p>

            <h3>Historial de visitas</h3>
            <div className="historyList">
              {openBusiness.visits.map(visit => (
                <button
                  type="button"
                  className="historyCard"
                  key={visit.id}
                  onClick={() => {
                    setOpenBusiness(null);
                    setOpenVisit(visit);
                  }}
                >
                  <strong>{formatVisitDate(visit.date)}</strong>
                  <span>{visit.visitType || "Sin tipo de visita"}</span>
                  <em style={{ backgroundColor: colorValue(visit.visitValue) }}>
                    {labelValue(visit.visitValue)}
                  </em>
                  {visit.notes && <small>{visit.notes}</small>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {openClosedDay && (
        <div className="modal">
          <div className="box">
            <div className="modalHead">
              <h2>Día cerrado / no trabajado</h2>
              <button onClick={() => setOpenClosedDay(null)}>×</button>
            </div>

            <p><b>Fecha:</b> {openClosedDay.date}</p>
            <p><b>Tipo:</b> {openClosedDay.type}</p>
            <p><b>Motivo:</b></p>
            <div className="notes">{openClosedDay.reason || "Sin motivo indicado"}</div>

            <button className="deleteBtn" onClick={() => deleteClosedDay(openClosedDay.date)}>
              Eliminar cierre
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";

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

const EMPTY_VISIT_FORM = {
  businessName: "",
  contactName: "",
  locality: "",
  neighborhood: "",
  postalCode: "",
  address: "",
  visitType: tiposVisita[0],
  notes: "",
  visitValue: "normal",
  latitude: "",
  longitude: "",
  locationAccuracy: "",
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

  if (!visitsAreValid || !closedDaysAreValid || !remindersAreValid) {
    throw new Error("El backup contiene registros no válidos");
  }

  return normalizeData({
    visits: data.visits,
    closedDays: data.closedDays,
    ...(hasImportedReminders ? { reminders } : {}),
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
  const calendarRef = useRef(null);
  const summaryRef = useRef(null);

  const [visits, setVisits] = useState([]);
  const [closedDays, setClosedDays] = useState([]);
  const [reminders, setReminders] = useState([]);
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

  const [form, setForm] = useState({ ...EMPTY_VISIT_FORM });
  const [pendingVisitSave, setPendingVisitSave] = useState(null);
  const [reminderMonthDate, setReminderMonthDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [reminderSelectedDate, setReminderSelectedDate] = useState(todayKey);
  const [searchScope, setSearchScope] = useState("visits");
  const [searchMode, setSearchMode] = useState("businessName");
  const [searchTerm, setSearchTerm] = useState("");
  const [reminderSearchFilter, setReminderSearchFilter] = useState("pending");
  const [showBadSearchResults, setShowBadSearchResults] = useState(false);

  const [closeForm, setCloseForm] = useState({
    type: "Día completo",
    reason: "",
  });

  const activeModalKey = pendingVisitSave
    ? "reminder-schedule"
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

  const reminderSearchResults = useMemo(() => {
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
  }, [reminderSearchFilter, reminders, searchMode, searchTerm, todayKey]);

  function persist(updatedVisits, updatedClosedDays, updatedReminders = reminders) {
    saveData({
      visits: updatedVisits,
      closedDays: updatedClosedDays,
      reminders: updatedReminders,
    });
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
    persist(pendingSave.visits, closedDays, updatedReminders);
    setPendingVisitSave(null);
    closeVisitForm();
  }

  function confirmReminderSchedule() {
    if (!pendingVisitSave || !reminderSelectedDate) return;
    finishVisitSave(pendingVisitSave, reminderSelectedDate);
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

    if (!window.matchMedia("(max-width: 850px)").matches) return;

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
        finishVisitSave({ visits: updatedVisits, reminders: updatedReminders, visit: editedVisit, completedAt: now });
        return;
      }

      startReminderSchedule({
        visits: updatedVisits,
        reminders: updatedReminders,
        visit: editedVisit,
        completedAt: now,
      });
      return;
    }

    const newVisit = {
      id: Date.now(),
      date: selectedDate,
      createdAt: now,
      ...form,
    };

    const pendingSave = {
      visits: [...visits, newVisit],
      reminders,
      visit: newVisit,
      completedReminderId: activeReminderId,
      completedAt: now,
    };

    if (!visitCanHaveReminder(newVisit)) {
      finishVisitSave(pendingSave);
      return;
    }

    startReminderSchedule(pendingSave);
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
    contactName: visit.contactName || "",
    locality: visit.locality || "",
    neighborhood: visit.neighborhood || "",
    postalCode: visit.postalCode || "",
    address: visit.address || "",
    visitType: visit.visitType || tiposVisita[0],
    notes: visit.notes || "",
    visitValue: visit.visitValue || "normal",
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
    setVisits(updated);
    setReminders(updatedReminders);
    persist(updated, closedDays, updatedReminders);
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
      version: 5,
      exportedAt: new Date().toISOString(),
      data: { visits, closedDays, reminders },
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
        <div className="calendar" ref={calendarRef}>
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

            <label>Nombre referente</label>
            <input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />

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
            <p><b>Referente:</b> {openVisit.contactName || "—"}</p>
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

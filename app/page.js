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

function normalizeData(data) {
  return {
    visits: Array.isArray(data?.visits) ? data.visits : [],
    closedDays: Array.isArray(data?.closedDays) ? data.closedDays : [],
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

  if (!visitsAreValid || !closedDaysAreValid) {
    throw new Error("El backup contiene registros no válidos");
  }

  return { visits: data.visits, closedDays: data.closedDays };
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
  if (typeof window === "undefined") return { visits: [], closedDays: [] };

  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return normalizeData(JSON.parse(current));

    for (const key of OLD_KEYS) {
      const old = localStorage.getItem(key);
      if (old) return normalizeData(JSON.parse(old));
    }

    return { visits: [], closedDays: [] };
  } catch {
    return { visits: [], closedDays: [] };
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

  const [visits, setVisits] = useState([]);
  const [closedDays, setClosedDays] = useState([]);
  const [monthDate, setMonthDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const [showForm, setShowForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [openVisit, setOpenVisit] = useState(null);
  const [openBusiness, setOpenBusiness] = useState(null);
  const [editingVisitId, setEditingVisitId] = useState(null);
  const [openClosedDay, setOpenClosedDay] = useState(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [backupStatus, setBackupStatus] = useState("");

  const [form, setForm] = useState({ ...EMPTY_VISIT_FORM });
  const [searchMode, setSearchMode] = useState("businessName");
  const [searchTerm, setSearchTerm] = useState("");
  const [showBadSearchResults, setShowBadSearchResults] = useState(false);

  const [closeForm, setCloseForm] = useState({
    type: "Día completo",
    reason: "",
  });

  useEffect(() => {
    function refreshData() {
      const data = loadData();
      setVisits(data.visits);
      setClosedDays(data.closedDays);
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

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // La app sigue funcionando aunque el móvil no permita instalarla como PWA.
    });
  }, []);

  const days = useMemo(() => makeCalendarDays(monthDate), [monthDate]);

  const visitsByDay = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      if (!map[v.date]) map[v.date] = [];
      map[v.date].push(v);
    });
    return map;
  }, [visits]);

  const closedByDay = useMemo(() => {
    const map = {};
    closedDays.forEach(c => {
      map[c.date] = c;
    });
    return map;
  }, [closedDays]);

  const selectedVisits = visits.filter(v => v.date === selectedDate);
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

  function persist(updatedVisits, updatedClosedDays) {
    saveData({ visits: updatedVisits, closedDays: updatedClosedDays });
  }

  function closeVisitForm() {
    setShowForm(false);
    setEditingVisitId(null);
    setForm({ ...EMPTY_VISIT_FORM });
    setLocationStatus("");
  }

  function openNewVisitForm() {
    setEditingVisitId(null);
    setForm({ ...EMPTY_VISIT_FORM });
    setLocationStatus("");
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

  if (editingVisitId) {
    const updatedVisits = visits.map(v => {
      if (v.id !== editingVisitId) return v;

      return {
        ...v,
        ...form,
        updatedAt: new Date().toISOString(),
      };
    });

    setVisits(updatedVisits);
    persist(updatedVisits, closedDays);

    setEditingVisitId(null);
  } else {
    const newVisit = {
      id: Date.now(),
      date: selectedDate,
      createdAt: new Date().toISOString(),
      ...form,
    };

    const updated = [...visits, newVisit];
    setVisits(updated);
    persist(updated, closedDays);
  }

    closeVisitForm();
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
    persist(visits, updatedClosedDays);

    setCloseForm({ type: "Día completo", reason: "" });
    setShowCloseForm(false);
  }
    function editVisit(visit) {
  setEditingVisitId(visit.id);

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
    setVisits(updated);
    persist(updated, closedDays);
    setOpenVisit(null);
  }

  function deleteClosedDay(date) {
    if (!window.confirm("¿Seguro que quieres eliminar este cierre?")) return;

    const updatedClosedDays = closedDays.filter(c => c.date !== date);
    setClosedDays(updatedClosedDays);
    persist(visits, updatedClosedDays);
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
      version: 4,
      exportedAt: new Date().toISOString(),
      data: { visits, closedDays },
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
                className={`day ${!isCurrentMonth ? "muted" : ""} ${isSelected ? "selected" : ""} ${closed ? "closed" : ""}`}
                onClick={() => setSelectedDate(key)}
              >
                <div className="dayHead">
                  <span className={`${isToday ? "today" : ""} ${isSunday ? "holiday" : ""}`}>
                    {day.getDate()}
                  </span>
                  {dayVisits.length > 0 && <b>{dayVisits.length}</b>}
                </div>

                {closed && <div className="closedTag">Cerrado / no trabajado</div>}

                <div className="tags">
                  {dayVisits.slice(0, 5).map(v => (
                    <div
                      key={v.id}
                      className="tag"
                      style={{ backgroundColor: colorValue(v.visitValue) }}
                    >
                      {v.businessName}
                    </div>
                  ))}
                  {dayVisits.length > 5 && <div className="more">+{dayVisits.length - 5} más</div>}
                </div>
              </button>
            );
          })}
        </div>

        <div className="side">
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
            🔎 Buscar visitas
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
            {selectedVisits.length === 0 && !selectedClosed && (
              <div className="empty">No hay visitas ni cierre marcado en este día.</div>
            )}

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
              <h2>Buscar visitas</h2>
              <button onClick={() => setShowSearch(false)}>×</button>
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

            <label>{searchMode === "postalCode" ? "Código postal" : "Nombre del negocio"}</label>
            <input
              autoFocus
              value={searchTerm}
              inputMode={searchMode === "postalCode" ? "numeric" : "text"}
              placeholder={searchMode === "postalCode" ? "Ej. 28010" : "Ej. Bar Radiance"}
              onChange={e => setSearchTerm(e.target.value)}
            />

            <label className="checkLine">
              <input
                type="checkbox"
                checked={showBadSearchResults}
                onChange={e => setShowBadSearchResults(e.target.checked)}
              />
              Mostrar también los marcados como “Malo - no volver”
            </label>

            {searchTerm.trim() && (
              <p className="small">
                {searchResults.length} {searchResults.length === 1 ? "negocio encontrado" : "negocios encontrados"}
              </p>
            )}

            <div className="searchResults">
              {!searchTerm.trim() && (
                <div className="empty">Escribe algo para empezar la búsqueda.</div>
              )}

              {searchTerm.trim() && searchResults.length === 0 && (
                <div className="empty">No he encontrado negocios con esa búsqueda.</div>
              )}

              {searchResults.map(result => (
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

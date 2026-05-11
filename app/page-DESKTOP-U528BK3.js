"use client";
import React, { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "visitas_app_pro_v2";

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

function loadData() {
  if (typeof window === "undefined") return { visits: [], closedDays: [] };
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { visits: [], closedDays: [] };
  } catch {
    return { visits: [], closedDays: [] };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function labelValue(value) {
  return valores.find(v => v.value === value)?.label || value;
}

function colorValue(value) {
  return valores.find(v => v.value === value)?.color || "#94a3b8";
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

  const [visits, setVisits] = useState([]);
  const [closedDays, setClosedDays] = useState([]);
  const [monthDate, setMonthDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const [showForm, setShowForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [openVisit, setOpenVisit] = useState(null);
  const [openClosedDay, setOpenClosedDay] = useState(null);

  const [form, setForm] = useState({
    businessName: "",
    contactName: "",
    visitType: tiposVisita[0],
    notes: "",
    visitValue: "normal",
  });

  const [closeForm, setCloseForm] = useState({
    type: "Día completo",
    reason: "",
  });

  useEffect(() => {
    const data = loadData();
    setVisits(data.visits || []);
    setClosedDays(data.closedDays || []);
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

  function persist(updatedVisits, updatedClosedDays) {
    saveData({ visits: updatedVisits, closedDays: updatedClosedDays });
  }

  function addVisit(e) {
    e.preventDefault();

    const newVisit = {
      id: Date.now(),
      date: selectedDate,
      createdAt: new Date().toISOString(),
      ...form,
    };

    const updated = [...visits, newVisit];
    setVisits(updated);
    persist(updated, closedDays);

    setForm({
      businessName: "",
      contactName: "",
      visitType: tiposVisita[0],
      notes: "",
      visitValue: "normal",
    });

    setShowForm(false);
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

  function deleteVisit(id) {
    const updated = visits.filter(v => v.id !== id);
    setVisits(updated);
    persist(updated, closedDays);
    setOpenVisit(null);
  }

  function deleteClosedDay(date) {
    const updatedClosedDays = closedDays.filter(c => c.date !== date);
    setClosedDays(updatedClosedDays);
    persist(visits, updatedClosedDays);
    setOpenClosedDay(null);
  }

  function exportCSV() {
    const rows = [
      ["Fecha", "Negocio", "Referente", "Tipo visita", "Valor", "Notas"],
      ...selectedVisits.map(v => [
        v.date,
        v.businessName,
        v.contactName,
        v.visitType || "",
        labelValue(v.visitValue),
        v.notes,
      ]),
    ];

    const csv = rows
      .map(row => row.map(cell => `"${String(cell || "").replaceAll('"', '""')}"`).join(";"))
      .join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `visitas-${selectedDate}.csv`;
    a.click();
  }

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <div className="small">Agenda de visitas realizadas</div>
          <h1>
            {monthDate.toLocaleDateString("es-ES", {
              month: "long",
              year: "numeric",
            })}
          </h1>
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

                {closed && (
                  <div className="closedTag">Cerrado / no trabajado</div>
                )}

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
                  {dayVisits.length > 5 && (
                    <div className="more">+{dayVisits.length - 5} más</div>
                  )}
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

          <button className="mainBtn" onClick={() => setShowForm(true)}>
            + Añadir visita
          </button>

          <button className="orangeBtn" onClick={() => setShowCloseForm(true)}>
            Cerrar día / parte del día
          </button>

          <button className="secondaryBtn" onClick={exportCSV} disabled={selectedVisits.length === 0}>
            Exportar día a Excel/CSV
          </button>

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
              <h2>Nueva visita</h2>
              <button type="button" onClick={() => setShowForm(false)}>×</button>
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

            <label>Valor de la visita</label>
            <select value={form.visitValue} onChange={e => setForm({ ...form, visitValue: e.target.value })}>
              {valores.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>

            <label>Notas</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />

            <button className="mainBtn" type="submit">Guardar visita</button>
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
            <p><b>Tipo:</b> {openVisit.visitType || "—"}</p>
            <p><b>Valor:</b> {labelValue(openVisit.visitValue)}</p>
            <p><b>Notas:</b></p>
            <div className="notes">{openVisit.notes || "Sin notas"}</div>

            <button className="deleteBtn" onClick={() => deleteVisit(openVisit.id)}>
              Eliminar visita
            </button>
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
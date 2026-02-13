import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ============================================================
// DATABASE LAYER — IndexedDB wrapper
// ============================================================
const DB_NAME = "meal-planner-db";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("recipes")) {
        const rs = db.createObjectStore("recipes", { keyPath: "id" });
        rs.createIndex("name", "name", { unique: false });
        rs.createIndex("category", "category", { unique: false });
        rs.createIndex("isFavorite", "isFavorite", { unique: false });
      }
      if (!db.objectStoreNames.contains("weekPlans")) {
        const ws = db.createObjectStore("weekPlans", { keyPath: "id" });
        ws.createIndex("weekStart", "weekStart", { unique: true });
      }
      if (!db.objectStoreNames.contains("knownIngredients")) {
        db.createObjectStore("knownIngredients", { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const s = tx.objectStore(store);
    const req = s.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(store, item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    const req = s.put(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    const req = s.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetByIndex(store, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const s = tx.objectStore(store);
    const idx = s.index(indexName);
    const req = idx.get(value);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const s = tx.objectStore(store);
    const req = s.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// UTILITIES
// ============================================================
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

const DAYS_PL = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];
const DAYS_SHORT = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];

const DEFAULT_CATEGORIES = [
  { value: "zupa", label: "🍲 Zupa", emoji: "🍲" },
  { value: "makaron", label: "🍝 Makaron", emoji: "🍝" },
  { value: "mięso", label: "🥩 Mięso", emoji: "🥩" },
  { value: "ryba", label: "🐟 Ryba", emoji: "🐟" },
  { value: "sałatka", label: "🥗 Sałatka", emoji: "🥗" },
  { value: "zapiekanka", label: "🫕 Zapiekanka", emoji: "🫕" },
  { value: "jednogarnkowe", label: "🥘 Jednogarnkowe", emoji: "🥘" },
  { value: "wegetariańskie", label: "🥦 Wegetariańskie", emoji: "🥦" },
  { value: "inne", label: "🍽️ Inne", emoji: "🍽️" },
];

function loadCustomCategories() {
  try {
    const data = localStorage.getItem("meal-planner-custom-categories");
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function saveCustomCategories(cats) {
  localStorage.setItem("meal-planner-custom-categories", JSON.stringify(cats));
}

// Will be overridden by App state — this is the initial value
let CATEGORIES = [...DEFAULT_CATEGORIES, ...loadCustomCategories()];

const UNITS = ["g", "kg", "ml", "l", "szt.", "łyżka", "łyżeczka", "szklanka", "opakowanie"];

const COMMON_TAGS = ["fit", "szybkie", "bezglutenowe", "wegetariańskie", "wegańskie", "lekkie", "sycące", "ostre", "na słodko"];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatDate(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDatePL(d) {
  return new Date(d).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

function createEmptyWeekPlan(monday) {
  const weekStart = formatDate(monday);
  return {
    id: uid(),
    weekStart,
    days: DAYS_PL.map((dayOfWeek, i) => ({
      date: formatDate(addDays(monday, i)),
      dayOfWeek,
      recipeId: null,
    })),
  };
}

function getCategoryEmoji(cat) {
  return CATEGORIES.find((c) => c.value === cat)?.emoji || "🍽️";
}

const MONTHS_PL = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];

function getMonthDays(year, month) {
  // Returns array of dates for calendar grid (includes padding from prev/next months)
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // 0=Mon
  const days = [];
  // Pad start
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d, inMonth: false });
  }
  // Month days
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push({ date: new Date(year, month, i), inMonth: true });
  }
  // Pad end to fill last row
  while (days.length % 7 !== 0) {
    const d = new Date(year, month + 1, days.length - lastDay.getDate() - startDow + 1);
    days.push({ date: d, inMonth: false });
  }
  return days;
}

// ============================================================
// STYLES (inline style objects + CSS classes via style tag)
// ============================================================
const COLORS = {
  bg: "#FDF6EC",
  bgAlt: "#FFF9F0",
  card: "#FFFFFF",
  primary: "#D4703A",
  primaryLight: "#F0A672",
  primaryPale: "#FDEBD5",
  accent: "#4A7C59",
  accentLight: "#8FBF9F",
  accentPale: "#E3F0E8",
  text: "#3B2F20",
  textMuted: "#8C7B6B",
  border: "#E8DDD0",
  borderLight: "#F0E8DC",
  danger: "#C94444",
  dangerPale: "#FDE8E8",
  heart: "#E25555",
  shadow: "0 2px 12px rgba(59,47,32,0.08)",
  shadowLg: "0 8px 32px rgba(59,47,32,0.12)",
};

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'DM Sans', sans-serif; 
      background: ${COLORS.bg}; 
      color: ${COLORS.text};
      min-height: 100vh;
    }
    h1, h2, h3 { font-family: 'DM Serif Display', serif; font-weight: 400; }
    input, select, textarea, button { font-family: inherit; }
    
    .nav-link { 
      padding: 10px 20px; border-radius: 12px; font-weight: 600; font-size: 15px;
      text-decoration: none; transition: all 0.2s; cursor: pointer;
      display: flex; align-items: center; gap: 8px; border: none; background: none;
      color: ${COLORS.textMuted};
    }
    .nav-link:hover { background: ${COLORS.primaryPale}; color: ${COLORS.primary}; }
    .nav-link.active { background: ${COLORS.primary}; color: white; }
    
    .btn {
      padding: 10px 20px; border-radius: 12px; font-weight: 600; font-size: 14px;
      border: none; cursor: pointer; transition: all 0.2s; display: inline-flex;
      align-items: center; gap: 8px; white-space: nowrap;
    }
    .btn-primary { background: ${COLORS.primary}; color: white; }
    .btn-primary:hover { background: #C06030; transform: translateY(-1px); box-shadow: ${COLORS.shadow}; }
    .btn-secondary { background: ${COLORS.primaryPale}; color: ${COLORS.primary}; }
    .btn-secondary:hover { background: #F5D9B8; }
    .btn-accent { background: ${COLORS.accent}; color: white; }
    .btn-accent:hover { background: #3D6A4B; }
    .btn-ghost { background: transparent; color: ${COLORS.textMuted}; }
    .btn-ghost:hover { background: ${COLORS.borderLight}; color: ${COLORS.text}; }
    .btn-danger { background: ${COLORS.dangerPale}; color: ${COLORS.danger}; }
    .btn-danger:hover { background: #FACACA; }
    .btn-sm { padding: 6px 14px; font-size: 13px; border-radius: 10px; }
    .btn-lg { padding: 14px 28px; font-size: 16px; border-radius: 14px; }
    
    .input {
      width: 100%; padding: 10px 14px; border: 2px solid ${COLORS.border};
      border-radius: 12px; font-size: 14px; background: white; color: ${COLORS.text};
      transition: border-color 0.2s; outline: none;
    }
    .input:focus { border-color: ${COLORS.primary}; }
    .input::placeholder { color: ${COLORS.textMuted}; }
    
    .card {
      background: ${COLORS.card}; border-radius: 16px; border: 1px solid ${COLORS.borderLight};
      box-shadow: ${COLORS.shadow}; transition: all 0.2s;
    }
    .card:hover { box-shadow: ${COLORS.shadowLg}; }
    
    .tag {
      display: inline-flex; align-items: center; padding: 4px 12px;
      border-radius: 20px; font-size: 12px; font-weight: 600;
      background: ${COLORS.accentPale}; color: ${COLORS.accent};
    }
    .tag-primary { background: ${COLORS.primaryPale}; color: ${COLORS.primary}; }
    
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(59,47,32,0.4);
      backdrop-filter: blur(4px); z-index: 100; display: flex;
      align-items: center; justify-content: center; padding: 20px;
      animation: fadeIn 0.2s ease;
    }
    .modal-content {
      background: white; border-radius: 20px; max-width: 700px; width: 100%;
      max-height: 85vh; overflow-y: auto; box-shadow: ${COLORS.shadowLg};
      animation: slideUp 0.3s ease;
    }
    
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes popIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    
    .fade-in { animation: fadeIn 0.3s ease; }
    .pop-in { animation: popIn 0.3s ease; }

    .today-highlight {
      border: 2px solid ${COLORS.primary} !important;
      box-shadow: 0 0 0 3px ${COLORS.primaryPale}, ${COLORS.shadow} !important;
    }

    .empty-slot {
      border: 2px dashed ${COLORS.border}; border-radius: 14px; padding: 24px 16px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      cursor: pointer; transition: all 0.2s; min-height: 120px;
      color: ${COLORS.textMuted}; gap: 8px;
    }
    .empty-slot:hover { border-color: ${COLORS.primary}; background: ${COLORS.primaryPale}; color: ${COLORS.primary}; }

    .meal-card-mini {
      border-radius: 14px; overflow: hidden; cursor: pointer; position: relative;
      transition: all 0.2s; border: 1px solid ${COLORS.borderLight};
    }
    .meal-card-mini:hover { transform: translateY(-2px); box-shadow: ${COLORS.shadow}; }

    .recipe-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }

    .checkbox-custom {
      width: 22px; height: 22px; border-radius: 6px; border: 2px solid ${COLORS.border};
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.2s; flex-shrink: 0;
    }
    .checkbox-custom.checked { background: ${COLORS.accent}; border-color: ${COLORS.accent}; }

    .scrollbar-hidden::-webkit-scrollbar { display: none; }
    .scrollbar-hidden { -ms-overflow-style: none; scrollbar-width: none; }

    /* === RESPONSIVE === */
    @media (max-width: 768px) {
      /* Week grid — single column list */
      .week-grid { grid-template-columns: 1fr !important; gap: 8px !important; }
      .week-grid .card { min-height: auto !important; }
      .week-grid .card > div:first-child { padding: 8px 12px !important; }
      .week-grid .card > div:last-child { padding: 8px !important; }
      .week-grid .meal-card-mini { display: flex !important; flex-direction: row !important; align-items: center !important; border-radius: 12px !important; }
      .week-grid .meal-card-mini > div:first-child { width: 64px !important; height: 64px !important; min-height: unset !important; flex-shrink: 0; border-radius: 12px 0 0 12px !important; overflow: hidden !important; }
      .week-grid .meal-card-mini > div:first-child img { height: 100% !important; }
      .week-grid .meal-card-mini > div:nth-child(2) { padding: 8px 10px !important; flex: 1; min-width: 0; }
      .week-grid .meal-card-mini > button { top: 50% !important; transform: translateY(-50%) !important; }
      .week-grid .empty-slot { min-height: 56px !important; padding: 10px !important; flex-direction: row !important; gap: 8px !important; }

      /* Recipe grid */
      .recipe-grid { grid-template-columns: 1fr !important; }
      
      /* Navbar — bottom bar on mobile */
      .app-nav {
        position: fixed !important; bottom: 0 !important; top: auto !important; left: 0; right: 0;
        padding: 6px 8px !important; justify-content: center !important;
        border-bottom: none !important; border-top: 1px solid ${COLORS.borderLight} !important;
        z-index: 50 !important;
      }
      .app-nav .nav-logo { display: none !important; }
      .app-nav .nav-links { gap: 2px !important; flex: 1; justify-content: space-around; }
      .app-nav .nav-link { padding: 8px 12px !important; font-size: 11px !important; flex-direction: column !important; gap: 2px !important; border-radius: 10px !important; }
      .app-nav .nav-link .nav-label-full { display: none !important; }
      .app-nav .nav-link .nav-label-short { display: block !important; }
      .app-nav .nav-divider { display: none !important; }

      /* Main content padding for bottom nav */
      .app-main { padding: 16px 12px 80px 12px !important; }
      
      /* Planner header mobile */
      .planner-header { flex-direction: column !important; align-items: stretch !important; gap: 10px !important; }
      .planner-header h1 { font-size: 20px !important; }
      .planner-title-row { flex-wrap: wrap !important; gap: 8px !important; }
      .planner-actions { flex-wrap: wrap !important; justify-content: center !important; gap: 6px !important; }
      .planner-actions .btn-label { display: none !important; }
      .planner-actions > span { font-size: 13px !important; min-width: 120px !important; }
      
      /* Month view mobile */
      .month-grid { gap: 2px !important; }
      .month-cell { min-height: 65px !important; padding: 3px !important; border-radius: 8px !important; }
      .month-cell-name { font-size: 9px !important; }

      /* Modal on mobile — slide up from bottom */
      .modal-overlay { padding: 0 !important; align-items: flex-end !important; }
      .modal-content { border-radius: 20px 20px 0 0 !important; max-height: 92vh !important; }

      /* Touch-friendly buttons */
      .btn { min-height: 40px; }
      .btn-sm { min-height: 36px; }

      /* Recipe detail mobile */
      .recipe-detail-top { flex-direction: column !important; }
      .recipe-detail-top > div:first-child { width: 100% !important; height: 180px !important; }
      .recipe-detail-actions { gap: 6px !important; }
      .recipe-detail-actions .btn { font-size: 12px !important; padding: 6px 10px !important; }

      /* Shopping list mobile */
      .shopping-item-row { padding: 12px 14px !important; }
    }

    @media (min-width: 769px) and (max-width: 1100px) {
      .week-grid { grid-template-columns: repeat(4, 1fr) !important; }
    }

    @media (min-width: 769px) {
      .nav-label-short { display: none !important; }
    }
  `}</style>
);

// ============================================================
// ICONS (simple SVG components)
// ============================================================
const Icon = ({ d, size = 20, color = "currentColor", fill = "none", strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const PlusIcon = (p) => <Icon {...p} d="M12 5v14M5 12h14" />;
const ChevronLeft = (p) => <Icon {...p} d="M15 18l-6-6 6-6" />;
const ChevronRight = (p) => <Icon {...p} d="M9 18l6-6-6-6" />;
const SearchIcon = (p) => <Icon {...p} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />;
const XIcon = (p) => <Icon {...p} d="M18 6L6 18M6 6l12 12" />;
const TrashIcon = (p) => <Icon {...p} d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />;
const ClockIcon = (p) => <Icon {...p} d="M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2" />;
const CopyIcon = (p) => <Icon {...p} d="M20 9h-9a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />;
const EditIcon = (p) => <Icon {...p} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />;
const CheckIcon = (p) => <Icon {...p} d="M20 6L9 17l-5-5" />;
const DownloadIcon = (p) => <Icon {...p} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />;
const UploadIcon = (p) => <Icon {...p} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />;
const SettingsIcon = (p) => (
  <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);
const SmartphoneIcon = (p) => (
  <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
  </svg>
);
const LinkIcon = (p) => <Icon {...p} d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />;
const ExternalLinkIcon = (p) => <Icon {...p} d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />;
const HistoryIcon = (p) => (
  <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>
  </svg>
);
const GridIcon = (p) => (
  <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
  </svg>
);

const HeartIcon = ({ filled, size = 20, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color || COLORS.heart : "none"} stroke={color || COLORS.heart} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
  </svg>
);

const CalendarIcon = (p) => (
  <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const BookIcon = (p) => (
  <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
  </svg>
);
const ShoppingCartIcon = (p) => (
  <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
  </svg>
);

const PrinterIcon = (p) => (
  <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
  </svg>
);

// ============================================================
// PRINT UTILITY
// ============================================================
function printContent(htmlContent, title) {
  const win = window.open("", "_blank", "width=800,height=600");
  win.document.write(`<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8"/>
  <title>${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; color: #3B2F20; padding: 32px; }
    h1 { font-family: 'DM Serif Display', serif; font-weight: 400; font-size: 24px; margin-bottom: 4px; }
    h2 { font-family: 'DM Serif Display', serif; font-weight: 400; font-size: 18px; margin-bottom: 12px; }
    .subtitle { color: #8C7B6B; font-size: 14px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { border: 1px solid #E8DDD0; padding: 10px 14px; text-align: left; font-size: 14px; }
    th { background: #FDF6EC; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #8C7B6B; }
    td { vertical-align: top; }
    .recipe-name { font-weight: 600; }
    .recipe-time { color: #8C7B6B; font-size: 12px; }
    .empty { color: #8C7B6B; font-style: italic; }
    .shopping-item { padding: 8px 0; border-bottom: 1px solid #F0E8DC; display: flex; gap: 12px; align-items: baseline; font-size: 14px; }
    .shopping-item:last-child { border-bottom: none; }
    .checkbox { width: 14px; height: 14px; border: 2px solid #E8DDD0; border-radius: 3px; flex-shrink: 0; margin-top: 2px; }
    .ingredient-name { font-weight: 600; }
    .ingredient-qty { color: #D4703A; font-weight: 600; min-width: 80px; }
    .ingredient-from { color: #8C7B6B; font-size: 12px; }
    .footer { margin-top: 32px; text-align: center; color: #8C7B6B; font-size: 12px; border-top: 1px solid #E8DDD0; padding-top: 16px; }
    @media print {
      body { padding: 16px; }
      @page { margin: 1.5cm; }
    }
  </style>
</head>
<body>
  ${htmlContent}
  <div class="footer">Meal Planner • Wydrukowano ${new Date().toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" })}</div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`);
  win.document.close();
}

// ============================================================
// MODAL COMPONENT
// ============================================================
const Modal = ({ isOpen, onClose, title, children, wide }) => {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: wide ? 900 : 700, padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: `1px solid ${COLORS.borderLight}` }}>
          <h2 style={{ fontSize: 22 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><XIcon /></button>
        </div>
        <div style={{ padding: "20px 24px" }}>{children}</div>
      </div>
    </div>
  );
};

// ============================================================
// CONFIRM DIALOG
// ============================================================
const ConfirmDialog = ({ isOpen, onConfirm, onCancel, message }) => {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" style={{ maxWidth: 400, padding: 28, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <p style={{ fontSize: 16, marginBottom: 24, lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button className="btn btn-ghost" onClick={onCancel}>Anuluj</button>
          <button className="btn btn-danger" onClick={onConfirm}>Usuń</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// RECIPE FORM COMPONENT
// ============================================================
const RecipeForm = ({ recipe, onSave, onCancel, knownIngredients }) => {
  const [name, setName] = useState(recipe?.name || "");
  const [category, setCategory] = useState(recipe?.category || "inne");
  const [tags, setTags] = useState(recipe?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [prepTime, setPrepTime] = useState(recipe?.prepTime || 30);
  const [imageUrl, setImageUrl] = useState(recipe?.imageUrl || "");
  const [ingredients, setIngredients] = useState(
    recipe?.ingredients?.length ? recipe.ingredients : [{ id: uid(), name: "", quantity: 0, unit: "g", productUrl: "" }]
  );
  const [steps, setSteps] = useState(recipe?.steps?.length ? recipe.steps : [""]);
  const [description, setDescription] = useState(recipe?.description || "");

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageUrl(reader.result);
    reader.readAsDataURL(file);
  };

  const addIngredient = () => setIngredients([...ingredients, { id: uid(), name: "", quantity: 0, unit: "g", productUrl: "" }]);
  const removeIngredient = (id) => setIngredients(ingredients.filter((i) => i.id !== id));
  const updateIngredient = (id, field, value) =>
    setIngredients(ingredients.map((i) => (i.id === id ? { ...i, [field]: value } : i)));

  const addTag = (t) => {
    const tag = t.trim().toLowerCase();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput("");
  };

  const handleSubmit = () => {
    if (!name.trim()) return alert("Podaj nazwę dania");
    const validIngredients = ingredients.filter((i) => i.name.trim());
    const validSteps = steps.filter((s) => s.trim());
    const now = new Date().toISOString();
    onSave({
      id: recipe?.id || uid(),
      name: name.trim(),
      description,
      category,
      tags,
      prepTime,
      imageUrl,
      ingredients: validIngredients,
      steps: validSteps,
      isFavorite: recipe?.isFavorite || false,
      createdAt: recipe?.createdAt || now,
      updatedAt: now,
    });
  };

  const fieldStyle = { marginBottom: 20 };
  const labelStyle = { display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14, color: COLORS.textMuted };

  return (
    <div style={{ maxHeight: "65vh", overflowY: "auto" }} className="scrollbar-hidden">
      <div style={fieldStyle}>
        <label style={labelStyle}>Nazwa dania *</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Kurczak w sosie śmietanowym" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, ...fieldStyle }}>
        <div>
          <label style={labelStyle}>Kategoria *</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Czas przygotowania (min) *</label>
          <input className="input" type="number" min={1} value={prepTime} onChange={(e) => setPrepTime(Number(e.target.value))} />
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Tagi</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {tags.map((t) => (
            <span key={t} className="tag" style={{ cursor: "pointer" }} onClick={() => setTags(tags.filter((x) => x !== t))}>
              {t} ×
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ maxWidth: 200 }}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } }}
            placeholder="Dodaj tag..."
          />
          {COMMON_TAGS.filter((t) => !tags.includes(t)).slice(0, 5).map((t) => (
            <button key={t} className="btn btn-sm btn-secondary" onClick={() => addTag(t)}>{t}</button>
          ))}
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Zdjęcie</label>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {imageUrl && (
            <div style={{ width: 80, height: 80, borderRadius: 12, overflow: "hidden", flexShrink: 0 }}>
              <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          )}
          <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
            📷 {imageUrl ? "Zmień" : "Dodaj"} zdjęcie
            <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
          </label>
          {imageUrl && <button className="btn btn-ghost btn-sm" onClick={() => setImageUrl("")}>Usuń</button>}
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Składniki</label>
        {ingredients.map((ing, idx) => (
          <div key={ing.id} style={{ marginBottom: 12, padding: 12, background: COLORS.bgAlt, borderRadius: 12 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input
                className="input"
                style={{ flex: 2 }}
                value={ing.name}
                onChange={(e) => updateIngredient(ing.id, "name", e.target.value)}
                placeholder="Nazwa składnika"
                list="ingredient-suggestions"
              />
              <input
                className="input"
                style={{ flex: 0.7 }}
                type="number"
                min={0}
                step="any"
                value={ing.quantity || ""}
                onChange={(e) => updateIngredient(ing.id, "quantity", Number(e.target.value))}
                placeholder="Ilość"
              />
              <select
                className="input"
                style={{ flex: 0.8 }}
                value={ing.unit}
                onChange={(e) => updateIngredient(ing.id, "unit", e.target.value)}
              >
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              {ingredients.length > 1 && (
                <button className="btn btn-ghost btn-sm" onClick={() => removeIngredient(ing.id)} style={{ padding: 6 }}>
                  <XIcon size={16} />
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <LinkIcon size={16} color={COLORS.textMuted} />
              <input
                className="input"
                style={{ flex: 1, fontSize: 13, padding: "6px 10px" }}
                value={ing.productUrl || ""}
                onChange={(e) => updateIngredient(ing.id, "productUrl", e.target.value)}
                placeholder="Link do produktu w sklepie (opcjonalnie)"
              />
              {ing.productUrl && (
                <a href={ing.productUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ padding: 6 }} onClick={(e) => e.stopPropagation()}>
                  <ExternalLinkIcon size={16} />
                </a>
              )}
            </div>
          </div>
        ))}
        <datalist id="ingredient-suggestions">
          {knownIngredients.map((n) => <option key={n} value={n} />)}
        </datalist>
        <button className="btn btn-sm btn-secondary" onClick={addIngredient}>
          <PlusIcon size={16} /> Dodaj składnik
        </button>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Kroki przygotowania (opcjonalnie)</label>
        {steps.map((step, idx) => (
          <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
            <span style={{ fontWeight: 700, color: COLORS.primary, marginTop: 10, minWidth: 24 }}>{idx + 1}.</span>
            <textarea
              className="input"
              rows={2}
              value={step}
              onChange={(e) => {
                const newSteps = [...steps];
                newSteps[idx] = e.target.value;
                setSteps(newSteps);
              }}
              placeholder="Opisz krok..."
              style={{ resize: "vertical" }}
            />
            {steps.length > 1 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSteps(steps.filter((_, i) => i !== idx))} style={{ padding: 6, marginTop: 6 }}>
                <XIcon size={16} />
              </button>
            )}
          </div>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={() => setSteps([...steps, ""])}>
          <PlusIcon size={16} /> Dodaj krok
        </button>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Opis / Notatki</label>
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Dodatkowe uwagi..." style={{ resize: "vertical" }} />
      </div>

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", paddingTop: 16, borderTop: `1px solid ${COLORS.borderLight}` }}>
        <button className="btn btn-ghost" onClick={onCancel}>Anuluj</button>
        <button className="btn btn-primary btn-lg" onClick={handleSubmit}>
          {recipe?.id ? "Zapisz zmiany" : "Dodaj przepis"}
        </button>
      </div>
    </div>
  );
};

// ============================================================
// RECIPE DETAIL VIEW
// ============================================================
const RecipeDetail = ({ recipe, onClose, onEdit, onToggleFavorite }) => {
  const [shareStatus, setShareStatus] = useState(null);

  if (!recipe) return null;

  const shareRecipeLink = () => {
    // Encode recipe without image (too large for URL) as base64 in hash
    const shareData = {
      ...recipe,
      imageUrl: "", // strip image — too large for URL
      _shared: true,
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shareData))));
    const url = `${window.location.origin}${window.location.pathname}#recipe=${encoded}`;
    if (url.length > 8000) {
      // Fallback: copy JSON to clipboard
      navigator.clipboard.writeText(JSON.stringify(shareData, null, 2));
      setShareStatus("json");
    } else {
      navigator.clipboard.writeText(url);
      setShareStatus("link");
    }
    setTimeout(() => setShareStatus(null), 3000);
  };

  const exportRecipeJSON = () => {
    const json = JSON.stringify(recipe, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recipe.name.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]/g, "").replace(/\s+/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const printRecipe = () => {
    const ingredientsHtml = recipe.ingredients.map((ing) =>
      `<div class="ing-row">
        <span class="ing-name">${ing.name}</span>
        <span class="ing-qty">${ing.quantity} ${ing.unit}</span>
      </div>`
    ).join("");

    const stepsHtml = (recipe.steps || []).map((step, idx) =>
      `<div class="step-row">
        <div class="step-num">${idx + 1}</div>
        <p>${step}</p>
      </div>`
    ).join("");

    const tagsHtml = recipe.tags?.length
      ? `<div class="tags">${recipe.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>`
      : "";

    printContent(
      `<div class="recipe-header">
        <h1>${recipe.name}</h1>
        <div class="meta">
          <span>${getCategoryEmoji(recipe.category)} ${recipe.category}</span>
          <span>⏱ ${recipe.prepTime} min</span>
        </div>
        ${tagsHtml}
        ${recipe.description ? `<p class="desc">${recipe.description}</p>` : ""}
      </div>
      ${recipe.ingredients.length > 0 ? `
        <h2>Składniki</h2>
        <div class="ingredients">${ingredientsHtml}</div>
      ` : ""}
      ${(recipe.steps || []).length > 0 ? `
        <h2>Przygotowanie</h2>
        <div class="steps">${stepsHtml}</div>
      ` : ""}
      <style>
        .recipe-header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #E8DDD0; }
        .meta { display: flex; gap: 16px; color: #8C7B6B; font-size: 14px; margin: 8px 0; }
        .desc { color: #8C7B6B; font-size: 14px; line-height: 1.6; margin-top: 8px; }
        .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .tag { background: #FDF6EC; color: #8C7B6B; padding: 3px 10px; border-radius: 12px; font-size: 12px; }
        .ingredients { margin-bottom: 24px; }
        .ing-row { display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #F0E8DC; font-size: 14px; }
        .ing-row:last-child { border-bottom: none; }
        .ing-name { font-weight: 600; }
        .ing-qty { color: #D4703A; font-weight: 600; }
        .steps { margin-bottom: 24px; }
        .step-row { display: flex; gap: 14px; margin-bottom: 14px; align-items: flex-start; }
        .step-num { width: 28px; height: 28px; border-radius: 50%; background: #D4783A; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; }
        .step-row p { font-size: 14px; line-height: 1.6; padding-top: 3px; }
      </style>`,
      `${recipe.name} — Meal Planner`
    );
  };

  return (
    <div style={{ maxHeight: "65vh", overflowY: "auto" }} className="scrollbar-hidden">
      <div className="recipe-detail-top" style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        {recipe.imageUrl ? (
          <div style={{ width: 200, height: 200, borderRadius: 16, overflow: "hidden", flexShrink: 0 }}>
            <img src={recipe.imageUrl} alt={recipe.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        ) : (
          <div style={{ width: 200, height: 200, borderRadius: 16, background: COLORS.primaryPale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, flexShrink: 0 }}>
            {getCategoryEmoji(recipe.category)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h2 style={{ fontSize: 26 }}>{recipe.name}</h2>
            <button onClick={() => onToggleFavorite(recipe.id)} style={{ background: "none", border: "none", cursor: "pointer" }}>
              <HeartIcon filled={recipe.isFavorite} size={24} />
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span className="tag tag-primary">{getCategoryEmoji(recipe.category)} {recipe.category}</span>
            <span className="tag" style={{ background: COLORS.primaryPale, color: COLORS.primary }}>
              <ClockIcon size={14} />&nbsp;{recipe.prepTime} min
            </span>
            {recipe.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          </div>
          {recipe.description && <p style={{ color: COLORS.textMuted, lineHeight: 1.6 }}>{recipe.description}</p>}
          <div className="recipe-detail-actions" style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => onEdit(recipe)}><EditIcon size={16} /> Edytuj</button>
            <button className="btn btn-secondary btn-sm" onClick={printRecipe}><PrinterIcon size={16} /> Drukuj / PDF</button>
            <button className="btn btn-secondary btn-sm" onClick={shareRecipeLink}>
              {shareStatus === "link" ? <><CheckIcon size={16} /> Link skopiowany!</> :
               shareStatus === "json" ? <><CheckIcon size={16} /> JSON skopiowany!</> :
               <><LinkIcon size={16} /> Udostępnij</>}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={exportRecipeJSON}><DownloadIcon size={16} /> JSON</button>
          </div>
        </div>
      </div>

      {recipe.ingredients.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Składniki</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {recipe.ingredients.map((ing) => (
              <div key={ing.id} style={{ padding: "10px 14px", background: COLORS.bgAlt, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 500 }}>{ing.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: COLORS.primary, fontWeight: 600 }}>{ing.quantity} {ing.unit}</span>
                  {ing.productUrl && (
                    <a href={ing.productUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", color: COLORS.accent }} title="Otwórz w sklepie">
                      <ExternalLinkIcon size={16} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recipe.steps?.length > 0 && (
        <div>
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Przygotowanie</h3>
          {recipe.steps.map((step, idx) => (
            <div key={idx} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: COLORS.primary, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {idx + 1}
              </div>
              <p style={{ lineHeight: 1.6, paddingTop: 4 }}>{step}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// RECIPE PICKER MODAL (for planner)
// ============================================================
const RecipePicker = ({ recipes, onPick, onClose, weekPlan, initialDayIdx }) => {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [selectedDays, setSelectedDays] = useState([]);

  // Sync initialDayIdx into selectedDays on mount / change
  useEffect(() => {
    if (initialDayIdx !== null && initialDayIdx !== undefined) {
      setSelectedDays([initialDayIdx]);
    }
  }, [initialDayIdx]);

  const filtered = recipes.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat && r.category !== filterCat) return false;
    return true;
  });

  const toggleDay = (idx) => {
    setSelectedDays((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]);
  };

  const confirmSelection = () => {
    if (!selectedRecipeId || selectedDays.length === 0) return;
    onPick(selectedRecipeId, selectedDays);
    onClose();
  };

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj przepisu..."
          />
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <SearchIcon size={18} color={COLORS.textMuted} />
          </div>
        </div>
        <select className="input" style={{ width: "auto", minWidth: 160 }} value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="">Wszystkie kategorie</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* Day selector - shown when recipe is selected */}
      {selectedRecipeId && (
        <div style={{ marginBottom: 20, padding: 16, background: COLORS.primaryPale, borderRadius: 14 }} className="pop-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{selectedRecipe?.name}</span>
              <span style={{ color: COLORS.textMuted, fontSize: 13, marginLeft: 8 }}>— wybierz dni:</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedRecipeId(null); setSelectedDays(initialDayIdx !== null && initialDayIdx !== undefined ? [initialDayIdx] : []); }}>
              <XIcon size={16} /> Zmień danie
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {DAYS_SHORT.map((dayName, idx) => {
              const isSelected = selectedDays.includes(idx);
              const hasRecipe = weekPlan?.days[idx]?.recipeId;
              return (
                <button
                  key={idx}
                  className={`btn btn-sm ${isSelected ? "btn-primary" : "btn-secondary"}`}
                  style={{ minWidth: 52, position: "relative" }}
                  onClick={() => toggleDay(idx)}
                >
                  {dayName}
                  {hasRecipe && !isSelected && (
                    <span style={{ position: "absolute", top: -4, right: -4, width: 8, height: 8, borderRadius: "50%", background: COLORS.primary, border: "2px solid white" }} />
                  )}
                </button>
              );
            })}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setSelectedDays(selectedDays.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6])}
              style={{ fontSize: 12 }}
            >
              {selectedDays.length === 7 ? "Odznacz wszystkie" : "Zaznacz wszystkie"}
            </button>
          </div>
          {selectedDays.length > 0 && (
            <button className="btn btn-primary" onClick={confirmSelection}>
              <CheckIcon size={16} /> Przypisz do {selectedDays.length} {selectedDays.length === 1 ? "dnia" : selectedDays.length < 5 ? "dni" : "dni"}
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>🍳</p>
          <p>Brak przepisów. Dodaj pierwszy przepis w zakładce „Przepisy".</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, maxHeight: 400, overflowY: "auto" }} className="scrollbar-hidden">
          {filtered.map((r) => {
            const isSelected = r.id === selectedRecipeId;
            return (
              <div
                key={r.id}
                className="card pop-in"
                style={{ cursor: "pointer", overflow: "hidden", outline: isSelected ? `3px solid ${COLORS.primary}` : "none", outlineOffset: -1 }}
                onClick={() => { setSelectedRecipeId(r.id); setSelectedDays(initialDayIdx !== null && initialDayIdx !== undefined ? [initialDayIdx] : []); }}
              >
                {r.imageUrl ? (
                  <div style={{ height: 100, overflow: "hidden" }}>
                    <img src={r.imageUrl} alt={r.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                ) : (
                  <div style={{ height: 100, background: COLORS.primaryPale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>
                    {getCategoryEmoji(r.category)}
                  </div>
                )}
                <div style={{ padding: 12 }}>
                  <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{r.name}</p>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", color: COLORS.textMuted, fontSize: 12 }}>
                    <ClockIcon size={14} /> {r.prepTime} min
                    <span style={{ marginLeft: "auto" }}>{getCategoryEmoji(r.category)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================
// MONTH RECIPE PICKER (multi-day picker with calendar date selection)
// ============================================================
const MonthRecipePicker = ({ recipes, onPick, onClose, monthDate, monthPlans, initialDate }) => {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [selectedDates, setSelectedDates] = useState(initialDate ? [initialDate] : []);

  const filtered = recipes.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat && r.category !== filterCat) return false;
    return true;
  });

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  const mDays = useMemo(() => getMonthDays(monthDate.getFullYear(), monthDate.getMonth()), [monthDate]);
  const todayStr = formatDate(new Date());

  const toggleDate = (dateStr) => {
    setSelectedDates((prev) => prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr]);
  };

  const confirmSelection = () => {
    if (!selectedRecipeId || selectedDates.length === 0) return;
    onPick(selectedRecipeId, selectedDates);
    onClose();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj przepisu..."
          />
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <SearchIcon size={18} color={COLORS.textMuted} />
          </div>
        </div>
        <select className="input" style={{ width: "auto", minWidth: 160 }} value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="">Wszystkie kategorie</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* Date selector - shown when recipe is selected */}
      {selectedRecipeId && (
        <div style={{ marginBottom: 20, padding: 16, background: COLORS.primaryPale, borderRadius: 14 }} className="pop-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{selectedRecipe?.name}</span>
              <span style={{ color: COLORS.textMuted, fontSize: 13, marginLeft: 8 }}>— wybierz dni na kalendarzu:</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedRecipeId(null); setSelectedDates(initialDate ? [initialDate] : []); }}>
              <XIcon size={16} /> Zmień danie
            </button>
          </div>
          {/* Mini calendar for date selection */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
              {DAYS_SHORT.map((d) => (
                <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: COLORS.textMuted, padding: "2px 0" }}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {mDays.map(({ date, inMonth }, i) => {
                const dateStr = formatDate(date);
                const isSelected = selectedDates.includes(dateStr);
                const hasRecipe = !!monthPlans[dateStr];
                const isToday = dateStr === todayStr;
                return (
                  <button
                    key={i}
                    onClick={() => { if (inMonth) toggleDate(dateStr); }}
                    style={{
                      padding: "6px 2px",
                      borderRadius: 8,
                      border: isToday ? `2px solid ${COLORS.primary}` : "2px solid transparent",
                      background: isSelected ? COLORS.primary : "transparent",
                      color: isSelected ? "white" : inMonth ? COLORS.text : COLORS.borderLight,
                      fontWeight: isSelected || isToday ? 700 : 400,
                      fontSize: 13,
                      cursor: inMonth ? "pointer" : "default",
                      position: "relative",
                      transition: "all 0.1s",
                    }}
                  >
                    {date.getDate()}
                    {hasRecipe && !isSelected && inMonth && (
                      <span style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: COLORS.primary }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {selectedDates.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn btn-primary" onClick={confirmSelection}>
                <CheckIcon size={16} /> Przypisz do {selectedDates.length} {selectedDates.length === 1 ? "dnia" : selectedDates.length < 5 ? "dni" : "dni"}
              </button>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                {selectedDates.sort().map((d) => formatDatePL(d)).join(", ")}
              </span>
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>🍳</p>
          <p>Brak przepisów. Dodaj pierwszy przepis w zakładce „Przepisy".</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, maxHeight: selectedRecipeId ? 250 : 400, overflowY: "auto" }} className="scrollbar-hidden">
          {filtered.map((r) => {
            const isSelected = r.id === selectedRecipeId;
            return (
              <div
                key={r.id}
                className="card pop-in"
                style={{ cursor: "pointer", overflow: "hidden", outline: isSelected ? `3px solid ${COLORS.primary}` : "none", outlineOffset: -1 }}
                onClick={() => { setSelectedRecipeId(r.id); if (!selectedDates.length && initialDate) setSelectedDates([initialDate]); }}
              >
                {r.imageUrl ? (
                  <div style={{ height: 100, overflow: "hidden" }}>
                    <img src={r.imageUrl} alt={r.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                ) : (
                  <div style={{ height: 100, background: COLORS.primaryPale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>
                    {getCategoryEmoji(r.category)}
                  </div>
                )}
                <div style={{ padding: 12 }}>
                  <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{r.name}</p>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", color: COLORS.textMuted, fontSize: 12 }}>
                    <ClockIcon size={14} /> {r.prepTime} min
                    <span style={{ marginLeft: "auto" }}>{getCategoryEmoji(r.category)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================
// PLANNER PAGE
// ============================================================
const PlannerPage = ({ recipes, weekPlan, setWeekPlan, weekMonday, setWeekMonday, saveWeekPlan, loadWeekPlan }) => {
  const [pickerState, setPickerState] = useState({ open: false, dayIdx: null });
  const openPicker = (dayIdx) => setPickerState({ open: true, dayIdx });
  const closePicker = () => setPickerState({ open: false, dayIdx: null });
  const [detailRecipe, setDetailRecipe] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPlans, setHistoryPlans] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewMode, setViewMode] = useState("week"); // "week" | "month"
  const [monthDate, setMonthDate] = useState(new Date());
  const [monthPlans, setMonthPlans] = useState({});

  const today = formatDate(new Date());

  const navigateWeek = (dir) => {
    const newMonday = addDays(weekMonday, dir * 7);
    setWeekMonday(newMonday);
    loadWeekPlan(newMonday);
  };

  const goToday = () => {
    const m = getMonday(new Date());
    setWeekMonday(m);
    loadWeekPlan(m);
  };

  const assignRecipe = (recipeId, dayIndices) => {
    const newPlan = { ...weekPlan };
    newPlan.days = [...newPlan.days];
    for (const idx of dayIndices) {
      newPlan.days[idx] = { ...newPlan.days[idx], recipeId };
    }
    setWeekPlan(newPlan);
    saveWeekPlan(newPlan);
  };

  const openHistory = async () => {
    setHistoryLoading(true);
    setHistoryOpen(true);
    const allPlans = await dbGetAll("weekPlans");
    // Sort by weekStart descending, exclude current week
    const currentWeekStart = formatDate(weekMonday);
    const sorted = allPlans
      .filter((p) => p.days.some((d) => d.recipeId))
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    setHistoryPlans(sorted);
    setHistoryLoading(false);
  };

  const jumpToWeek = (weekStart) => {
    const monday = new Date(weekStart + "T00:00:00");
    setWeekMonday(monday);
    loadWeekPlan(monday);
    setHistoryOpen(false);
  };

  const copyFromHistory = async (plan) => {
    const newPlan = {
      ...weekPlan,
      days: weekPlan.days.map((day, idx) => ({
        ...day,
        recipeId: plan.days[idx]?.recipeId || null,
      })),
    };
    setWeekPlan(newPlan);
    saveWeekPlan(newPlan);
    setHistoryOpen(false);
  };

  // Month view data
  const loadMonthPlans = useCallback(async () => {
    const allPlans = await dbGetAll("weekPlans");
    const map = {};
    for (const plan of allPlans) {
      for (const day of plan.days) {
        if (day.recipeId) {
          map[day.date] = day.recipeId;
        }
      }
    }
    // Override with current weekPlan from state (most up-to-date)
    if (weekPlan) {
      for (const day of weekPlan.days) {
        if (day.recipeId) {
          map[day.date] = day.recipeId;
        } else {
          delete map[day.date];
        }
      }
    }
    setMonthPlans(map);
  }, [weekPlan]);

  useEffect(() => {
    if (viewMode === "month") {
      loadMonthPlans();
    }
  }, [viewMode, monthDate, loadMonthPlans]);

  const navigateMonth = (dir) => {
    setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  };

  const monthDays = useMemo(() => getMonthDays(monthDate.getFullYear(), monthDate.getMonth()), [monthDate]);
  const monthLabel = `${MONTHS_PL[monthDate.getMonth()]} ${monthDate.getFullYear()}`;

  const switchToWeekFromDay = (date) => {
    const monday = getMonday(date);
    setWeekMonday(monday);
    loadWeekPlan(monday);
    setViewMode("week");
  };

  const clearDay = (idx) => {
    const newPlan = { ...weekPlan };
    newPlan.days = [...newPlan.days];
    newPlan.days[idx] = { ...newPlan.days[idx], recipeId: null };
    setWeekPlan(newPlan);
    saveWeekPlan(newPlan);
  };

  // Drag & drop
  const [dragData, setDragData] = useState(null); // { recipeId, sourceType: "week"|"month", sourceIdx?, sourceDate? }
  const [dropTarget, setDropTarget] = useState(null); // { type: "week"|"month", idx?, date? }

  const handleWeekDragStart = (e, idx, recipeId) => {
    setDragData({ recipeId, sourceType: "week", sourceIdx: idx });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", recipeId);
  };

  const handleMonthDragStart = (e, dateStr, recipeId) => {
    setDragData({ recipeId, sourceType: "month", sourceDate: dateStr });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", recipeId);
  };

  const handleWeekDrop = (e, targetIdx) => {
    e.preventDefault();
    setDropTarget(null);
    if (!dragData) return;

    if (dragData.sourceType === "week") {
      // Swap within week
      const newPlan = { ...weekPlan, days: [...weekPlan.days] };
      const targetRecipeId = newPlan.days[targetIdx].recipeId;
      newPlan.days[targetIdx] = { ...newPlan.days[targetIdx], recipeId: dragData.recipeId };
      newPlan.days[dragData.sourceIdx] = { ...newPlan.days[dragData.sourceIdx], recipeId: targetRecipeId };
      setWeekPlan(newPlan);
      saveWeekPlan(newPlan);
    } else if (dragData.sourceType === "month") {
      // From month to week — assign to target day and clear source
      const newPlan = { ...weekPlan, days: [...weekPlan.days] };
      newPlan.days[targetIdx] = { ...newPlan.days[targetIdx], recipeId: dragData.recipeId };
      setWeekPlan(newPlan);
      saveWeekPlan(newPlan);
      removeRecipeFromDate(dragData.sourceDate);
    }
    setDragData(null);
  };

  const handleMonthDrop = async (e, targetDateStr) => {
    e.preventDefault();
    setDropTarget(null);
    if (!dragData) return;

    if (dragData.sourceType === "month" && dragData.sourceDate !== targetDateStr) {
      // Swap within month
      const targetRecipeId = monthPlans[targetDateStr] || null;
      await assignRecipeToDate(dragData.recipeId, targetDateStr);
      if (targetRecipeId) {
        await assignRecipeToDate(targetRecipeId, dragData.sourceDate);
      } else {
        await removeRecipeFromDate(dragData.sourceDate);
      }
    } else if (dragData.sourceType === "week") {
      // From week to month
      await assignRecipeToDate(dragData.recipeId, targetDateStr);
      clearDay(dragData.sourceIdx);
    }
    setDragData(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  // Month view: assign recipe to a specific date
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthPickerDate, setMonthPickerDate] = useState(null);

  const assignRecipeToDate = async (recipeId, dateStr) => {
    const monday = getMonday(new Date(dateStr + "T00:00:00"));
    const weekStart = formatDate(monday);
    let plan = await dbGetByIndex("weekPlans", "weekStart", weekStart);
    if (!plan) {
      plan = createEmptyWeekPlan(monday);
    }
    const dayIdx = plan.days.findIndex((d) => d.date === dateStr);
    if (dayIdx === -1) return;
    plan.days[dayIdx] = { ...plan.days[dayIdx], recipeId };
    await dbPut("weekPlans", plan);
    // If this is the current week, update state
    if (weekStart === formatDate(weekMonday)) {
      setWeekPlan(plan);
    }
    // Refresh month
    setMonthPlans((prev) => ({ ...prev, [dateStr]: recipeId }));
  };

  const removeRecipeFromDate = async (dateStr) => {
    const monday = getMonday(new Date(dateStr + "T00:00:00"));
    const weekStart = formatDate(monday);
    let plan = await dbGetByIndex("weekPlans", "weekStart", weekStart);
    if (!plan) return;
    const dayIdx = plan.days.findIndex((d) => d.date === dateStr);
    if (dayIdx === -1) return;
    plan.days[dayIdx] = { ...plan.days[dayIdx], recipeId: null };
    await dbPut("weekPlans", plan);
    if (weekStart === formatDate(weekMonday)) {
      setWeekPlan(plan);
    }
    setMonthPlans((prev) => {
      const next = { ...prev };
      delete next[dateStr];
      return next;
    });
  };

  const handleMonthPickerPick = async (recipeId, dates) => {
    for (const dateStr of dates) {
      await assignRecipeToDate(recipeId, dateStr);
    }
    setMonthPickerOpen(false);
    setMonthPickerDate(null);
  };

  const copyLastWeek = async () => {
    const lastMonday = addDays(weekMonday, -7);
    const lastPlan = await dbGetByIndex("weekPlans", "weekStart", formatDate(lastMonday));
    if (!lastPlan) {
      alert("Brak planu z zeszłego tygodnia!");
      return;
    }
    const newPlan = {
      ...weekPlan,
      days: weekPlan.days.map((day, idx) => ({
        ...day,
        recipeId: lastPlan.days[idx]?.recipeId || null,
      })),
    };
    setWeekPlan(newPlan);
    saveWeekPlan(newPlan);
  };

  const getRecipeById = (id) => recipes.find((r) => r.id === id);

  const weekLabel = `${formatDatePL(weekMonday)} — ${formatDatePL(addDays(weekMonday, 6))}`;

  const printPlan = () => {
    const rows = weekPlan.days.map((day, idx) => {
      const recipe = day.recipeId ? getRecipeById(day.recipeId) : null;
      return `<tr>
        <td><strong>${DAYS_PL[idx]}</strong><br/><span class="recipe-time">${formatDatePL(day.date)}</span></td>
        <td>${recipe
          ? `<span class="recipe-name">${recipe.name}</span><br/><span class="recipe-time">${getCategoryEmoji(recipe.category)} ${recipe.category} • ${recipe.prepTime} min</span>`
          : `<span class="empty">— brak —</span>`
        }</td>
        <td>${recipe
          ? recipe.ingredients.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(", ")
          : ""
        }</td>
      </tr>`;
    }).join("");

    printContent(
      `<h1>📅 Plan obiadów na tydzień</h1>
       <p class="subtitle">${weekLabel}</p>
       <table>
         <thead><tr><th>Dzień</th><th>Danie</th><th>Składniki</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>`,
      `Plan obiadów — ${weekLabel}`
    );
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="planner-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div className="planner-title-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 28 }}>📅 {viewMode === "week" ? "Plan tygodnia" : "Plan miesiąca"}</h1>
          {/* View toggle */}
          <div style={{ display: "flex", background: COLORS.borderLight, borderRadius: 10, padding: 3 }}>
            <button
              className="btn btn-sm"
              style={{ background: viewMode === "week" ? COLORS.primary : "transparent", color: viewMode === "week" ? "white" : COLORS.textMuted, padding: "5px 14px" }}
              onClick={() => setViewMode("week")}
            >
              Tydzień
            </button>
            <button
              className="btn btn-sm"
              style={{ background: viewMode === "month" ? COLORS.primary : "transparent", color: viewMode === "month" ? "white" : COLORS.textMuted, padding: "5px 14px" }}
              onClick={() => { setViewMode("month"); setMonthDate(new Date(weekMonday)); }}
            >
              Miesiąc
            </button>
          </div>
        </div>
        <div className="planner-actions" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {viewMode === "week" ? (
            <>
              <button className="btn btn-ghost" onClick={() => navigateWeek(-1)}><ChevronLeft /></button>
              <span style={{ fontWeight: 600, fontSize: 15, minWidth: 140, textAlign: "center" }}>{weekLabel}</span>
              <button className="btn btn-ghost" onClick={() => navigateWeek(1)}><ChevronRight /></button>
              <button className="btn btn-sm btn-secondary" onClick={goToday}>Dziś</button>
              <button className="btn btn-sm btn-secondary" onClick={copyLastWeek} title="Kopiuj z zeszłego tygodnia">
                <CopyIcon size={16} /> <span className="btn-label">Kopiuj tydzień</span>
              </button>
              <button className="btn btn-sm btn-secondary" onClick={printPlan} title="Drukuj">
                <PrinterIcon size={16} /> <span className="btn-label">Drukuj</span>
              </button>
              <button className="btn btn-sm btn-secondary" onClick={openHistory} title="Historia">
                <HistoryIcon size={16} /> <span className="btn-label">Historia</span>
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => navigateMonth(-1)}><ChevronLeft /></button>
              <span style={{ fontWeight: 600, fontSize: 15, minWidth: 140, textAlign: "center" }}>{monthLabel}</span>
              <button className="btn btn-ghost" onClick={() => navigateMonth(1)}><ChevronRight /></button>
              <button className="btn btn-sm btn-secondary" onClick={() => setMonthDate(new Date())}>Dziś</button>
            </>
          )}
        </div>
      </div>

      {viewMode === "week" ? (
        /* ===== WEEK VIEW ===== */
        <div className="week-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
          {weekPlan.days.map((day, idx) => {
            const recipe = day.recipeId ? getRecipeById(day.recipeId) : null;
            const isToday = day.date === today;
            const isDragOver = dropTarget?.type === "week" && dropTarget?.idx === idx;
            return (
              <div
                key={day.date}
                className={`card ${isToday ? "today-highlight" : ""}`}
                style={{
                  padding: 0, overflow: "hidden", minHeight: 200,
                  outline: isDragOver ? `2px dashed ${COLORS.primary}` : "none",
                  background: isDragOver ? COLORS.primaryPale : undefined,
                  transition: "outline 0.15s, background 0.15s",
                }}
                onDragOver={(e) => { handleDragOver(e); setDropTarget({ type: "week", idx }); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => handleWeekDrop(e, idx)}
              >
                <div style={{
                  padding: "10px 14px",
                  background: isToday ? COLORS.primaryPale : COLORS.bgAlt,
                  borderBottom: `1px solid ${COLORS.borderLight}`,
                  display: "flex", justifyContent: "space-between", alignItems: "center"
                }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{DAYS_SHORT[idx]}</span>
                  <span style={{ fontSize: 13, color: COLORS.textMuted }}>{formatDatePL(day.date)}</span>
                </div>
                <div style={{ padding: 12 }}>
                  {recipe ? (
                    <div
                      className="meal-card-mini"
                      draggable
                      onDragStart={(e) => handleWeekDragStart(e, idx, day.recipeId)}
                      onDragEnd={() => { setDragData(null); setDropTarget(null); }}
                      onClick={() => setDetailRecipe(recipe)}
                      style={{ cursor: "grab" }}
                    >
                      {recipe.imageUrl ? (
                        <div style={{ height: 80, overflow: "hidden" }}>
                          <img src={recipe.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
                        </div>
                      ) : (
                        <div style={{ height: 80, background: COLORS.primaryPale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>
                          {getCategoryEmoji(recipe.category)}
                        </div>
                      )}
                      <div style={{ padding: "8px 10px" }}>
                        <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, lineHeight: 1.3 }}>{recipe.name}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: COLORS.textMuted }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><ClockIcon size={12} /> {recipe.prepTime}m</span>
                        </div>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ position: "absolute", top: 4, right: 4, padding: 4, borderRadius: 8, background: "rgba(255,255,255,0.85)" }}
                        onClick={(e) => { e.stopPropagation(); clearDay(idx); }}
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="empty-slot" onClick={() => openPicker(idx)}>
                      <PlusIcon size={24} />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>Dodaj obiad</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ===== MONTH VIEW ===== */
        <div>
          {/* Day headers */}
          <div className="month-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
            {DAYS_SHORT.map((d) => (
              <div key={d} style={{ textAlign: "center", fontWeight: 700, fontSize: 12, color: COLORS.textMuted, padding: "8px 0", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {d}
              </div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="month-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {monthDays.map(({ date, inMonth }, i) => {
              const dateStr = formatDate(date);
              const recipeId = monthPlans[dateStr];
              const recipe = recipeId ? recipes.find((r) => r.id === recipeId) : null;
              const isToday = dateStr === today;
              const dayNum = date.getDate();
              const isDragOver = dropTarget?.type === "month" && dropTarget?.date === dateStr;
              return (
                <div
                  key={i}
                  className="month-cell"
                  style={{
                    minHeight: 90,
                    padding: 6,
                    borderRadius: 12,
                    background: isDragOver ? COLORS.primaryPale : isToday ? COLORS.primaryPale : inMonth ? COLORS.card : COLORS.bg,
                    border: isDragOver ? `2px dashed ${COLORS.primary}` : isToday ? `2px solid ${COLORS.primary}` : `1px solid ${inMonth ? COLORS.borderLight : "transparent"}`,
                    opacity: inMonth ? 1 : 0.35,
                    transition: "all 0.15s",
                    overflow: "hidden",
                    position: "relative",
                  }}
                  onMouseEnter={(e) => { if (inMonth && !dragData) e.currentTarget.style.boxShadow = COLORS.shadow; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
                  onDragOver={(e) => { if (inMonth) { handleDragOver(e); setDropTarget({ type: "month", date: dateStr }); } }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => { if (inMonth) handleMonthDrop(e, dateStr); }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? COLORS.primary : COLORS.textMuted }}>
                      {dayNum}
                    </span>
                    {inMonth && recipe && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeRecipeFromDate(dateStr); }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, borderRadius: 4, display: "flex", lineHeight: 1 }}
                        title="Usuń danie"
                      >
                        <XIcon size={12} color={COLORS.textMuted} />
                      </button>
                    )}
                  </div>
                  {recipe ? (
                    <div
                      draggable
                      onDragStart={(e) => handleMonthDragStart(e, dateStr, recipeId)}
                      onDragEnd={() => { setDragData(null); setDropTarget(null); }}
                      style={{ display: "flex", alignItems: "center", gap: 4, cursor: "grab" }}
                      onClick={() => setDetailRecipe(recipe)}
                    >
                      {recipe.imageUrl ? (
                        <div style={{ width: 28, height: 28, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                          <img src={recipe.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
                        </div>
                      ) : (
                        <span style={{ fontSize: 16 }}>{getCategoryEmoji(recipe.category)}</span>
                      )}
                      <span className="month-cell-name" style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {recipe.name}
                      </span>
                    </div>
                  ) : inMonth ? (
                    <div
                      onClick={() => { setMonthPickerDate(dateStr); setMonthPickerOpen(true); }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        height: 34, borderRadius: 8, border: `1px dashed ${COLORS.border}`,
                        cursor: "pointer", color: COLORS.textMuted, fontSize: 11, gap: 4,
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => { if (!dragData) { e.currentTarget.style.borderColor = COLORS.primary; e.currentTarget.style.color = COLORS.primary; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.textMuted; }}
                    >
                      <PlusIcon size={12} /> Dodaj
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recipe picker modal (week view) */}
      <Modal isOpen={pickerState.open} onClose={closePicker} title="Wybierz obiad" wide>
        <RecipePicker recipes={recipes} onPick={assignRecipe} onClose={closePicker} weekPlan={weekPlan} initialDayIdx={pickerState.dayIdx} />
      </Modal>

      {/* Recipe picker modal (month view) */}
      <Modal
        isOpen={monthPickerOpen}
        onClose={() => { setMonthPickerOpen(false); setMonthPickerDate(null); }}
        title="Wybierz obiad"
        wide
      >
        <MonthRecipePicker
          recipes={recipes}
          onPick={handleMonthPickerPick}
          onClose={() => { setMonthPickerOpen(false); setMonthPickerDate(null); }}
          monthDate={monthDate}
          monthPlans={monthPlans}
          initialDate={monthPickerDate}
        />
      </Modal>

      {/* Recipe detail modal */}
      <Modal isOpen={!!detailRecipe} onClose={() => setDetailRecipe(null)} title={detailRecipe?.name || ""} wide>
        <RecipeDetail
          recipe={detailRecipe}
          onClose={() => setDetailRecipe(null)}
          onEdit={() => {}}
          onToggleFavorite={() => {}}
        />
      </Modal>

      {/* History modal */}
      <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title="📋 Historia tygodni" wide>
        {historyLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>Ładowanie...</div>
        ) : historyPlans.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>📋</p>
            <p>Brak zapisanych planów. Zaplanuj pierwszy tydzień!</p>
          </div>
        ) : (
          <div style={{ maxHeight: "60vh", overflowY: "auto" }} className="scrollbar-hidden">
            {historyPlans.map((plan) => {
              const planMonday = new Date(plan.weekStart + "T00:00:00");
              const planSunday = addDays(planMonday, 6);
              const isCurrentWeek = plan.weekStart === formatDate(weekMonday);
              const filledDays = plan.days.filter((d) => d.recipeId).length;
              return (
                <div
                  key={plan.id}
                  className="card"
                  style={{
                    marginBottom: 12,
                    padding: 0,
                    overflow: "hidden",
                    border: isCurrentWeek ? `2px solid ${COLORS.primary}` : undefined,
                  }}
                >
                  {/* Week header */}
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "12px 16px",
                    background: isCurrentWeek ? COLORS.primaryPale : COLORS.bgAlt,
                    borderBottom: `1px solid ${COLORS.borderLight}`,
                  }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>
                        {formatDatePL(planMonday)} — {formatDatePL(planSunday)}
                      </span>
                      {isCurrentWeek && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: COLORS.primary, fontWeight: 600 }}>
                          (bieżący tydzień)
                        </span>
                      )}
                      <span style={{ marginLeft: 8, fontSize: 12, color: COLORS.textMuted }}>
                        {filledDays}/7 dni zaplanowanych
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {!isCurrentWeek && (
                        <button className="btn btn-sm btn-secondary" onClick={() => copyFromHistory(plan)} title="Skopiuj ten plan do bieżącego tygodnia">
                          <CopyIcon size={14} /> Kopiuj
                        </button>
                      )}
                      <button className="btn btn-sm btn-primary" onClick={() => jumpToWeek(plan.weekStart)}>
                        Przejdź
                      </button>
                    </div>
                  </div>
                  {/* Days row */}
                  <div style={{ display: "flex", gap: 0 }}>
                    {plan.days.map((day, idx) => {
                      const recipe = day.recipeId ? recipes.find((r) => r.id === day.recipeId) : null;
                      return (
                        <div
                          key={idx}
                          style={{
                            flex: 1, padding: "10px 6px", textAlign: "center",
                            borderRight: idx < 6 ? `1px solid ${COLORS.borderLight}` : "none",
                            minWidth: 0,
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textMuted, marginBottom: 6 }}>
                            {DAYS_SHORT[idx]}
                          </div>
                          {recipe ? (
                            <div>
                              {recipe.imageUrl ? (
                                <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", margin: "0 auto 4px" }}>
                                  <img src={recipe.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                </div>
                              ) : (
                                <div style={{ width: 40, height: 40, borderRadius: 8, background: COLORS.primaryPale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, margin: "0 auto 4px" }}>
                                  {getCategoryEmoji(recipe.category)}
                                </div>
                              )}
                              <p style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={recipe.name}>
                                {recipe.name}
                              </p>
                            </div>
                          ) : (
                            <div style={{ width: 40, height: 40, borderRadius: 8, border: `1px dashed ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 4px", color: COLORS.borderLight }}>
                              —
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
};

// ============================================================
// RECIPES PAGE
// ============================================================
const RecipesPage = ({ recipes, setRecipes, knownIngredients, refreshKnownIngredients }) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [detailRecipe, setDetailRecipe] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterFav, setFilterFav] = useState(false);
  const [sortBy, setSortBy] = useState("createdAt");

  const handleSave = async (recipe) => {
    await dbPut("recipes", recipe);
    // Save known ingredients
    for (const ing of recipe.ingredients) {
      if (ing.name.trim()) {
        await dbPut("knownIngredients", { name: ing.name.trim().toLowerCase() });
      }
    }
    const all = await dbGetAll("recipes");
    setRecipes(all);
    refreshKnownIngredients();
    setFormOpen(false);
    setEditingRecipe(null);
  };

  const handleDelete = async (id) => {
    await dbDelete("recipes", id);
    const all = await dbGetAll("recipes");
    setRecipes(all);
    setDeleteConfirm(null);
    setDetailRecipe(null);
  };

  const toggleFavorite = async (id) => {
    const r = recipes.find((x) => x.id === id);
    if (!r) return;
    const updated = { ...r, isFavorite: !r.isFavorite };
    await dbPut("recipes", updated);
    const all = await dbGetAll("recipes");
    setRecipes(all);
    if (detailRecipe?.id === id) setDetailRecipe(updated);
  };

  const openEdit = (recipe) => {
    setEditingRecipe(recipe);
    setFormOpen(true);
    setDetailRecipe(null);
  };

  const filtered = useMemo(() => {
    let result = [...recipes];
    if (search) result = result.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
    if (filterCat) result = result.filter((r) => r.category === filterCat);
    if (filterFav) result = result.filter((r) => r.isFavorite);
    result.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "prepTime") return a.prepTime - b.prepTime;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return result;
  }, [recipes, search, filterCat, filterFav, sortBy]);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 28 }}>📖 Przepisy</h1>
        <button className="btn btn-primary" onClick={() => { setEditingRecipe(null); setFormOpen(true); }}>
          <PlusIcon size={18} /> Dodaj przepis
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 320 }}>
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj przepisu..."
          />
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <SearchIcon size={18} color={COLORS.textMuted} />
          </div>
        </div>
        <select className="input" style={{ width: "auto", minWidth: 160 }} value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="">Wszystkie kategorie</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button className={`btn btn-sm ${filterFav ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilterFav(!filterFav)}>
          <HeartIcon filled={filterFav} size={16} color={filterFav ? "white" : COLORS.heart} /> Ulubione
        </button>
        <select className="input" style={{ width: "auto", minWidth: 140 }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="createdAt">Najnowsze</option>
          <option value="name">Nazwa A-Z</option>
          <option value="prepTime">Czas ↑</option>
        </select>
      </div>

      {/* Recipe grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: COLORS.textMuted }}>
          <p style={{ fontSize: 64, marginBottom: 16 }}>🍳</p>
          <h3 style={{ marginBottom: 8 }}>Brak przepisów</h3>
          <p>Dodaj swój pierwszy przepis, aby rozpocząć planowanie!</p>
        </div>
      ) : (
        <div className="recipe-grid">
          {filtered.map((r) => (
            <div key={r.id} className="card pop-in" style={{ overflow: "hidden", cursor: "pointer", position: "relative" }} onClick={() => setDetailRecipe(r)}>
              {r.imageUrl ? (
                <div style={{ height: 160, overflow: "hidden" }}>
                  <img src={r.imageUrl} alt={r.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ) : (
                <div style={{ height: 160, background: `linear-gradient(135deg, ${COLORS.primaryPale}, ${COLORS.accentPale})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56 }}>
                  {getCategoryEmoji(r.category)}
                </div>
              )}
              <button
                style={{ position: "absolute", top: 10, right: 10, background: "rgba(255,255,255,0.9)", border: "none", borderRadius: 10, padding: 6, cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); toggleFavorite(r.id); }}
              >
                <HeartIcon filled={r.isFavorite} size={20} />
              </button>
              <div style={{ padding: 16 }}>
                <h3 style={{ fontSize: 16, marginBottom: 8, lineHeight: 1.3 }}>{r.name}</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  <span className="tag tag-primary" style={{ fontSize: 11 }}>{getCategoryEmoji(r.category)} {r.category}</span>
                  {r.tags.slice(0, 2).map((t) => <span key={t} className="tag" style={{ fontSize: 11 }}>{t}</span>)}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: COLORS.textMuted }}>
                    <ClockIcon size={14} /> {r.prepTime} min
                  </span>
                  <span style={{ fontSize: 12, color: COLORS.textMuted }}>{r.ingredients.length} składników</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingRecipe(null); }} title={editingRecipe ? "Edytuj przepis" : "Nowy przepis"} wide>
        <RecipeForm
          recipe={editingRecipe}
          onSave={handleSave}
          onCancel={() => { setFormOpen(false); setEditingRecipe(null); }}
          knownIngredients={knownIngredients}
        />
      </Modal>

      {/* Detail modal */}
      <Modal isOpen={!!detailRecipe && !formOpen} onClose={() => setDetailRecipe(null)} title={detailRecipe?.name || ""} wide>
        {detailRecipe && (
          <>
            <RecipeDetail recipe={detailRecipe} onClose={() => setDetailRecipe(null)} onEdit={openEdit} onToggleFavorite={toggleFavorite} />
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${COLORS.borderLight}`, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(detailRecipe.id)}>
                <TrashIcon size={16} /> Usuń przepis
              </button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        message="Czy na pewno chcesz usunąć ten przepis? Tej operacji nie można cofnąć."
        onConfirm={() => handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
};

// ============================================================
// SHOPPING LIST PAGE
// ============================================================
const ShoppingListPage = ({ recipes, weekPlan, weekMonday }) => {
  const [checkedItems, setCheckedItems] = useState({});
  const [customItems, setCustomItems] = useState([]);
  const [customInput, setCustomInput] = useState("");
  const [copied, setCopied] = useState(false);

  // Build aggregated shopping list
  const shoppingList = useMemo(() => {
    const map = {};
    for (const day of weekPlan.days) {
      if (!day.recipeId) continue;
      const recipe = recipes.find((r) => r.id === day.recipeId);
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        const key = `${ing.name.toLowerCase()}|${ing.unit}`;
        if (!map[key]) {
          map[key] = { ingredientName: ing.name, totalQuantity: 0, unit: ing.unit, fromRecipes: [], productUrl: "" };
        }
        map[key].totalQuantity += ing.quantity;
        if (!map[key].productUrl && ing.productUrl) {
          map[key].productUrl = ing.productUrl;
        }
        if (!map[key].fromRecipes.includes(recipe.name)) {
          map[key].fromRecipes.push(recipe.name);
        }
      }
    }
    return Object.values(map).sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
  }, [recipes, weekPlan]);

  const toggleCheck = (key) => setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleCustomCheck = (idx) => {
    setCustomItems((prev) => prev.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it));
  };

  const addCustomItem = () => {
    if (!customInput.trim()) return;
    setCustomItems([...customItems, { name: customInput.trim(), checked: false }]);
    setCustomInput("");
  };

  const clearChecked = () => {
    setCheckedItems({});
    setCustomItems((prev) => prev.map((it) => ({ ...it, checked: false })));
  };

  const totalItems = shoppingList.length + customItems.length;
  const checkedCount = Object.values(checkedItems).filter(Boolean).length + customItems.filter((it) => it.checked).length;

  const copyList = () => {
    const lines = shoppingList.map((it) => `${checkedItems[`${it.ingredientName}|${it.unit}`] ? "✓" : "☐"} ${it.ingredientName} — ${it.totalQuantity} ${it.unit}`);
    const customLines = customItems.map((it) => `${it.checked ? "✓" : "☐"} ${it.name}`);
    navigator.clipboard.writeText([...lines, ...customLines].join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const printShoppingList = () => {
    const items = shoppingList.map((it) =>
      `<div class="shopping-item">
        <div class="checkbox"></div>
        <span class="ingredient-qty">${it.totalQuantity} ${it.unit}</span>
        <span class="ingredient-name">${it.ingredientName}</span>
        <span class="ingredient-from">(${it.fromRecipes.join(", ")})</span>
      </div>`
    ).join("");

    const custom = customItems.map((it) =>
      `<div class="shopping-item">
        <div class="checkbox"></div>
        <span class="ingredient-name">${it.name}</span>
      </div>`
    ).join("");

    printContent(
      `<h1>🛒 Lista zakupów</h1>
       <p class="subtitle">Tydzień: ${weekLabel}</p>
       <p class="subtitle" style="margin-bottom:16px">Pozycji: ${totalItems}</p>
       ${items}${custom}`,
      `Lista zakupów — ${weekLabel}`
    );
  };

  const weekLabel = `${formatDatePL(weekMonday)} — ${formatDatePL(addDays(weekMonday, 6))}`;

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28 }}>🛒 Lista zakupów</h1>
          <p style={{ color: COLORS.textMuted, marginTop: 4, fontSize: 14 }}>Tydzień: {weekLabel}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={clearChecked}>Wyczyść zaznaczone</button>
          <button className="btn btn-secondary btn-sm" onClick={printShoppingList}>
            <PrinterIcon size={16} /> Drukuj
          </button>
          <button className="btn btn-primary btn-sm" onClick={copyList}>
            {copied ? <><CheckIcon size={16} /> Skopiowano!</> : <><CopyIcon size={16} /> Kopiuj listę</>}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {totalItems > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{checkedCount} z {totalItems} kupionych</span>
            <span style={{ color: COLORS.textMuted }}>{totalItems - checkedCount} pozostało</span>
          </div>
          <div style={{ height: 8, background: COLORS.borderLight, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${totalItems > 0 ? (checkedCount / totalItems) * 100 : 0}%`, background: COLORS.accent, borderRadius: 4, transition: "width 0.3s" }} />
          </div>
        </div>
      )}

      {shoppingList.length === 0 && customItems.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: COLORS.textMuted }}>
          <p style={{ fontSize: 64, marginBottom: 16 }}>🛒</p>
          <h3 style={{ marginBottom: 8 }}>Lista zakupów jest pusta</h3>
          <p>Zaplanuj obiady w planerze, a lista zakupów wygeneruje się automatycznie.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          {shoppingList.map((item) => {
            const key = `${item.ingredientName}|${item.unit}`;
            const isChecked = !!checkedItems[key];
            return (
              <div
                key={key}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 20px",
                  borderBottom: `1px solid ${COLORS.borderLight}`,
                  background: isChecked ? COLORS.accentPale : "white",
                  cursor: "pointer", transition: "background 0.2s"
                }}
                onClick={() => toggleCheck(key)}
              >
                <div className={`checkbox-custom ${isChecked ? "checked" : ""}`}>
                  {isChecked && <CheckIcon size={14} color="white" />}
                </div>
                <div style={{ flex: 1, textDecoration: isChecked ? "line-through" : "none", opacity: isChecked ? 0.6 : 1, transition: "all 0.2s" }}>
                  <span style={{ fontWeight: 600 }}>{item.ingredientName}</span>
                  <span style={{ color: COLORS.primary, fontWeight: 600, marginLeft: 8 }}>{item.totalQuantity} {item.unit}</span>
                </div>
                {item.productUrl && (
                  <a
                    href={item.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-sm btn-accent"
                    style={{ padding: "4px 10px", fontSize: 12, textDecoration: "none" }}
                    onClick={(e) => e.stopPropagation()}
                    title="Otwórz w sklepie"
                  >
                    <ExternalLinkIcon size={14} /> Kup
                  </a>
                )}
                <div style={{ fontSize: 12, color: COLORS.textMuted, maxWidth: 200, textAlign: "right" }}>
                  {item.fromRecipes.join(", ")}
                </div>
              </div>
            );
          })}
          {customItems.map((item, idx) => (
            <div
              key={`custom-${idx}`}
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "14px 20px",
                borderBottom: `1px solid ${COLORS.borderLight}`,
                background: item.checked ? COLORS.accentPale : "white",
                cursor: "pointer", transition: "background 0.2s"
              }}
              onClick={() => toggleCustomCheck(idx)}
            >
              <div className={`checkbox-custom ${item.checked ? "checked" : ""}`}>
                {item.checked && <CheckIcon size={14} color="white" />}
              </div>
              <span style={{ flex: 1, fontWeight: 500, textDecoration: item.checked ? "line-through" : "none", opacity: item.checked ? 0.6 : 1 }}>
                {item.name}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setCustomItems(customItems.filter((_, i) => i !== idx)); }} style={{ padding: 4 }}>
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add custom item */}
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <input
          className="input"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addCustomItem(); }}
          placeholder="Dodaj własną pozycję..."
        />
        <button className="btn btn-secondary" onClick={addCustomItem}><PlusIcon size={18} /></button>
      </div>
    </div>
  );
};

// ============================================================
// CATEGORY MANAGER
// ============================================================
const EMOJI_SUGGESTIONS = ["🍕", "🌮", "🍜", "🥟", "🍛", "🥙", "🍱", "🥞", "🧆", "🥪", "🌯", "🍔", "🥐", "🍰", "🥧", "🫔", "🥣", "🍿", "🧇", "🥗"];

const CategoryManager = ({ customCats, onAdd, onRemove }) => {
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🍽️");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [error, setError] = useState("");

  const handleAdd = () => {
    setError("");
    if (!newName.trim()) { setError("Podaj nazwę kategorii"); return; }
    const ok = onAdd(newName, newEmoji);
    if (!ok) { setError("Taka kategoria już istnieje"); return; }
    setNewName("");
    setNewEmoji("🍽️");
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <GridIcon size={22} color={COLORS.primary} />
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Kategorie</h3>
          <p style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>Dodawaj własne kategorie dań</p>
        </div>
      </div>

      {/* Default categories */}
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600, marginBottom: 6 }}>Domyślne:</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DEFAULT_CATEGORIES.map((c) => (
            <span key={c.value} className="tag" style={{ fontSize: 12 }}>{c.emoji} {c.value}</span>
          ))}
        </div>
      </div>

      {/* Custom categories */}
      {customCats.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600, marginBottom: 6 }}>Własne:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {customCats.map((c) => (
              <span key={c.value} className="tag tag-primary" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                {c.emoji} {c.value}
                <button
                  onClick={() => onRemove(c.value)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", marginLeft: 2 }}
                >
                  <XIcon size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add new */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: 18, padding: "4px 10px", minWidth: 40 }}
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          >
            {newEmoji}
          </button>
          {showEmojiPicker && (
            <div
              className="card pop-in"
              style={{
                position: "absolute", bottom: "100%", left: 0, marginBottom: 6,
                padding: 10, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4,
                zIndex: 10, width: 200,
              }}
            >
              {EMOJI_SUGGESTIONS.map((em) => (
                <button
                  key={em}
                  style={{ fontSize: 20, background: newEmoji === em ? COLORS.primaryPale : "none", border: "none", cursor: "pointer", borderRadius: 8, padding: 4 }}
                  onClick={() => { setNewEmoji(em); setShowEmojiPicker(false); }}
                >
                  {em}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          className="input"
          style={{ flex: 1, minWidth: 140, padding: "6px 12px" }}
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="Nazwa kategorii..."
        />
        <button className="btn btn-sm btn-primary" onClick={handleAdd}>
          <PlusIcon size={16} /> Dodaj
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: "#c44", marginTop: 6 }}>{error}</p>}
    </div>
  );
};

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [page, setPage] = useState("planner");
  const [recipes, setRecipes] = useState([]);
  const [weekPlan, setWeekPlan] = useState(null);
  const [weekMonday, setWeekMonday] = useState(getMonday(new Date()));
  const [knownIngredients, setKnownIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const fileInputRef = useRef(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [customCats, setCustomCats] = useState(loadCustomCategories());

  // Keep global CATEGORIES in sync
  useEffect(() => {
    CATEGORIES = [...DEFAULT_CATEGORIES, ...customCats];
  }, [customCats]);

  const addCustomCategory = (name, emoji) => {
    const value = name.trim().toLowerCase();
    if (!value || CATEGORIES.find((c) => c.value === value)) return false;
    const em = emoji || "🍽️";
    const newCat = { value, label: `${em} ${name.trim()}`, emoji: em, custom: true };
    const updated = [...customCats, newCat];
    setCustomCats(updated);
    saveCustomCategories(updated);
    return true;
  };

  const removeCustomCategory = (value) => {
    const updated = customCats.filter((c) => c.value !== value);
    setCustomCats(updated);
    saveCustomCategories(updated);
  };

  // PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show banner if not dismissed before
      if (!localStorage.getItem("pwa-install-dismissed")) {
        setShowInstallBanner(true);
      }
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const installPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowInstallBanner(false);
    }
    setDeferredPrompt(null);
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem("pwa-install-dismissed", "1");
  };

  const refreshKnownIngredients = useCallback(async () => {
    const all = await dbGetAll("knownIngredients");
    setKnownIngredients(all.map((i) => i.name));
  }, []);

  const loadWeekPlan = useCallback(async (monday) => {
    const weekStart = formatDate(monday);
    let plan = await dbGetByIndex("weekPlans", "weekStart", weekStart);
    if (!plan) {
      plan = createEmptyWeekPlan(monday);
      await dbPut("weekPlans", plan);
    }
    setWeekPlan(plan);
  }, []);

  const saveWeekPlan = useCallback(async (plan) => {
    await dbPut("weekPlans", plan);
  }, []);

  const [sharedRecipeModal, setSharedRecipeModal] = useState(null);

  useEffect(() => {
    (async () => {
      await openDB(); // ensure DB is ready
      const allRecipes = await dbGetAll("recipes");
      setRecipes(allRecipes);
      await loadWeekPlan(weekMonday);
      await refreshKnownIngredients();
      setLoading(false);

      // Check for shared recipe in URL hash
      const hash = window.location.hash;
      if (hash.startsWith("#recipe=")) {
        try {
          const encoded = hash.slice(8);
          const json = decodeURIComponent(escape(atob(encoded)));
          const recipe = JSON.parse(json);
          if (recipe.name && recipe.ingredients) {
            setSharedRecipeModal(recipe);
            // Clean hash
            window.history.replaceState(null, "", window.location.pathname);
          }
        } catch (e) {
          console.error("Failed to parse shared recipe:", e);
        }
      }
    })();
  }, []);

  const importSharedRecipe = async (recipe) => {
    const newRecipe = { ...recipe, id: uid(), _shared: undefined, createdAt: new Date().toISOString() };
    await dbPut("recipes", newRecipe);
    setRecipes((prev) => [...prev, newRecipe]);
    // Save ingredient names
    for (const ing of newRecipe.ingredients) {
      if (ing.name.trim()) {
        await dbPut("knownIngredients", { name: ing.name.trim().toLowerCase() });
      }
    }
    await refreshKnownIngredients();
    setSharedRecipeModal(null);
    setPage("recipes");
    setImportStatus({ type: "success", message: `Zaimportowano przepis „${newRecipe.name}"!` });
    setTimeout(() => setImportStatus(null), 4000);
  };

  // === EXPORT ===
  const exportData = async () => {
    const allRecipes = await dbGetAll("recipes");
    const allPlans = await dbGetAll("weekPlans");
    const allIngredients = await dbGetAll("knownIngredients");
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      recipes: allRecipes,
      weekPlans: allPlans,
      knownIngredients: allIngredients,
      customCategories: customCats,
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meal-planner-backup-${formatDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSettingsOpen(false);
  };

  // === IMPORT ===
  const importData = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.recipes || !data.weekPlans) {
        throw new Error("Nieprawidłowy format pliku");
      }
      // Confirm
      const recipeCount = data.recipes?.length || 0;
      const planCount = data.weekPlans?.length || 0;
      const ok = confirm(
        `Importować dane?\n\n` +
        `📖 ${recipeCount} przepisów\n` +
        `📅 ${planCount} planów tygodniowych\n\n` +
        `Istniejące dane zostaną zastąpione.`
      );
      if (!ok) {
        e.target.value = "";
        return;
      }
      // Clear existing data
      const allRecipes = await dbGetAll("recipes");
      for (const r of allRecipes) await dbDelete("recipes", r.id);
      const allPlans = await dbGetAll("weekPlans");
      for (const p of allPlans) await dbDelete("weekPlans", p.id);
      const allIng = await dbGetAll("knownIngredients");
      for (const i of allIng) await dbDelete("knownIngredients", i.name);

      // Import
      for (const recipe of (data.recipes || [])) {
        await dbPut("recipes", recipe);
      }
      for (const plan of (data.weekPlans || [])) {
        await dbPut("weekPlans", plan);
      }
      for (const ing of (data.knownIngredients || [])) {
        await dbPut("knownIngredients", ing);
      }

      // Reload state
      const newRecipes = await dbGetAll("recipes");
      setRecipes(newRecipes);
      await loadWeekPlan(weekMonday);
      await refreshKnownIngredients();

      // Import custom categories if present
      if (data.customCategories?.length) {
        setCustomCats(data.customCategories);
        saveCustomCategories(data.customCategories);
      }

      setImportStatus({ type: "success", message: `Zaimportowano ${recipeCount} przepisów i ${planCount} planów!` });
      setTimeout(() => setImportStatus(null), 4000);
    } catch (err) {
      setImportStatus({ type: "error", message: `Błąd importu: ${err.message}` });
      setTimeout(() => setImportStatus(null), 4000);
    }
    e.target.value = "";
    setSettingsOpen(false);
  };

  // === CLEAR ALL DATA ===
  const clearAllData = async () => {
    const ok = confirm("Czy na pewno chcesz usunąć WSZYSTKIE dane?\n\nTa operacja jest nieodwracalna.\nZalecamy najpierw wyeksportować backup.");
    if (!ok) return;
    const ok2 = confirm("Ostatnie ostrzeżenie — wszystkie przepisy i plany zostaną usunięte bezpowrotnie.");
    if (!ok2) return;

    const allRecipes = await dbGetAll("recipes");
    for (const r of allRecipes) await dbDelete("recipes", r.id);
    const allPlans = await dbGetAll("weekPlans");
    for (const p of allPlans) await dbDelete("weekPlans", p.id);
    const allIng = await dbGetAll("knownIngredients");
    for (const i of allIng) await dbDelete("knownIngredients", i.name);

    setRecipes([]);
    await loadWeekPlan(weekMonday);
    await refreshKnownIngredients();
    setSettingsOpen(false);
  };

  if (loading || !weekPlan) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: COLORS.bg }}>
        <GlobalStyles />
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 56, marginBottom: 16 }}>🍽️</p>
          <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: COLORS.text }}>Meal Planner</p>
          <p style={{ color: COLORS.textMuted, marginTop: 8 }}>Ładowanie...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg }}>
      <GlobalStyles />

      {/* Navbar */}
      <nav className="app-nav" style={{
        position: "sticky", top: 0, zIndex: 50, background: "rgba(253,246,236,0.92)",
        backdropFilter: "blur(12px)", borderBottom: `1px solid ${COLORS.borderLight}`,
        padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div className="nav-logo" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 28 }}>🍽️</span>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: COLORS.text }}>Meal Planner</span>
        </div>
        <div className="nav-links" style={{ display: "flex", gap: 4 }}>
          <button className={`nav-link ${page === "planner" ? "active" : ""}`} onClick={() => setPage("planner")}>
            <CalendarIcon size={18} />
            <span className="nav-label-full">Planer</span>
            <span className="nav-label-short">Planer</span>
          </button>
          <button className={`nav-link ${page === "recipes" ? "active" : ""}`} onClick={() => setPage("recipes")}>
            <BookIcon size={18} />
            <span className="nav-label-full">Przepisy</span>
            <span className="nav-label-short">Przepisy</span>
          </button>
          <button className={`nav-link ${page === "shopping" ? "active" : ""}`} onClick={() => setPage("shopping")}>
            <ShoppingCartIcon size={18} />
            <span className="nav-label-full">Zakupy</span>
            <span className="nav-label-short">Zakupy</span>
          </button>
          <div className="nav-divider" style={{ width: 1, background: COLORS.borderLight, margin: "4px 8px" }} />
          <button className="nav-link" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={18} />
            <span className="nav-label-short" style={{ fontSize: 10 }}>⚙️</span>
          </button>
        </div>
      </nav>

      {/* Settings modal */}
      <Modal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title="⚙️ Ustawienia">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Export */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <DownloadIcon size={22} color={COLORS.primary} />
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Eksportuj dane</h3>
                <p style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>Pobierz backup wszystkich przepisów i planów jako plik JSON</p>
              </div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={exportData}>
              <DownloadIcon size={16} /> Eksportuj do JSON
            </button>
          </div>

          {/* Import */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <UploadIcon size={22} color={COLORS.accent} />
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Importuj dane</h3>
                <p style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>Wczytaj dane z pliku JSON — zastąpi istniejące dane</p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={importData}
              style={{ display: "none" }}
            />
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => fileInputRef.current?.click()}>
              <UploadIcon size={16} /> Importuj z JSON
            </button>
          </div>

          {/* Clear */}
          <div className="card" style={{ padding: 20, borderColor: "#f0c0c0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <TrashIcon size={22} color="#c44" />
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#c44" }}>Wyczyść dane</h3>
                <p style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>Usuń wszystkie przepisy, plany i dane — nieodwracalne!</p>
              </div>
            </div>
            <button className="btn btn-danger" style={{ marginTop: 8 }} onClick={clearAllData}>
              <TrashIcon size={16} /> Wyczyść wszystko
            </button>
          </div>

          {/* Custom categories */}
          <CategoryManager
            customCats={customCats}
            onAdd={addCustomCategory}
            onRemove={removeCustomCategory}
          />

          {/* Info */}
          <div style={{ fontSize: 12, color: COLORS.textMuted, textAlign: "center", padding: "8px 0" }}>
            Dane przechowywane lokalnie w przeglądarce (IndexedDB).
            Eksportuj regularnie aby nie stracić danych.
          </div>

          {/* Install PWA */}
          {deferredPrompt && (
            <div className="card" style={{ padding: 20, borderColor: COLORS.primary, background: COLORS.primaryPale }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <SmartphoneIcon size={22} color={COLORS.primary} />
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>Zainstaluj aplikację</h3>
                  <p style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>Dodaj Meal Planner do ekranu głównego — działa offline!</p>
                </div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={installPWA}>
                <DownloadIcon size={16} /> Zainstaluj
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* PWA install banner */}
      {showInstallBanner && (
        <div
          className="pop-in"
          style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            background: "white", borderRadius: 16, padding: "16px 20px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)", zIndex: 999,
            display: "flex", alignItems: "center", gap: 14,
            maxWidth: 440, width: "calc(100% - 32px)",
            border: `1px solid ${COLORS.borderLight}`,
          }}
        >
          <div style={{ width: 44, height: 44, borderRadius: 12, background: COLORS.primaryPale, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 24 }}>🍽️</span>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Zainstaluj Meal Planner</p>
            <p style={{ fontSize: 12, color: COLORS.textMuted }}>Szybki dostęp i praca offline</p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={installPWA}>Instaluj</button>
          <button className="btn btn-ghost btn-sm" onClick={dismissInstallBanner} style={{ padding: 4 }}>
            <XIcon size={16} />
          </button>
        </div>
      )}

      {/* Import status toast */}
      {importStatus && (
        <div
          style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            padding: "14px 24px", borderRadius: 14,
            background: importStatus.type === "success" ? "#2d7a3a" : "#c44",
            color: "white", fontWeight: 600, fontSize: 14,
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 1000,
            display: "flex", alignItems: "center", gap: 10,
            animation: "fadeIn 0.3s ease",
          }}
          className="pop-in"
        >
          {importStatus.type === "success" ? <CheckIcon size={18} /> : <XIcon size={18} />}
          {importStatus.message}
        </div>
      )}

      {/* Main content */}
      <main className="app-main" style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
        {page === "planner" && (
          <PlannerPage
            recipes={recipes}
            weekPlan={weekPlan}
            setWeekPlan={setWeekPlan}
            weekMonday={weekMonday}
            setWeekMonday={setWeekMonday}
            saveWeekPlan={saveWeekPlan}
            loadWeekPlan={loadWeekPlan}
          />
        )}
        {page === "recipes" && (
          <RecipesPage
            recipes={recipes}
            setRecipes={setRecipes}
            knownIngredients={knownIngredients}
            refreshKnownIngredients={refreshKnownIngredients}
          />
        )}
        {page === "shopping" && (
          <ShoppingListPage
            recipes={recipes}
            weekPlan={weekPlan}
            weekMonday={weekMonday}
          />
        )}
      </main>

      {/* Shared recipe import modal */}
      <Modal isOpen={!!sharedRecipeModal} onClose={() => setSharedRecipeModal(null)} title="📩 Udostępniony przepis" wide>
        {sharedRecipeModal && (
          <div>
            <div style={{ marginBottom: 20, padding: 16, background: COLORS.primaryPale, borderRadius: 14 }}>
              <p style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 8 }}>Ktoś udostępnił Ci przepis:</p>
              <h3 style={{ fontSize: 20, marginBottom: 8 }}>{sharedRecipeModal.name}</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span className="tag tag-primary">{getCategoryEmoji(sharedRecipeModal.category)} {sharedRecipeModal.category}</span>
                <span className="tag" style={{ background: "white", color: COLORS.primary }}>
                  <ClockIcon size={14} />&nbsp;{sharedRecipeModal.prepTime} min
                </span>
              </div>
              {sharedRecipeModal.description && <p style={{ fontSize: 13, color: COLORS.textMuted }}>{sharedRecipeModal.description}</p>}
            </div>
            {sharedRecipeModal.ingredients?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Składniki ({sharedRecipeModal.ingredients.length}):</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {sharedRecipeModal.ingredients.map((ing, i) => (
                    <span key={i} className="tag">{ing.name} — {ing.quantity} {ing.unit}</span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button className="btn btn-primary" onClick={() => importSharedRecipe(sharedRecipeModal)}>
                <DownloadIcon size={16} /> Dodaj do moich przepisów
              </button>
              <button className="btn btn-ghost" onClick={() => setSharedRecipeModal(null)}>Anuluj</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

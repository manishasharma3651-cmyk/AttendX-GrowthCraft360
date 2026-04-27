// ========== AttendX API Client ==========
// Connects to Flask backend at http://localhost:5000

const API_BASE = "http://localhost:5000/api";

const DB = {

  // ─── TOKEN / SESSION ───
  getToken() { return sessionStorage.getItem("ax_token"); },
  setToken(t) { sessionStorage.setItem("ax_token", t); },
  clearToken() { sessionStorage.removeItem("ax_token"); sessionStorage.removeItem("ax_session"); },

  getSession() {
    const s = sessionStorage.getItem("ax_session");
    return s ? JSON.parse(s) : null;
  },
  setSession(s) { sessionStorage.setItem("ax_session", JSON.stringify(s)); },
  clearSession() { this.clearToken(); },

  // ─── HTTP HELPER ───
  async _req(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const token = this.getToken();
    if (token) headers["Authorization"] = "Bearer " + token;

    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  },

  get(path)        { return this._req("GET", path); },
  post(path, body) { return this._req("POST", path, body); },
  put(path, body)  { return this._req("PUT", path, body); },
  del(path)        { return this._req("DELETE", path); },

  // ─── AUTH ───
  async login(username, password, role) {
    const data = await this.post("/login", { username, password, role });
    this.setToken(data.token);
    this.setSession({ userId: data.user.id, role: data.user.role, name: data.user.name });
    return data.user;
  },

  // ─── USERS ───
  async getUsers()        { return this.get("/users"); },
  async addUser(u)        { return this.post("/users", u); },
  async updateUser(id, u) { return this.put("/users/" + id, u); },
  async deleteUser(id)    { return this.del("/users/" + id); },

  // ─── ATTENDANCE ───
  async getAttendance(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.get("/attendance" + (q ? "?" + q : ""));
  },
  async checkIn()              { return this.post("/attendance/checkin"); },
  async checkOut(breakMins)    { return this.post("/attendance/checkout", { breakMins }); },
  async lunchIn()              { return this.post("/attendance/lunch-in"); },
  async lunchOut()             { return this.post("/attendance/lunch-out"); },
  async getTodayRecord(userId) { return this.get("/attendance/today-state/" + userId); },

  // ─── LEAVES ───
  async getLeaves(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.get("/leaves" + (q ? "?" + q : ""));
  },
  async applyLeave(data)        { return this.post("/leaves", data); },
  async updateLeave(id, status) { return this.put("/leaves/" + id, { status }); },

  // ─── DOCUMENTS ───
  async getDocuments(userId) { return this.get("/documents/" + userId); },
  async uploadDocument(userId, docType, file) {
    // Use FormData (multipart) — reliable for large files, no JSON body size limit
    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("docType", docType);
    formData.append("file", file);

    const token = this.getToken();
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    // NOTE: Do NOT set Content-Type — browser sets it with boundary automatically

    const res = await fetch(API_BASE + "/documents", {
      method: "POST",
      headers,
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  },

  // ─── DASHBOARD ───
  async getDashboardStats() { return this.get("/dashboard/stats"); },

  // ─── TODAY STATE (client-side break tracking) ───
  getTodayState(uid) { return JSON.parse(localStorage.getItem("ax_today_" + uid) || "null"); },
  setTodayState(uid, s) { localStorage.setItem("ax_today_" + uid, JSON.stringify(s)); },

  // ─── HELPERS ───
  todayStr() { return new Date().toISOString().split("T")[0]; },
  nowStr() { return new Date().toTimeString().split(" ")[0].substring(0, 5); },
  nowFull() { return new Date().toISOString(); },
  uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); },

  calcHours(checkIn, checkOut, breakMins) {
    if (!checkIn || !checkOut) return 0;
    const [ih, im] = checkIn.split(":").map(Number);
    const [oh, om] = checkOut.split(":").map(Number);
    return Math.max(0, (oh * 60 + om) - (ih * 60 + im) - (breakMins || 0));
  },

  fmtMins(mins) {
    if (!mins) return "0m";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  },

  fmtDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  },

  dayName(dateStr) {
    return new Date(dateStr).toLocaleDateString("en-IN", { weekday: "short" });
  },

  diffDays(from, to) {
    const a = new Date(from); const b = new Date(to);
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }
};

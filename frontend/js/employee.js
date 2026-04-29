// ===== INIT =====
let session, currentUser, todayState, clockInterval;

window.onload = async () => {
  session = DB.getSession();
  if (!session || session.role !== "employee") { window.location.href = "index.html"; return; }

  try {
    const users = await DB.getUsers();
    currentUser = users.find(u => u.id === session.userId);
    if (!currentUser) { DB.clearSession(); window.location.href = "index.html"; return; }

    const serverRecord = await DB.getTodayRecord(currentUser.id).catch(() => null);
    const today = DB.todayStr();

    if (serverRecord && serverRecord.date === today) {
      todayState = {
        date: today,
        checkInTime: serverRecord.check_in || null,
        checkOutTime: serverRecord.check_out || null,
        lunchInTime: serverRecord.lunch_in || null,
        lunchOutTime: serverRecord.lunch_out || null,
        status: serverRecord.check_out ? "out" : (serverRecord.check_in ? "in" : "idle")
      };
    } else {
      todayState = {
        date: today, checkInTime: null, checkOutTime: null,
        lunchInTime: null, lunchOutTime: null, status: "idle"
      };
    }

    document.getElementById("sb-name").textContent = currentUser.name;
    document.getElementById("sb-avatar").textContent = currentUser.name[0];
    document.getElementById("sb-dept").textContent = currentUser.dept || "Staff";
    document.getElementById("topbar-av").textContent = currentUser.name[0];

    const h = new Date().getHours();
    document.getElementById("greeting-time").textContent = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
    document.getElementById("greeting-name").textContent = `Welcome back, ${currentUser.name.split(" ")[0]}!`;

    document.getElementById("profile-av").textContent = currentUser.name[0];
    document.getElementById("profile-name").textContent = currentUser.name;
    document.getElementById("profile-dept").textContent = currentUser.dept || "Staff";
    document.getElementById("profile-dept2").textContent = currentUser.dept || "—";
    document.getElementById("profile-username").textContent = currentUser.username;
    document.getElementById("profile-email").textContent = currentUser.email || "—";
    document.getElementById("profile-salary").textContent = currentUser.salary ? "₹" + Number(currentUser.salary).toLocaleString("en-IN") : "—";
    document.getElementById("profile-join").textContent = DB.fmtDate(currentUser.join_date);

    // Bank & KYC Details
    const bankFields = [
      { key: "bank_ac_no",  id: "profile-bank-ac",     row: "prow-bank-ac" },
      { key: "bank_name",   id: "profile-bank-name",   row: "prow-bank-name" },
      { key: "bank_branch", id: "profile-bank-branch", row: "prow-bank-branch" },
      { key: "bank_ifsc",   id: "profile-bank-ifsc",   row: "prow-bank-ifsc" },
      { key: "aadhar_no",   id: "profile-aadhar",      row: "prow-aadhar" },
      { key: "pan_no",      id: "profile-pan",         row: "prow-pan" }
    ];
    let hasAnyBank = false;
    bankFields.forEach(f => {
      const val = currentUser[f.key];
      const el = document.getElementById(f.id);
      const row = document.getElementById(f.row);
      if (val) {
        if (el) el.textContent = val;
        if (row) row.style.display = "";
        hasAnyBank = true;
      }
    });
    const bankCard = document.getElementById("profile-bank-card");
    if (bankCard && hasAnyBank) bankCard.style.display = "";

    startClock();
    restoreState();
    await renderDashboard();
    await renderMyAttendance();
    await renderMyLeaves();
    setDefaultAttDates();
  } catch (err) {
    console.error(err);
    showToast("Failed to load. Is the server running?", "error");
  }
};

// ===== CLOCK =====
function startClock() {
  function tick() {
    const n = new Date();
    document.getElementById("live-clock").textContent = n.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    document.getElementById("live-date").textContent = n.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    document.getElementById("topbar-time").textContent = n.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    document.getElementById("topbar-date").textContent = n.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    updateWorkingHours();
  }
  tick(); clockInterval = setInterval(tick, 1000);
}

function updateWorkingHours() {
  if (!todayState.checkInTime || todayState.checkOutTime) return;
  const now = new Date();
  const [ih, im] = todayState.checkInTime.split(":").map(Number);
  const elapsed = (now.getHours() * 60 + now.getMinutes()) - (ih * 60 + im);
  const net = Math.max(0, elapsed);
  document.getElementById("today-hours").textContent = DB.fmtMins(net);
}

// ===== STATE RESTORE =====
function restoreState() {
  if (todayState.checkInTime) {
    document.getElementById("today-checkin").textContent = todayState.checkInTime;
    document.getElementById("btn-checkin").classList.add("disabled");
    document.getElementById("btn-checkout").classList.remove("disabled");
    if (!todayState.checkOutTime) {
      document.getElementById("btn-lunch-in").classList.remove("disabled");
    }
  }

  if (todayState.lunchInTime) {
    document.getElementById("today-lunch-in").textContent = todayState.lunchInTime;
    document.getElementById("btn-lunch-in").classList.add("disabled");
    if (!todayState.lunchOutTime) document.getElementById("btn-lunch-out").classList.remove("disabled");
  }
  if (todayState.lunchOutTime) {
    document.getElementById("today-lunch-out").textContent = todayState.lunchOutTime;
    document.getElementById("btn-lunch-out").classList.add("disabled");
  }

  if (todayState.checkOutTime) {
    document.getElementById("today-checkout").textContent = todayState.checkOutTime;
    document.getElementById("btn-checkout").classList.add("disabled");
    document.getElementById("btn-lunch-in").classList.add("disabled");
    document.getElementById("btn-lunch-out").classList.add("disabled");
    setStatus("checked-out", "Checked Out");
  } else if (todayState.checkInTime) {
    setStatus("checked-in", "Working");
  }

  if (todayState.isHalfDay) {
    showToast("⚠️ Half Day marked — aap 12 baje ke baad aaye hain", "error");
    showLateBanner("half-day");
  } else if (todayState.isLate) {
    showLateBanner("late");
  }
}

function showLateBanner(type) {
  const existing = document.getElementById("late-banner");
  if (existing) return;
  const banner = document.createElement("div");
  banner.id = "late-banner";
  banner.style.cssText = `background:${type==="half-day"?"#dc2626":"#f59e0b"};color:#fff;padding:10px 18px;border-radius:8px;margin:10px 0;font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px`;
  banner.innerHTML = type === "half-day"
    ? `<i class="fa-solid fa-triangle-exclamation"></i> Half Day Marked`
    : `<i class="fa-solid fa-clock"></i> Late Arrival`;
  const container = document.querySelector(".page.active");
  if (container) container.insertBefore(banner, container.firstChild);
}

// ===== CHECK IN =====
async function doCheckIn() {
  if (todayState.checkInTime) return;
  showToast("📍 Location fetch ho rahi hai...", "info");
  try {
    const res = await DB.checkIn();
    todayState.checkInTime = res.checkIn;
    todayState.isLate = res.isLate;
    todayState.isHalfDay = res.isHalfDay;
    todayState.status = "in";

    document.getElementById("today-checkin").textContent = res.checkIn;
    document.getElementById("btn-checkin").classList.add("disabled");
    document.getElementById("btn-checkout").classList.remove("disabled");
    document.getElementById("btn-lunch-in").classList.remove("disabled");
    setStatus("checked-in", "Working");

    if (res.isHalfDay) {
      showToast("⚠️ Half Day marked! Aap 12:00 baje ke baad check-in kiye hain", "error");
      showLateBanner("half-day");
    } else if (res.isLate) {
      showToast("⚠️ Late Arrival! Aap 11:00 baje ke baad check-in kiye hain", "error");
      showLateBanner("late");
    } else {
      showToast("✅ Checked in at " + res.checkIn + (res.location ? ` · 📍 ${res.location}` : ""), "success");
    }
    await renderDashboard();
  } catch (err) {
    showToast(err.message || "Check-in failed", "error");
  }
}

// ===== CHECK OUT =====
async function doCheckOut() {
  if (!todayState.checkInTime || todayState.checkOutTime) return;
  showToast("📍 Location fetch ho rahi hai...", "info");
  try {
    const res = await DB.checkOut(0);
    todayState.checkOutTime = res.checkOut;

    document.getElementById("today-checkout").textContent = res.checkOut;
    document.getElementById("today-hours").textContent = DB.fmtMins(res.netMins);
    document.getElementById("btn-checkout").classList.add("disabled");
    document.getElementById("btn-lunch-in").classList.add("disabled");
    document.getElementById("btn-lunch-out").classList.add("disabled");
    setStatus("checked-out", "Checked Out");
    showToast(`👋 Checked out at ${res.checkOut} | ${DB.fmtMins(res.netMins)} worked`, "success");
    await renderDashboard();
    await renderMyAttendance();
  } catch (err) {
    showToast(err.message || "Check-out failed", "error");
  }
}

// ===== LUNCH IN =====
async function doLunchIn() {
  if (!todayState.checkInTime || todayState.checkOutTime || todayState.lunchInTime) return;
  showToast("📍 Location fetch ho rahi hai...", "info");
  try {
    const res = await DB.lunchIn();
    todayState.lunchInTime = res.lunchIn;
    document.getElementById("today-lunch-in").textContent = res.lunchIn;
    document.getElementById("btn-lunch-in").classList.add("disabled");
    document.getElementById("btn-lunch-out").classList.remove("disabled");
    setStatus("on-break", "Lunch Break");
    showToast("🍽️ Lunch break started at " + res.lunchIn, "info");
  } catch (err) {
    showToast(err.message || "Lunch In failed", "error");
  }
}

// ===== LUNCH OUT =====
async function doLunchOut() {
  if (!todayState.lunchInTime || todayState.lunchOutTime) return;
  showToast("📍 Location fetch ho rahi hai...", "info");
  try {
    const res = await DB.lunchOut();
    todayState.lunchOutTime = res.lunchOut;
    document.getElementById("today-lunch-out").textContent = res.lunchOut;
    document.getElementById("btn-lunch-out").classList.add("disabled");
    setStatus("checked-in", "Working");
    showToast(`🍽️ Lunch ended · ${DB.fmtMins(res.lunchMins)} break`, "info");
  } catch (err) {
    showToast(err.message || "Lunch Out failed", "error");
  }
}

function setStatus(cls, text) {
  const pill = document.getElementById("status-pill");
  pill.className = "status-pill " + cls;
  document.getElementById("status-text").textContent = text;
}

// ===== NAVIGATION =====
async function showPage(name, el) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  if (el) el.classList.add("active");
  const titles = { dashboard: "Dashboard", attendance: "My Attendance", leaves: "My Leaves", profile: "My Profile" };
  document.getElementById("page-title").textContent = titles[name] || name;
  if (name === "leaves") await renderMyLeaves();
  if (name === "attendance") await renderMyAttendance();
  if (name === "profile") await loadDocuments();
}

function toggleSidebar() {
  const sb = document.getElementById("sidebar");
  if (window.innerWidth <= 768) sb.classList.toggle("mobile-open");
  else sb.classList.toggle("collapsed");
}

function doLogout() { DB.clearSession(); window.location.href = "index.html"; }

// ===== DASHBOARD (Employee) =====
async function renderDashboard() {
  try {
    const att = await DB.getAttendance({ userId: currentUser.id });
    const leaves = await DB.getLeaves({ userId: currentUser.id });

    const now = new Date();
    const month = now.getMonth(); const year = now.getFullYear();

    const monthAtt = att.filter(a => {
      const d = new Date(a.date);
      return d.getMonth() === month && d.getFullYear() === year;
    });

    const totalWorkdays = countWeekdaysInMonth(year, month);
    const presentDays = monthAtt.length;
    const absentDays = Math.max(0, totalWorkdays - presentDays);
    const totalHours = monthAtt.reduce((s, a) => s + (a.net_mins || 0), 0);
    const leaveDays = leaves.filter(l => l.status === "approved").length;

    document.getElementById("month-present").textContent = presentDays;
    document.getElementById("month-absent").textContent = absentDays;
    document.getElementById("month-hours").textContent = Math.floor(totalHours / 60) + "h";
    document.getElementById("month-leaves").textContent = leaveDays;

    // Recent 7 days — FIX: i=0 means today is included (i goes 6 down to 0)
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      last7.push(d.toISOString().split("T")[0]);
    }

    const tbody = document.getElementById("emp-recent-att");
    const today = DB.todayStr();
    tbody.innerHTML = last7.map(date => {
      const r = att.find(a => a.date === date);

      // For today's date, also check todayState if no server record yet
      const isToday = (date === today);
      let statusLabel = "Absent", statusCls = "badge-absent";

      if (r) {
        if (r.check_out) {
          statusLabel = r.is_half_day ? "Half Day" : "Present";
          statusCls = r.is_half_day ? "badge-late" : "badge-present";
        } else {
          statusLabel = "In Progress"; statusCls = "badge-late";
        }
        if (r.is_late && !r.is_half_day) statusLabel += " (Late)";
      } else if (isToday && todayState && todayState.checkInTime) {
        statusLabel = "In Progress"; statusCls = "badge-late";
      }

      const checkIn  = r ? r.check_in  : (isToday && todayState.checkInTime  ? todayState.checkInTime  : "—");
      const checkOut = r ? (r.check_out || "—") : (isToday && todayState.checkOutTime ? todayState.checkOutTime : "—");
      const netHours = r && r.net_mins ? DB.fmtMins(r.net_mins) : "—";

      return `<tr>
        <td>${DB.fmtDate(date)}</td>
        <td>${checkIn}</td>
        <td>${checkOut}</td>
        <td>${r && r.lunch_in ? r.lunch_in : "—"}</td>
        <td>${r && r.lunch_out ? r.lunch_out : "—"}</td>
        <td><strong>${netHours}</strong></td>
        <td><span class="badge ${statusCls}">${statusLabel}</span></td>
      </tr>`;
    }).join("");
  } catch (err) {
    console.error(err);
  }
}

function countWeekdaysInMonth(year, month) {
  let count = 0;
  const today = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    if (date > today) break;
    if (date.getDay() !== 0 && date.getDay() !== 6) count++;
  }
  return count;
}

// ===== MY ATTENDANCE =====
function setDefaultAttDates() {
  const today = DB.todayStr();
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  document.getElementById("my-att-from").value = monthAgo.toISOString().split("T")[0];
  document.getElementById("my-att-to").value = today;
}

async function resetMyAttFilter() {
  setDefaultAttDates();
  await renderMyAttendance();
}

async function renderMyAttendance() {
  try {
    const att = await DB.getAttendance({ userId: currentUser.id });
    const from = document.getElementById("my-att-from").value;
    const to = document.getElementById("my-att-to").value;

    let filtered = att.filter(a => (!from || a.date >= from) && (!to || a.date <= to));

    const tbody = document.getElementById("my-att-tbody");
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No attendance records found</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(r => {
      let statusLabel = r.check_out ? (r.is_half_day ? "Half Day" : "Present") : "In Progress";
      if (r.is_late && !r.is_half_day && r.check_out) statusLabel += " (Late)";
      const statusCls = r.check_out ? (r.is_half_day ? "badge-late" : "badge-present") : "badge-late";
      return `
      <tr>
        <td>${DB.fmtDate(r.date)}</td>
        <td>${DB.dayName(r.date)}</td>
        <td>${r.check_in || "—"}</td>
        <td>${r.check_out || "—"}</td>
        <td>${r.lunch_in || "—"}</td>
        <td>${r.lunch_out || "—"}</td>
        <td><strong>${r.net_mins ? DB.fmtMins(r.net_mins) : "—"}</strong></td>
        <td><span class="badge ${statusCls}">${statusLabel}</span></td>
      </tr>`;
    }).join("");
  } catch (err) {
    showToast("Failed to load attendance", "error");
  }
}

async function exportMyAttendance() {
  try {
    const att = await DB.getAttendance({ userId: currentUser.id });
    let csv = "Date,Day,Check In,Check Out,Net Hours,Status\n";
    att.forEach(r => {
      const status = r.check_out ? (r.is_half_day ? "Half Day" : (r.is_late ? "Late" : "Present")) : "In Progress";
      csv += `${r.date},${DB.dayName(r.date)},${r.check_in||""},${r.check_out||""},${r.net_mins?(r.net_mins/60).toFixed(2):0},${status}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `my_attendance_${DB.todayStr()}.csv`; a.click();
    showToast("Exported!", "success");
  } catch (err) {
    showToast("Export failed", "error");
  }
}

// ===== MY LEAVES =====
async function renderMyLeaves() {
  try {
    const leaves = await DB.getLeaves({ userId: currentUser.id });
    const paid = leaves.filter(l => l.type === "paid" && l.status === "approved").length;
    const unpaid = leaves.filter(l => l.type === "unpaid" && l.status === "approved").length;
    const pending = leaves.filter(l => l.status === "pending").length;

    document.getElementById("paid-leaves-taken").textContent = paid;
    document.getElementById("unpaid-leaves-taken").textContent = unpaid;
    document.getElementById("pending-leaves-count").textContent = pending;

    const tbody = document.getElementById("my-leaves-tbody");
    if (leaves.length === 0) { tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No leave requests found</td></tr>'; return; }

    tbody.innerHTML = leaves.map(l => {
      const scls = { pending: "badge-pending", approved: "badge-approved", rejected: "badge-rejected" }[l.status] || "";
      const tcls = { paid: "badge-paid", unpaid: "badge-unpaid", sick: "badge-sick", casual: "badge-casual" }[l.type] || "";
      return `<tr>
        <td><span class="badge ${tcls}">${l.type}</span></td>
        <td>${DB.fmtDate(l.from_date)}</td>
        <td>${DB.fmtDate(l.to_date)}</td>
        <td>${l.days}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.reason || "—"}</td>
        <td>${DB.fmtDate(l.applied_on)}</td>
        <td><span class="badge ${scls}">${l.status}</span></td>
      </tr>`;
    }).join("");
  } catch (err) {
    showToast("Failed to load leaves", "error");
  }
}

function openLeaveModal() {
  document.getElementById("leave-type").value = "paid";
  document.getElementById("leave-from").value = "";
  document.getElementById("leave-to").value = "";
  document.getElementById("leave-days").value = "";
  document.getElementById("leave-reason").value = "";
  openModal("leave-modal");
}

function calcLeaveDays() {
  const from = document.getElementById("leave-from").value;
  const to = document.getElementById("leave-to").value;
  if (from && to) {
    const days = DB.diffDays(from, to);
    document.getElementById("leave-days").value = days + (days === 1 ? " day" : " days");
  }
}

async function submitLeave() {
  const from = document.getElementById("leave-from").value;
  const to = document.getElementById("leave-to").value;
  const reason = document.getElementById("leave-reason").value.trim();
  if (!from || !to || !reason) { showToast("Please fill all fields", "error"); return; }
  if (to < from) { showToast("End date must be after start date", "error"); return; }
  try {
    await DB.applyLeave({ type: document.getElementById("leave-type").value, from, to, reason });
    closeModal("leave-modal");
    await renderMyLeaves();
    showToast("Leave request submitted!", "success");
  } catch (err) {
    showToast(err.message || "Failed to submit leave", "error");
  }
}

// ===== MODAL =====
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

// ===== DOCUMENTS =====
async function loadDocuments() {
  try {
    const docs = await DB.getDocuments(currentUser.id);
    const docTypes = ["aadhar", "pan", "marksheet", "passbook"];
    docTypes.forEach(type => {
      const doc = docs.find(d => d.doc_type === type);
      const statusEl = document.getElementById("status-" + type);
      const viewEl = document.getElementById("view-" + type);
      const itemEl = document.getElementById("doc-" + type);
      if (doc) {
        statusEl.textContent = "Uploaded ✓";
        statusEl.className = "doc-status ok";
        viewEl.href = doc.file_data;
        viewEl.style.display = "inline-flex";
        itemEl.classList.add("uploaded");
      } else {
        statusEl.textContent = "Not uploaded";
        statusEl.className = "doc-status";
        viewEl.style.display = "none";
        itemEl.classList.remove("uploaded");
      }
    });
  } catch (err) {
    console.error("Failed to load documents", err);
  }
}

async function uploadDocument(type, input) {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast("File too large! Max 5MB allowed.", "error");
    input.value = "";
    return;
  }
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
  if (!allowedTypes.includes(file.type)) {
    showToast("Only PDF, JPG, PNG files allowed.", "error");
    input.value = "";
    return;
  }

  const statusEl = document.getElementById("status-" + type);
  statusEl.textContent = "Uploading...";

  try {
    // Pass file directly — db.js uses FormData (no base64, no size issues)
    await DB.uploadDocument(currentUser.id, type, file);
    showToast("Document uploaded successfully!", "success");
    await loadDocuments();
  } catch (err) {
    showToast(err.message || "Upload failed. Make sure the server is running.", "error");
    statusEl.textContent = "Not uploaded";
  }
  input.value = "";
}

// ===== TOAST =====
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove("show"), 3500);
}

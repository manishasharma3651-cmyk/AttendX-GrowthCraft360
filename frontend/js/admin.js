// ===== INIT =====
let session, currentLeaveFilter = "pending", editingEmpId = null;

window.onload = async () => {
  session = DB.getSession();
  if (!session || session.role !== "admin") { window.location.href = "index.html"; return; }

  document.getElementById("sb-name").textContent = session.name;
  document.getElementById("sb-avatar").textContent = session.name[0].toUpperCase();
  document.getElementById("topbar-av").textContent = session.name[0].toUpperCase();

  startClock();

  // Set default report dates
  const today = DB.todayStr();
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  document.getElementById("report-from").value = monthAgo.toISOString().split("T")[0];
  document.getElementById("report-to").value = today;

  await updateDashboard();
  await renderEmployees();
  await renderAdminAttendance();
  await populateReportFilters();
  await renderReports();
  await updateBadges();
};

// ===== CLOCK =====
function startClock() {
  function tick() {
    const n = new Date();
    document.getElementById("topbar-time").textContent = n.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    document.getElementById("topbar-date").textContent = n.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  tick(); setInterval(tick, 1000);
}

// ===== NAVIGATION =====
async function showPage(name, el) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  if (el) el.classList.add("active");

  const titles = { dashboard: "Dashboard", employees: "Employees", attendance: "Attendance", leaves: "Leave Requests", reports: "Reports" };
  document.getElementById("page-title").textContent = titles[name] || name;

  if (name === "dashboard") await updateDashboard();
  if (name === "employees") await renderEmployees();
  if (name === "attendance") await renderAdminAttendance();
  if (name === "leaves") await renderLeaves();
  if (name === "reports") { await populateReportFilters(); await renderReports(); }
}

function toggleSidebar() {
  const sb = document.getElementById("sidebar");
  if (window.innerWidth <= 768) sb.classList.toggle("mobile-open");
  else sb.classList.toggle("collapsed");
}

function doLogout() {
  DB.clearSession();
  window.location.href = "index.html";
}

// ===== DASHBOARD =====
async function updateDashboard() {
  try {
    const [stats, users, att, leaves] = await Promise.all([
      DB.getDashboardStats(),
      DB.getUsers(),
      DB.getAttendance({ date: DB.todayStr() }),
      DB.getLeaves()
    ]);

    document.getElementById("stat-total-emp").textContent = stats.totalEmployees;
    document.getElementById("stat-present").textContent = stats.presentToday;
    document.getElementById("stat-absent").textContent = stats.absentToday;
    document.getElementById("stat-pending-leaves").textContent = stats.pendingLeaves;
    if (document.getElementById("stat-late")) document.getElementById("stat-late").textContent = stats.lateToday || 0;
    if (document.getElementById("stat-halfday")) document.getElementById("stat-halfday").textContent = stats.halfDayToday || 0;
    document.getElementById("today-date-label").textContent = DB.fmtDate(DB.todayStr());

    // Donut chart
    const pct = stats.totalEmployees ? Math.round((stats.presentToday / stats.totalEmployees) * 100) : 0;
    const circ = 2 * Math.PI * 50;
    const fill = (pct / 100) * circ;
    document.getElementById("donut-fill").setAttribute("stroke-dasharray", `${fill.toFixed(1)} ${circ.toFixed(1)}`);
    document.getElementById("donut-pct").textContent = pct + "%";

    // Today attendance table
    const employees = users.filter(u => u.role === "employee");
    const tbody = document.getElementById("today-att-tbody");
    if (employees.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No employees found</td></tr>';
    } else {
      tbody.innerHTML = employees.map(u => {
        const a = att.find(x => x.user_id === u.id);
        let statusLabel = "Absent", cls = "badge-absent";
        if (a) {
          if (a.check_out) {
            statusLabel = a.is_half_day ? "Half Day" : (a.is_late ? "Late" : "Present");
            cls = a.is_half_day ? "badge-late" : (a.is_late ? "badge-late" : "badge-present");
          } else {
            statusLabel = "In Progress";
            cls = "badge-late";
          }
        }
        return `<tr>
          <td><div class="emp-cell">
            <div class="emp-av">${u.name[0]}</div>
            <div><div class="emp-cell-name">${u.name}</div><div class="emp-cell-dept">${u.dept || "—"}</div></div>
          </div></td>
          <td>${a && a.check_in ? a.check_in : "—"}</td>
          <td>${a && a.check_out ? a.check_out : "—"}</td>
          <td>${a && a.lunch_in ? a.lunch_in : "—"}</td>
          <td>${a && a.lunch_out ? a.lunch_out : "—"}</td>
          <td><strong>${a && a.net_mins ? DB.fmtMins(a.net_mins) : "—"}</strong></td>
          <td><span class="badge ${cls}">${statusLabel}</span></td>
        </tr>`;
      }).join("");
    }

    // Recent leaves
    const recentLeaves = leaves.slice(0, 5);
    const leaveList = document.getElementById("recent-leaves-list");
    if (recentLeaves.length === 0) {
      leaveList.innerHTML = '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">No leave requests</div>';
    } else {
      leaveList.innerHTML = recentLeaves.map(l => {
        const user = users.find(u => u.id === l.user_id);
        const scls = { pending: "badge-pending", approved: "badge-approved", rejected: "badge-rejected" }[l.status];
        return `<div class="activity-item">
          <div>
            <div class="activity-name">${user ? user.name : "Unknown"}</div>
            <div class="activity-meta">${l.type} · ${DB.fmtDate(l.from_date)}</div>
          </div>
          <span class="badge ${scls}">${l.status}</span>
        </div>`;
      }).join("");
    }
  } catch (err) {
    console.error("Dashboard error:", err);
    showToast("Failed to load dashboard. Is the server running?", "error");
  }
}

// ===== EMPLOYEES =====
async function renderEmployees() {
  try {
    const users = (await DB.getUsers()).filter(u => u.role === "employee");
    const q = (document.getElementById("emp-search").value || "").toLowerCase();
    const dept = document.getElementById("emp-dept-filter").value;

    const depts = [...new Set(users.map(u => u.dept).filter(Boolean))];
    const sel = document.getElementById("emp-dept-filter");
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}" ${d === cur ? "selected" : ""}>${d}</option>`).join("");

    let filtered = users.filter(u => {
      const match = u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.dept || "").toLowerCase().includes(q);
      const deptMatch = !dept || u.dept === dept;
      return match && deptMatch;
    });

    document.getElementById("emp-count-badge").textContent = users.length;

    const tbody = document.getElementById("emp-tbody");
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No employees found</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map((u, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><div class="emp-cell">
          <div class="emp-av">${u.name[0]}</div>
          <div class="emp-cell-name">${u.name}</div>
        </div></td>
        <td><code style="background:var(--surface2);padding:2px 8px;border-radius:4px;font-size:12px">${u.username}</code></td>
        <td>${u.dept || "—"}</td>
        <td>₹${Number(u.salary || 0).toLocaleString("en-IN")}</td>
        <td>${DB.fmtDate(u.join_date)}</td>
        <td>
          <button class="btn-outline btn-sm" onclick="viewEmployeeDocs('${u.id}','${u.name}')">
            <i class="fa-solid fa-folder-open"></i> View
          </button>
        </td>
        <td>
          <div class="action-btns">
            <button class="action-btn edit" onclick="openEditEmployee('${u.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn delete" onclick="deleteEmployee('${u.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join("");
  } catch (err) {
    console.error(err);
    showToast("Failed to load employees", "error");
  }
}

async function openEditEmployee(id) {
  const users = await DB.getUsers();
  const u = users.find(x => x.id === id);
  if (!u) return;
  editingEmpId = id;
  document.getElementById("emp-modal-title").textContent = "Edit Employee";
  document.getElementById("emp-name").value = u.name;
  document.getElementById("emp-username").value = u.username;
  document.getElementById("emp-password").value = "";
  document.getElementById("emp-dept").value = u.dept || "";
  document.getElementById("emp-salary").value = u.salary || "";
  document.getElementById("emp-email").value = u.email || "";
  document.getElementById("emp-joindate").value = u.join_date || "";
  openModal("emp-modal");
}

function openAddEmployee() {
  editingEmpId = null;
  document.getElementById("emp-modal-title").textContent = "Add Employee";
  ["emp-name", "emp-username", "emp-password", "emp-dept", "emp-salary", "emp-email"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("emp-joindate").value = DB.todayStr();
  openModal("emp-modal");
}

async function saveEmployee() {
  const name = document.getElementById("emp-name").value.trim();
  const username = document.getElementById("emp-username").value.trim();
  const password = document.getElementById("emp-password").value.trim();
  if (!name || !username) { showToast("Name and username are required", "error"); return; }
  if (!editingEmpId && !password) { showToast("Password is required for new employee", "error"); return; }

  const payload = {
    name, username, password,
    dept: document.getElementById("emp-dept").value.trim(),
    salary: document.getElementById("emp-salary").value,
    email: document.getElementById("emp-email").value.trim(),
    joinDate: document.getElementById("emp-joindate").value
  };

  try {
    if (editingEmpId) {
      await DB.updateUser(editingEmpId, payload);
      showToast("Employee updated successfully", "success");
    } else {
      await DB.addUser(payload);
      showToast("Employee added successfully", "success");
    }
    closeModal("emp-modal");
    await renderEmployees();
    await updateDashboard();
  } catch (err) {
    showToast(err.message || "Failed to save employee", "error");
  }
}

async function deleteEmployee(id) {
  if (!confirm("Are you sure you want to delete this employee?")) return;
  try {
    await DB.deleteUser(id);
    await renderEmployees();
    await updateDashboard();
    showToast("Employee deleted", "info");
  } catch (err) {
    showToast("Failed to delete employee", "error");
  }
}

// ===== ATTENDANCE (ADMIN) =====
async function renderAdminAttendance() {
  try {
    const [att, users] = await Promise.all([DB.getAttendance(), DB.getUsers()]);
    const q = (document.getElementById("att-search").value || "").toLowerCase();
    const dateF = document.getElementById("att-date-filter").value;

    let records = att.map(a => ({ ...a, user: users.find(u => u.id === a.user_id) }))
      .filter(a => a.user)
      .filter(a => {
        const nameMatch = a.user.name.toLowerCase().includes(q);
        const dateMatch = !dateF || a.date === dateF;
        return nameMatch && dateMatch;
      });

    const tbody = document.getElementById("admin-att-tbody");
    if (records.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No records found</td></tr>';
      return;
    }
    tbody.innerHTML = records.map(r => {
      let statusLabel = r.check_out ? (r.is_half_day ? "Half Day" : (r.is_late ? "Late" : "Complete")) : "In Progress";
      const statusCls = r.check_out ? (r.is_half_day ? "badge-late" : (r.is_late ? "badge-late" : "badge-present")) : "badge-late";
      return `<tr>
        <td><div class="emp-cell">
          <div class="emp-av">${r.user.name[0]}</div>
          <div class="emp-cell-name">${r.user.name}</div>
        </div></td>
        <td>${DB.fmtDate(r.date)}</td>
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

// ===== LEAVES (ADMIN) =====
function filterLeaves(status, el) {
  currentLeaveFilter = status;
  document.querySelectorAll(".ltab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  renderLeaves();
}

async function renderLeaves() {
  try {
    const [leaves, users] = await Promise.all([DB.getLeaves(), DB.getUsers()]);

    let filtered = leaves.filter(l => currentLeaveFilter === "all" || l.status === currentLeaveFilter);

    const tbody = document.getElementById("leaves-tbody");
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No leave requests found</td></tr>';
      updateBadgesFromData(leaves);
      return;
    }
    tbody.innerHTML = filtered.map(l => {
      const user = users.find(u => u.id === l.user_id);
      const scls = { pending: "badge-pending", approved: "badge-approved", rejected: "badge-rejected" }[l.status] || "";
      const tcls = { paid: "badge-paid", unpaid: "badge-unpaid", sick: "badge-sick", casual: "badge-casual" }[l.type] || "";
      const actions = l.status === "pending" ? `
        <div class="action-btns">
          <button class="action-btn approve" onclick="updateLeave('${l.id}','approved')" title="Approve"><i class="fa-solid fa-check"></i></button>
          <button class="action-btn reject" onclick="updateLeave('${l.id}','rejected')" title="Reject"><i class="fa-solid fa-xmark"></i></button>
        </div>` : '<span style="color:var(--text-muted);font-size:12px">—</span>';
      return `<tr>
        <td><div class="emp-cell">
          <div class="emp-av">${user ? user.name[0] : "?"}</div>
          <div class="emp-cell-name">${user ? user.name : "Unknown"}</div>
        </div></td>
        <td><span class="badge ${tcls}">${l.type}</span></td>
        <td>${DB.fmtDate(l.from_date)}</td>
        <td>${DB.fmtDate(l.to_date)}</td>
        <td>${l.days}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.reason || "—"}</td>
        <td><span class="badge ${scls}">${l.status}</span></td>
        <td>${actions}</td>
      </tr>`;
    }).join("");

    updateBadgesFromData(leaves);
  } catch (err) {
    showToast("Failed to load leaves", "error");
  }
}

function updateBadgesFromData(leaves) {
  const pending = leaves.filter(l => l.status === "pending").length;
  document.getElementById("leave-count-badge").textContent = pending;
}

async function updateBadges() {
  try {
    const leaves = await DB.getLeaves();
    updateBadgesFromData(leaves);
  } catch {}
}

async function updateLeave(id, status) {
  try {
    await DB.updateLeave(id, status);
    await renderLeaves();
    await updateDashboard();
    showToast(`Leave ${status}`, status === "approved" ? "success" : "error");
  } catch (err) {
    showToast("Failed to update leave", "error");
  }
}

// ===== REPORTS =====
async function populateReportFilters() {
  try {
    const users = (await DB.getUsers()).filter(u => u.role === "employee");
    const sel = document.getElementById("report-emp-filter");
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Employees</option>' + users.map(u => `<option value="${u.id}" ${u.id === cur ? "selected" : ""}>${u.name}</option>`).join("");
  } catch {}
}

async function resetReportFilters() {
  document.getElementById("report-emp-filter").value = "";
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  document.getElementById("report-from").value = monthAgo.toISOString().split("T")[0];
  document.getElementById("report-to").value = DB.todayStr();
  await renderReports();
}

async function renderReports() {
  try {
    const empId = document.getElementById("report-emp-filter").value;
    const from = document.getElementById("report-from").value;
    const to = document.getElementById("report-to").value;

    const params = {};
    if (empId) params.userId = empId;

    const [att, users] = await Promise.all([DB.getAttendance(params), DB.getUsers()]);

    let records = att.map(a => ({ ...a, user: users.find(u => u.id === a.user_id) }))
      .filter(a => a.user && a.user.role === "employee")
      .filter(a => (!from || a.date >= from) && (!to || a.date <= to));

    const totalDays = records.length;
    const totalHours = records.reduce((s, r) => s + (r.net_mins || 0), 0);
    const statsEl = document.getElementById("report-stats");
    statsEl.innerHTML = `
      <div class="stat-card" style="--accent:#6366f1"><div class="stat-icon"><i class="fa-solid fa-list-check"></i></div><div class="stat-body"><div class="stat-value">${totalDays}</div><div class="stat-label">Total Records</div></div></div>
      <div class="stat-card" style="--accent:#22c55e"><div class="stat-icon"><i class="fa-solid fa-clock"></i></div><div class="stat-body"><div class="stat-value">${DB.fmtMins(totalHours)}</div><div class="stat-label">Total Hours</div></div></div>
      <div class="stat-card" style="--accent:#f59e0b"><div class="stat-icon"><i class="fa-solid fa-calculator"></i></div><div class="stat-body"><div class="stat-value">${totalDays ? DB.fmtMins(Math.round(totalHours / totalDays)) : "0m"}</div><div class="stat-label">Avg Daily Hours</div></div></div>
    `;

    const tbody = document.getElementById("report-tbody");
    if (records.length === 0) { tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No records in selected range</td></tr>'; return; }
    tbody.innerHTML = records.map(r => {
      const statusLabel = r.check_out ? (r.is_half_day ? "Half Day" : (r.is_late ? "Late" : "Complete")) : "Partial";
      const statusCls = r.check_out ? (r.is_half_day || r.is_late ? "badge-late" : "badge-present") : "badge-late";
      return `<tr>
        <td><div class="emp-cell"><div class="emp-av">${r.user.name[0]}</div><div class="emp-cell-name">${r.user.name}</div></div></td>
        <td>${DB.fmtDate(r.date)}</td>
        <td>${r.check_in || "—"}</td>
        <td>${r.check_out || "—"}</td>
        <td>${r.lunch_in || "—"}</td>
        <td>${r.lunch_out || "—"}</td>
        <td><strong>${r.net_mins ? DB.fmtMins(r.net_mins) : "—"}</strong></td>
        <td><span class="badge ${statusCls}">${statusLabel}</span></td>
      </tr>`;
    }).join("");
  } catch (err) {
    showToast("Failed to load reports", "error");
  }
}

// ===== CSV EXPORT =====
async function exportCSV() {
  try {
    const [att, users] = await Promise.all([DB.getAttendance(), DB.getUsers()]);
    let csv = "Employee,Date,Check In,Check Out,Lunch In,Lunch Out,Net Hours,Status\n";
    att.forEach(a => {
      const u = users.find(x => x.id === a.user_id);
      if (!u) return;
      const status = a.check_out ? (a.is_half_day ? "Half Day" : (a.is_late ? "Late" : "Complete")) : "Partial";
      csv += `"${u.name}",${a.date},${a.check_in||""},${a.check_out||""},${a.lunch_in||""},${a.lunch_out||""},${a.net_mins?(a.net_mins/60).toFixed(2):0},${status}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attendance_report_${DB.todayStr()}.csv`;
    a.click();
    showToast("CSV exported!", "success");
  } catch (err) {
    showToast("Export failed", "error");
  }
}

// ===== DOCUMENTS =====
const DOC_LABELS = {
  aadhar:    { label: "Aadhaar Card",          icon: "fa-id-card" },
  pan:       { label: "PAN Card",              icon: "fa-credit-card" },
  marksheet: { label: "Graduation Marksheet",  icon: "fa-graduation-cap" },
  passbook:  { label: "Bank Passbook",         icon: "fa-book-open" }
};

async function viewEmployeeDocs(userId, userName) {
  document.getElementById("docs-modal-name").textContent = userName;
  const content = document.getElementById("docs-modal-content");
  content.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';
  openModal("docs-modal");
  try {
    const docs = await DB.getDocuments(userId);
    const types = Object.keys(DOC_LABELS);
    if (docs.length === 0) {
      content.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px"><i class="fa-solid fa-folder-open" style="font-size:32px;display:block;margin-bottom:10px"></i>No documents uploaded yet</div>';
      return;
    }
    content.innerHTML = `<div class="doc-upload-grid">${types.map(type => {
      const doc = docs.find(d => d.doc_type === type);
      const meta = DOC_LABELS[type];
      return `<div class="doc-upload-item ${doc ? 'uploaded' : ''}">
        <div class="doc-icon"><i class="fa-solid ${meta.icon}"></i></div>
        <div class="doc-info">
          <div class="doc-label">${meta.label}</div>
          <div class="doc-status ${doc ? 'ok' : ''}">${doc ? "Uploaded ✓" : "Not uploaded"}</div>
        </div>
        <div class="doc-actions">
          ${doc ? `<a class="doc-view-btn" href="${doc.file_data}" target="_blank"><i class="fa-solid fa-eye"></i> View</a>` : '<span style="font-size:11px;color:var(--text-muted)">—</span>'}
        </div>
      </div>`;
    }).join("")}</div>`;
  } catch (err) {
    content.innerHTML = '<div style="text-align:center;color:var(--red);padding:30px">Failed to load documents</div>';
  }
}

// ===== MODAL =====
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

// ===== TOAST =====
function showToast(msg, type = "info") {
  const icons = { success: "✅", error: "❌", info: "ℹ️" };
  const t = document.getElementById("toast");
  t.textContent = (icons[type] || "") + " " + msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove("show"), 3000);
}

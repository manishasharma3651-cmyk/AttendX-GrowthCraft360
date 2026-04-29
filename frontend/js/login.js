let selectedRole = "admin";

function setRole(role, btn) {
  selectedRole = role;
  document.querySelectorAll(".role-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

function togglePass(icon) {
  const input = document.getElementById("login-password");
  if (input.type === "password") {
    input.type = "text";
    icon.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    input.type = "password";
    icon.classList.replace("fa-eye-slash", "fa-eye");
  }
}

function fillDemo(user, pass, role) {
  document.getElementById("login-username").value = user;
  document.getElementById("login-password").value = pass;
  document.querySelectorAll(".role-tab").forEach(b => {
    if (b.dataset.role === role) b.click();
  });
}

async function doLogin() {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value.trim();

  if (!username || !password) {
    showError("Please enter username and password.");
    return;
  }

  const btn = document.querySelector(".login-btn");
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
  btn.disabled = true;

  try {
    const user = await DB.login(username, password, selectedRole);
    if (user.role === "admin") {
      window.location.href = "admin.html";
    } else {
      window.location.href = "employee.html";
    }
  } catch (err) {
    showError(err.message || "Login failed. Please try again.");
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function showError(msg) {
  const el = document.getElementById("login-error");
  el.textContent = "⚠ " + msg;
  el.style.display = "block";
}

document.addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});

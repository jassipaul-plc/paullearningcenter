const db = window.supabaseClient || null;

const authDisplayNameInput = document.getElementById("authDisplayName");
const authEmailInput = document.getElementById("authEmail");
const authPasswordInput = document.getElementById("authPassword");
const authSignupBtn = document.getElementById("authSignupBtn");
const authLoginBtn = document.getElementById("authLoginBtn");
const authStatusEl = document.getElementById("authStatus");

function authStatus(text, kind = "") {
  if (!authStatusEl) return;
  authStatusEl.textContent = text || "";
  authStatusEl.className = "auth-status";
  if (kind) authStatusEl.classList.add(kind);
}

function defaultDisplayNameForUser(user, preferred = "") {
  const p = (preferred || "").trim();
  if (p) return p;
  if (user?.user_metadata?.display_name) return String(user.user_metadata.display_name).trim();
  if (user?.email) return String(user.email).split("@")[0];
  return "Student";
}

async function ensureProfileRow(user, preferredDisplayName = "") {
  if (!user?.id) return null;
  const fullName = defaultDisplayNameForUser(user, preferredDisplayName);
  const payload = {
    id: user.id,
    role: "student",
    full_name: fullName,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id, full_name, role")
    .single();
  if (error) throw error;
  return data;
}

async function ensureStudentRow(user, preferredDisplayName = "") {
  if (!user?.id) return null;
  const displayName = defaultDisplayNameForUser(user, preferredDisplayName);

  const { data: existing, error: existingErr } = await db
    .from("students")
    .select("id, user_id, display_name, grade_level")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing?.id) return existing;

  const insertPayload = {
    user_id: user.id,
    display_name: displayName,
    grade_level: null,
  };
  const { data: created, error: insertErr } = await db
    .from("students")
    .insert(insertPayload)
    .select("id, user_id, display_name, grade_level")
    .single();
  if (insertErr) throw insertErr;
  return created;
}

async function bootstrapStudent(user, preferredDisplayName = "") {
  if (!user?.id) return null;
  await ensureProfileRow(user, preferredDisplayName);
  const student = await ensureStudentRow(user, preferredDisplayName);
  if (student?.id) {
    window.__AUTH_STUDENT_ID = student.id;
    window.currentStudentId = student.id;
    localStorage.setItem("plc_auth_student_id", student.id);
  }
  return student;
}

function goToTutor() {
  window.location.href = "index.html";
}

async function handleSignup() {
  if (!db) {
    authStatus("Supabase client is not initialized.", "error");
    return;
  }

  const email = (authEmailInput?.value || "").trim();
  const password = authPasswordInput?.value || "";
  const displayName = (authDisplayNameInput?.value || "").trim();
  if (!email || !password) {
    authStatus("Enter email and password to sign up.", "error");
    return;
  }

  authStatus("Creating account...");
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || email.split("@")[0] },
    },
  });
  if (error) {
    authStatus(error.message || "Signup failed.", "error");
    return;
  }

  if (data?.user) {
    try {
      await bootstrapStudent(data.user, displayName);
      authStatus("Signup successful. Redirecting...", "success");
      setTimeout(goToTutor, 450);
      return;
    } catch (bootstrapErr) {
      console.error("[auth] bootstrap failed", bootstrapErr);
      authStatus(bootstrapErr?.message || "Account created, but profile setup failed.", "error");
      return;
    }
  }

  authStatus("Signup submitted. Please confirm email, then login.", "success");
}

async function handleLogin() {
  if (!db) {
    authStatus("Supabase client is not initialized.", "error");
    return;
  }

  const email = (authEmailInput?.value || "").trim();
  const password = authPasswordInput?.value || "";
  if (!email || !password) {
    authStatus("Enter email and password to login.", "error");
    return;
  }

  authStatus("Logging in...");
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    authStatus(error.message || "Login failed.", "error");
    return;
  }

  try {
    await bootstrapStudent(data?.user || null);
    authStatus("Login successful. Redirecting...", "success");
    setTimeout(goToTutor, 300);
  } catch (bootstrapErr) {
    console.error("[auth] bootstrap failed", bootstrapErr);
    authStatus(bootstrapErr?.message || "Logged in, but profile setup failed.", "error");
  }
}

async function initAuthPage() {
  if (!db) {
    authStatus("Supabase client unavailable. Check supabaseClient.js values.", "error");
    return;
  }

  authSignupBtn?.addEventListener("click", handleSignup);
  authLoginBtn?.addEventListener("click", handleLogin);

  const { data, error } = await db.auth.getSession();
  if (error) {
    console.error("[auth] getSession failed", error);
  }

  if (data?.session?.user) {
    try {
      await bootstrapStudent(data.session.user);
      authStatus("Session found. Redirecting...", "success");
      setTimeout(goToTutor, 200);
    } catch (bootstrapErr) {
      console.error("[auth] bootstrap failed", bootstrapErr);
      authStatus(bootstrapErr?.message || "Session found, but profile setup failed.", "error");
    }
  }
}

initAuthPage().catch((err) => {
  console.error("[auth] init failed", err);
  authStatus("Auth init failed. Please retry.", "error");
});

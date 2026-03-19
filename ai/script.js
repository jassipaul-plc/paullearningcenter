const db = window.supabaseClient || null;

function isUuidLike(value) {
  const s = (value ?? "").toString().trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function computeMasteryLevel(accuracy, attempts) {
  const a = Number(accuracy) || 0;
  const n = Number(attempts) || 0;
  if (a < 50) return "Beginner";
  if (a < 75) return "Developing";
  if (a < 90) return "Proficient";
  if (n >= 10) return "Master";
  return "Proficient";
}

async function logActivity({
  studentId,
  mode = "homework",
  topicKey = "general",
  skillKey = "general",
  difficulty = "easy",
  result = "incorrect",
  errorType = null,
  timeSpentSeconds = 0,
  hintsUsed = 0,
  metadata = {},
}) {
  try {
    if (!db || !isUuidLike(studentId)) {
      return { ok: false, skipped: true, reason: "missing_client_or_non_uuid_student_id" };
    }
    const payload = {
      student_id: studentId,
      mode: (mode || "homework").toString().trim(),
      topic_key: (topicKey || "general").toString().trim(),
      skill_key: (skillKey || topicKey || "general").toString().trim(),
      difficulty: (difficulty || "easy").toString().trim(),
      result: (result || "incorrect").toString().trim(),
      error_type: errorType ? String(errorType).trim() : null,
      time_spent_seconds: Math.max(0, Number(timeSpentSeconds) || 0),
      hints_used: Math.max(0, Number(hintsUsed) || 0),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    };
    const { data, error } = await db.from("activity_log").insert(payload).select("id").single();
    if (error) return { ok: false, error };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function upsertSkillProgress({
  studentId,
  topicKey = "general",
  skillKey = "general",
  attemptsDelta = 0,
  correctDelta = 0,
  incorrectDelta = 0,
  hintsUsedDelta = 0,
  lastErrorType = null,
}) {
  try {
    if (!db || !isUuidLike(studentId)) {
      return { ok: false, skipped: true, reason: "missing_client_or_non_uuid_student_id" };
    }
    const topic = (topicKey || "general").toString().trim();
    const skill = (skillKey || topic).toString().trim();

    const { data: existing, error: selectErr } = await db
      .from("skill_progress")
      .select("attempts, correct, incorrect, hints_used")
      .eq("student_id", studentId)
      .eq("topic_key", topic)
      .eq("skill_key", skill)
      .maybeSingle();
    if (selectErr) return { ok: false, error: selectErr };

    const attempts = (Number(existing?.attempts) || 0) + Math.max(0, Number(attemptsDelta) || 0);
    const correct = (Number(existing?.correct) || 0) + Math.max(0, Number(correctDelta) || 0);
    const incorrect = (Number(existing?.incorrect) || 0) + Math.max(0, Number(incorrectDelta) || 0);
    const hintsUsed = (Number(existing?.hints_used) || 0) + Math.max(0, Number(hintsUsedDelta) || 0);
    const accuracy = attempts > 0 ? Number(((correct / attempts) * 100).toFixed(2)) : 0;

    const payload = {
      student_id: studentId,
      topic_key: topic,
      skill_key: skill,
      attempts,
      correct,
      incorrect,
      accuracy,
      hints_used: hintsUsed,
      last_error_type: lastErrorType ? String(lastErrorType).trim() : null,
      mastery_level: computeMasteryLevel(accuracy, attempts),
    };

    const { data, error } = await db
      .from("skill_progress")
      .upsert(payload, { onConflict: "student_id,topic_key,skill_key" })
      .select("student_id, topic_key, skill_key, attempts, correct, incorrect, accuracy, hints_used, mastery_level")
      .single();
    if (error) return { ok: false, error };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function fetchStudentProgressFromSupabase(studentId) {
  if (!db || !isUuidLike(studentId)) return null;
  try {
    const [{ data: skillRows, error: skillErr }, { data: logRows, error: logErr }] = await Promise.all([
      db
        .from("skill_progress")
        .select("topic_key, skill_key, attempts, correct, incorrect, accuracy, hints_used, last_error_type, updated_at")
        .eq("student_id", studentId),
      db
        .from("activity_log")
        .select("mode, topic_key, skill_key, difficulty, result, error_type, time_spent_seconds, hints_used, metadata, created_at")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (skillErr || logErr) return null;

    const byTopic = {};
    for (const row of skillRows || []) {
      const topic = ((row?.topic_key ?? "general").toString().trim() || "general");
      if (!byTopic[topic]) byTopic[topic] = { attempts: 0, correct: 0, incorrect: 0, accuracy: 0 };
      byTopic[topic].attempts += Number(row.attempts) || 0;
      byTopic[topic].correct += Number(row.correct) || 0;
      byTopic[topic].incorrect += Number(row.incorrect) || 0;
    }
    for (const topic of Object.keys(byTopic)) {
      const t = byTopic[topic];
      t.accuracy = t.attempts > 0 ? Number(((t.correct / t.attempts) * 100).toFixed(2)) : 0;
    }

    const totals = Object.values(byTopic).reduce(
      (acc, t) => {
        acc.attempts += t.attempts;
        acc.correct += t.correct;
        acc.incorrect += t.incorrect;
        return acc;
      },
      { attempts: 0, correct: 0, incorrect: 0 }
    );
    const totalAccuracy = totals.attempts > 0 ? Number(((totals.correct / totals.attempts) * 100).toFixed(2)) : 0;

    const errorTypeByTopic = {};
    const recentEvents = [];
    let timedAttempts = 0;
    let totalTimeSeconds = 0;
    const byMode = {};

    for (const row of logRows || []) {
      const topic = ((row?.topic_key ?? "general").toString().trim() || "general");
      const mode = ((row?.mode ?? "homework").toString().trim() || "homework");
      const result = ((row?.result ?? "incorrect").toString().trim() || "incorrect");
      const sec = Number(row.time_spent_seconds) || 0;
      const isCorrect = result === "correct";

      if (!byMode[mode]) byMode[mode] = { attempts: 0, correct: 0, incorrect: 0, accuracy: 0 };
      byMode[mode].attempts += 1;
      if (isCorrect) byMode[mode].correct += 1;
      else byMode[mode].incorrect += 1;

      if (sec > 0) {
        timedAttempts += 1;
        totalTimeSeconds += sec;
      }

      const err = (row?.error_type ?? "").toString().trim().toUpperCase();
      if (err) {
        if (!errorTypeByTopic[topic]) errorTypeByTopic[topic] = {};
        errorTypeByTopic[topic][err] = (errorTypeByTopic[topic][err] || 0) + 1;
      }

      recentEvents.push({
        ts: row.created_at,
        mode,
        topic,
        isCorrect,
        meta: {
          difficulty: ((row?.difficulty ?? "easy").toString().trim() || "easy"),
          timeSpentMs: sec * 1000,
          hintsUsed: Number(row?.hints_used) || 0,
          metadata: row?.metadata || {},
        },
      });
    }

    for (const mode of Object.keys(byMode)) {
      const m = byMode[mode];
      m.accuracy = m.attempts > 0 ? Number(((m.correct / m.attempts) * 100).toFixed(2)) : 0;
    }

    const weakTopics = Object.entries(byTopic)
      .filter(([, v]) => v.attempts >= 3 && v.incorrect >= 2 && v.accuracy < 85)
      .sort((a, b) => {
        if (a[1].accuracy !== b[1].accuracy) return a[1].accuracy - b[1].accuracy;
        return b[1].attempts - a[1].attempts;
      })
      .slice(0, 3)
      .map(([topic, stats]) => ({ topic, ...stats }));

    return {
      studentId,
      totals: {
        attempts: totals.attempts,
        correct: totals.correct,
        incorrect: totals.incorrect,
        accuracy: totalAccuracy,
        averageTimePerProblemSec: timedAttempts > 0 ? Math.round(totalTimeSeconds / timedAttempts) : 0,
      },
      byTopic,
      byMode,
      errorTypeByTopic,
      weakTopics,
      recentEvents: recentEvents.slice(0, 30),
    };
  } catch {
    return null;
  }
}

// ----------------- Mode Switching -----------------
const menuHomework = document.getElementById("menuHomework");
const menuGuided = document.getElementById("menuGuided");
const menuProgress = document.getElementById("menuProgress");
const authDisplayNameInput = document.getElementById("authDisplayName");
const authEmailInput = document.getElementById("authEmail");
const authPasswordInput = document.getElementById("authPassword");
const authSignupBtn = document.getElementById("authSignupBtn");
const authLoginBtn = document.getElementById("authLoginBtn");
const authLogoutBtn = document.getElementById("authLogoutBtn");
const authStatusEl = document.getElementById("authStatus");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const notificationBtn = document.getElementById("notificationBtn");
const notificationMenu = document.getElementById("notificationMenu");
const profileName = document.getElementById("profileName");
const profileMenuBtn = document.getElementById("profileMenuBtn");
const profileMenu = document.getElementById("profileMenu");
const profileSettingsBtn = document.getElementById("profileSettingsBtn");
const profilePaymentBtn = document.getElementById("profilePaymentBtn");
const homeworkPanel = document.getElementById("homeworkPanel");
const guidedPanel = document.getElementById("guidedPanel");
const progressPanel = document.getElementById("progressPanel");

function setMode(mode) {
  const isHomework = mode === "homework";
  const isGuided = mode === "guided";
  const isProgress = mode === "progress";

  menuHomework.classList.toggle("active", isHomework);
  menuGuided.classList.toggle("active", isGuided);
  menuProgress.classList.toggle("active", isProgress);

  homeworkPanel.style.display = isHomework ? "block" : "none";
  guidedPanel.style.display = isGuided ? "block" : "none";
  progressPanel.style.display = isProgress ? "block" : "none";

  if (isGuided) guidedInit();
  if (isProgress) loadProgress();
}

menuHomework.addEventListener("click", () => setMode("homework"));
menuGuided.addEventListener("click", () => setMode("guided"));
menuProgress.addEventListener("click", () => setMode("progress"));

// ----------------- Homework Generator + Grader -----------------
const hwGrade = document.getElementById("hwGrade");
const hwTopic = document.getElementById("hwTopic");
const hwDifficulty = document.getElementById("hwDifficulty");
const hwCount = document.getElementById("hwCount");

const generateBtn = document.getElementById("generateBtn");
const gradeBtn = document.getElementById("gradeBtn");

const problemsContainer = document.getElementById("problemsContainer");
const scoreContainer = document.getElementById("scoreContainer");
const targetedPracticeBox = document.getElementById("targetedPracticeBox");
const practiceBannerEl = document.getElementById("practiceBanner");
const practiceBannerTextEl = document.getElementById("practiceBannerText");
const exitPracticeBtn = document.getElementById("exitPracticeBtn");
const studentNameLabel = document.getElementById("studentNameLabel");
const sessionDateEl = document.getElementById("sessionDate");
const sessionDurationEl = document.getElementById("sessionDuration");
const progressSummaryEl = document.getElementById("progressSummary");
const progressHeadlineEl = document.getElementById("progressHeadline");
const errorTypeStatsEl = document.getElementById("errorTypeStats");
const weakTopicsListEl = document.getElementById("weakTopicsList");
const topicStatsEl = document.getElementById("topicStats");
const recentActivityEl = document.getElementById("recentActivity");
const studentSelectEl = document.getElementById("studentSelect");
const recommendedPracticeBoxEl = document.getElementById("recommendedPracticeBox");

let homeworkState = null;
let homeworkQuestionState = {};
let latestMistakeBreakdown = {};
let latestCurrentErrorCounts = {};
let latestAdaptivePlan = null;
let latestDifficultyRecommendation = {
  currentDifficulty: "easy",
  recommendedDifficulty: "easy",
  accuracy: 0,
  attempted: 0,
  correct: 0,
  unanswered: 0,
};
let isTargetedPractice = false;
let practiceMeta = {
  reason: "",
  lockedTopic: "",
  lockedDifficulty: "",
  skillName: "",
};
const parentName = "Jassi Paul";
const householdStudents = ["Pearlin", "Prajveer"];
let activeStudentId = getOrCreateActiveStudentId();
let authUser = null;
let authStudentRow = null;
if (profileName) profileName.innerText = parentName;

function getCurrentStudentId() {
  const fromWindow =
    (typeof window !== "undefined" && (window.__AUTH_STUDENT_ID || window.currentStudentId)) || "";
  const fromStorage = localStorage.getItem("plc_auth_student_id") || "";
  return (fromWindow || fromStorage || activeStudentId || "").toString().trim();
}

function getAuthDisplayName() {
  if (authStudentRow?.display_name) return authStudentRow.display_name;
  if (authUser?.user_metadata?.display_name) return authUser.user_metadata.display_name;
  if (authUser?.email) return authUser.email.split("@")[0];
  return "";
}

function authStatus(text, isError = false) {
  if (!authStatusEl) return;
  authStatusEl.textContent = text;
  authStatusEl.style.color = isError ? "#b00020" : "";
}

function goToAuthPage() {
  if (typeof window === "undefined") return;
  const isAuthPage = /\/auth\.html$/i.test(window.location.pathname || "");
  if (isAuthPage) return;
  window.location.href = "auth.html";
}

function tutorEndpoint() {
  // Netlify dev serves static files on :3999 and functions/proxy on :8888.
  // If user opens :3999 directly (localhost or 127.0.0.1), force requests to :8888.
  if (location.port === "3999") {
    return `${location.protocol}//${location.hostname}:8888/.netlify/functions/tutor`;
  }
  return "/.netlify/functions/tutor";
}

function safeJsonParse(resText) {
  try {
    return JSON.parse(resText || "{}");
  } catch {
    return {};
  }
}

async function parseApiResponse(res) {
  const txt = await res.text();
  const data = safeJsonParse(txt);
  if (!data || typeof data !== "object") return { ok: false, error: "Invalid server response", details: "" };
  return data;
}

function readApiError(data, fallback = "Something went wrong.") {
  const error = (data && data.error) ? String(data.error) : fallback;
  const details = (data && data.details) ? String(data.details) : "";
  return details ? `${error} (${details})` : error;
}

function logApiError(context, data) {
  if (data && data.ok === false) {
    console.error(`[${context}]`, {
      error: data.error || "Unknown error",
      details: data.details || "",
      mode: data.mode || "",
    });
  }
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

async function ensureAuthStudentBootstrap(user, preferredDisplayName = "") {
  if (!user?.id) return null;
  await ensureProfileRow(user, preferredDisplayName);
  const student = await ensureStudentRow(user, preferredDisplayName);
  authStudentRow = student;
  if (student?.id) {
    if (typeof window !== "undefined") {
      window.__AUTH_STUDENT_ID = student.id;
      window.currentStudentId = student.id;
    }
    localStorage.setItem("plc_auth_student_id", student.id);
    setActiveStudent(student.id);
  }
  return student;
}

function setAuthUiForLoggedIn(user) {
  const label = user?.email || "student";
  authStatus(`Logged in as ${label}`);
  if (authLoginBtn) authLoginBtn.disabled = true;
  if (authSignupBtn) authSignupBtn.disabled = true;
  if (authLogoutBtn) authLogoutBtn.disabled = false;
}

function setAuthUiForLoggedOut() {
  authStatus("Not logged in");
  if (authLoginBtn) authLoginBtn.disabled = false;
  if (authSignupBtn) authSignupBtn.disabled = false;
  if (authLogoutBtn) authLogoutBtn.disabled = true;
}

async function applyAuthSession(user, preferredDisplayName = "") {
  authUser = user || null;
  if (!authUser) {
    authStudentRow = null;
    if (typeof window !== "undefined") {
      delete window.__AUTH_STUDENT_ID;
    }
    localStorage.removeItem("plc_auth_student_id");
    setAuthUiForLoggedOut();
    initStudentSelector();
    loadProgress();
    goToAuthPage();
    return;
  }

  try {
    await ensureAuthStudentBootstrap(authUser, preferredDisplayName);
    const name = getAuthDisplayName();
    if (studentNameLabel) studentNameLabel.textContent = name || "Student";
    if (profileName) profileName.textContent = name || parentName;
    setAuthUiForLoggedIn(authUser);
    initStudentSelector();
    loadProgress();
  } catch (err) {
    console.error("[auth] bootstrap failed", err);
    authStatus(`Auth setup error: ${err?.message || "Unknown error"}`, true);
  }
}

async function handleSignup() {
  if (!db) {
    authStatus("Supabase is not initialized. Check Supabase URL and anon key.", true);
    return;
  }
  const email = (authEmailInput?.value || "").trim();
  const password = authPasswordInput?.value || "";
  const displayName = (authDisplayNameInput?.value || "").trim();
  if (!email || !password) {
    authStatus("Enter email and password to sign up.", true);
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
    authStatus(error.message || "Signup failed.", true);
    return;
  }
  const user = data?.user || null;
  if (user) {
    await applyAuthSession(user, displayName);
    authStatus("Signup successful.");
  } else {
    authStatus("Signup submitted. Please confirm email, then login.");
  }
}

async function handleLogin() {
  if (!db) {
    authStatus("Supabase is not initialized. Check Supabase URL and anon key.", true);
    return;
  }
  const email = (authEmailInput?.value || "").trim();
  const password = authPasswordInput?.value || "";
  if (!email || !password) {
    authStatus("Enter email and password to login.", true);
    return;
  }
  authStatus("Logging in...");
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    authStatus(error.message || "Login failed.", true);
    return;
  }
  await applyAuthSession(data?.user || null);
}

async function handleLogout() {
  if (!db) {
    authStatus("Supabase is not initialized. Check Supabase URL and anon key.", true);
    return;
  }
  authStatus("Logging out...");
  const { error } = await db.auth.signOut();
  if (error) {
    authStatus(error.message || "Logout failed.", true);
    return;
  }
  await applyAuthSession(null);
  goToAuthPage();
}

async function initAuth() {
  if (!db) {
    authStatus("Supabase client unavailable. Verify CDN and supabaseClient.js load order.", true);
    return;
  }
  setAuthUiForLoggedOut();

  if (authSignupBtn) authSignupBtn.addEventListener("click", handleSignup);
  if (authLoginBtn) authLoginBtn.addEventListener("click", handleLogin);
  if (authLogoutBtn) authLogoutBtn.addEventListener("click", handleLogout);

  const { data, error } = await db.auth.getSession();
  if (error) {
    console.error("[auth] getSession failed", error);
  }
  await applyAuthSession(data?.session?.user || null);

  db.auth.onAuthStateChange(async (_event, session) => {
    await applyAuthSession(session?.user || null);
  });
}

function getOrCreateActiveStudentId() {
  const key = "plc_active_student_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = householdStudents[0];
    localStorage.setItem(key, id);
  }
  return id;
}

function setActiveStudent(studentId) {
  if (!studentId) return;
  activeStudentId = studentId;
  if (typeof window !== "undefined" && !window.__AUTH_STUDENT_ID) {
    window.currentStudentId = studentId;
  }
  localStorage.setItem("plc_active_student_id", studentId);
  if (studentSelectEl) studentSelectEl.value = studentId;
  if (studentNameLabel) studentNameLabel.innerText = studentId;
}

function initStudentSelector() {
  if (!studentSelectEl) return;
  const authStudentId = getCurrentStudentId();
  const authName = getAuthDisplayName();
  if (authUser && authStudentId) {
    studentSelectEl.innerHTML = `<option value="${authStudentId}">${authName || "Student"}</option>`;
  } else {
    studentSelectEl.innerHTML = householdStudents
      .map((name) => `<option value="${name}">${name}</option>`)
      .join("");
  }
  setActiveStudent(activeStudentId);
  studentSelectEl.onchange = () => {
    const next = studentSelectEl.value;
    setActiveStudent(next);
    loadProgress();
  };
}

function updateSessionDate() {
  if (!sessionDateEl) return;
  const now = new Date();
  sessionDateEl.innerText = now.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDuration(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function humanizeErrorType(code) {
  const str = (code || "").toString().trim();
  if (!str) return "";
  return str
    .split("_")
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (upper === "LCM" || upper === "GCF" || upper === "GCD") return upper;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function humanizeTopicName(topic) {
  const str = (topic || "").toString().trim();
  if (!str) return "General";
  return str
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function accuracyColorClass(accuracy) {
  const a = Number(accuracy) || 0;
  if (a < 65) return "red";
  if (a <= 84) return "orange";
  return "green";
}

function accuracyStatus(accuracy) {
  const a = Number(accuracy) || 0;
  if (a >= 85) return { color: "green", label: "Mastered (85%+)" };
  if (a >= 65) return { color: "orange", label: "Developing (65-84%)" };
  return { color: "red", label: "Needs Practice (<65%)" };
}

function progressBar(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const blocks = Math.round(p / 10);
  return "▓".repeat(blocks) + "░".repeat(10 - blocks);
}

function formatPercent2(value) {
  const n = Number(value) || 0;
  return `${n.toFixed(2)}%`;
}

function difficultyLabel(level) {
  const d = normalizeDifficulty(level);
  if (d === "medium") return "Medium";
  if (d === "hard") return "Hard";
  return "Easy";
}

function buildDifficultyRecommendationMessage(rec = {}) {
  const current = normalizeDifficulty(rec.currentDifficulty || "easy");
  const next = normalizeDifficulty(rec.recommendedDifficulty || current);
  const accuracy = Number(rec.accuracy) || 0;
  const attempted = Number(rec.attempted) || 0;
  const levelOrder = { easy: 1, medium: 2, hard: 3 };

  if (attempted < 10) {
    return `<span class="small">Need at least 10 graded answers before level changes. Current evidence: ${attempted} answer${attempted === 1 ? "" : "s"} at ${formatPercent2(accuracy)}.</span>`;
  }

  if (next !== current) {
    const isUp = (levelOrder[next] || 0) > (levelOrder[current] || 0);
    return `<span class="${isUp ? "good" : "bad"}">Leveling ${isUp ? "up" : "down"} next set: ${difficultyLabel(current)} → ${difficultyLabel(next)} (10-answer accuracy: ${formatPercent2(accuracy)})</span>`;
  }

  if (accuracy < 50) {
    return `<span class="bad">Keeping next set at ${difficultyLabel(next)} for reinforcement (10-answer accuracy: ${formatPercent2(accuracy)})</span>`;
  }

  return `<span class="small">Next set stays at ${difficultyLabel(next)} (10-answer accuracy: ${formatPercent2(accuracy)})</span>`;
}

function startSessionTimer() {
  if (!sessionDurationEl) return;
  const startedAt = Date.now();
  const tick = () => {
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    sessionDurationEl.innerText = formatDuration(elapsed);
  };
  tick();
  setInterval(tick, 1000);
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark", isDark);
  if (themeToggleBtn) themeToggleBtn.innerText = isDark ? "🌙 Dark" : "🌞 Light";
  localStorage.setItem("plc_theme", isDark ? "dark" : "light");
}

function closeProfileMenu() {
  if (profileMenu) profileMenu.classList.remove("open");
}

function closeNotificationMenu() {
  if (notificationMenu) notificationMenu.classList.remove("open");
}

function mapPracticeTypeToTopic(practiceType) {
  const t = (practiceType || "").toString().trim().toLowerCase();
  if (t === "simplify_fractions") return "simplify_fraction";
  if (t === "algebra_substitution_practice") return "algebra_substitution";
  if (t === "algebra_one_step_practice") return "algebra_one_step";
  if (t === "algebra_exponents_practice") return "algebra_exponents";
  return "fractions_add";
}

function normalizeDifficulty(level) {
  const d = (level || "").toString().trim().toLowerCase();
  if (d === "medium") return "medium";
  if (d === "hard") return "hard";
  return "easy";
}

function toTopicKey(topic = "") {
  return (topic || "general").toString().trim().toLowerCase() || "general";
}

function toSkillKey(topic = "", fallback = "") {
  const t = toTopicKey(topic);
  const f = (fallback || "").toString().trim().toLowerCase();
  return f || t;
}

function pickTopErrorFromCounts(counts = {}) {
  const entries = Object.entries(counts || {}).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
  return entries[0]?.[0] || null;
}

function sumHintsUsedFromQuestionState(state = {}) {
  return Object.values(state || {}).reduce((sum, q) => {
    const used = Math.max(0, (Number(q?.nextHintLevel) || 1) - 1);
    return sum + used;
  }, 0);
}

function sumTimeSecondsFromTimingMap(timingByQuestion = {}) {
  const msTotal = Object.values(timingByQuestion || {}).reduce((sum, ms) => sum + (Number(ms) || 0), 0);
  return Math.max(0, Math.round(msTotal / 1000));
}

function getModeForCurrentHomeworkSession() {
  return isTargetedPractice ? "targeted_practice" : "homework";
}

function emptyProgressShape(studentId = "") {
  return {
    studentId: studentId || "",
    totals: {
      attempts: 0,
      correct: 0,
      incorrect: 0,
      accuracy: 0,
      averageTimePerProblemSec: 0,
    },
    byTopic: {},
    byMode: {},
    errorTypeByTopic: {},
    weakTopics: [],
    recentEvents: [],
  };
}

function normalizeProgressShape(raw, studentId = "") {
  const base = emptyProgressShape(studentId);
  const src = raw && typeof raw === "object" ? raw : {};
  const totals = src.totals && typeof src.totals === "object" ? src.totals : {};
  return {
    ...base,
    ...src,
    totals: {
      ...base.totals,
      ...totals,
    },
    byTopic: src.byTopic && typeof src.byTopic === "object" ? src.byTopic : {},
    byMode: src.byMode && typeof src.byMode === "object" ? src.byMode : {},
    errorTypeByTopic: src.errorTypeByTopic && typeof src.errorTypeByTopic === "object" ? src.errorTypeByTopic : {},
    weakTopics: Array.isArray(src.weakTopics) ? src.weakTopics : [],
    recentEvents: Array.isArray(src.recentEvents) ? src.recentEvents : [],
  };
}

function getLocalProgressKey(studentId = "") {
  return `plc_progress_fallback_${(studentId || "anonymous").toString().trim().toLowerCase()}`;
}

function loadLocalProgressFallback(studentId = "") {
  try {
    const key = getLocalProgressKey(studentId);
    const raw = localStorage.getItem(key);
    if (!raw) return emptyProgressShape(studentId);
    const parsed = JSON.parse(raw);
    return normalizeProgressShape(parsed, studentId);
  } catch {
    return emptyProgressShape(studentId);
  }
}

function saveLocalProgressFallback(studentId = "", progress = null) {
  try {
    const key = getLocalProgressKey(studentId);
    localStorage.setItem(key, JSON.stringify(normalizeProgressShape(progress, studentId)));
  } catch {
    // no-op fallback
  }
}

function applySessionToLocalProgress({
  studentId = "",
  mode = "homework",
  topicKey = "general",
  attempts = 0,
  correct = 0,
  incorrect = 0,
  timeSpentSeconds = 0,
  errorType = null,
  difficulty = "easy",
  hintsUsed = 0,
  metadata = {},
}) {
  const progress = loadLocalProgressFallback(studentId);
  const tKey = toTopicKey(topicKey);
  if (!progress.byTopic[tKey]) {
    progress.byTopic[tKey] = { attempts: 0, correct: 0, incorrect: 0, accuracy: 0 };
  }
  if (!progress.byMode[mode]) {
    progress.byMode[mode] = { attempts: 0, correct: 0, incorrect: 0, accuracy: 0 };
  }

  progress.totals.attempts += Number(attempts) || 0;
  progress.totals.correct += Number(correct) || 0;
  progress.totals.incorrect += Number(incorrect) || 0;
  if (timeSpentSeconds > 0) {
    const existingAttempts = Number(progress.totals.attempts) || 0;
    const currentAvg = Number(progress.totals.averageTimePerProblemSec) || 0;
    const prevTotal = Math.max(0, (existingAttempts - (Number(attempts) || 0)) * currentAvg);
    const nextTotal = prevTotal + Number(timeSpentSeconds);
    progress.totals.averageTimePerProblemSec = existingAttempts > 0 ? Math.round(nextTotal / existingAttempts) : 0;
  }
  progress.totals.accuracy = progress.totals.attempts > 0
    ? Number(((progress.totals.correct / progress.totals.attempts) * 100).toFixed(2))
    : 0;

  const topic = progress.byTopic[tKey];
  topic.attempts += Number(attempts) || 0;
  topic.correct += Number(correct) || 0;
  topic.incorrect += Number(incorrect) || 0;
  topic.accuracy = topic.attempts > 0 ? Number(((topic.correct / topic.attempts) * 100).toFixed(2)) : 0;

  const modeRow = progress.byMode[mode];
  modeRow.attempts += Number(attempts) || 0;
  modeRow.correct += Number(correct) || 0;
  modeRow.incorrect += Number(incorrect) || 0;
  modeRow.accuracy = modeRow.attempts > 0 ? Number(((modeRow.correct / modeRow.attempts) * 100).toFixed(2)) : 0;

  if (errorType) {
    if (!progress.errorTypeByTopic[tKey]) progress.errorTypeByTopic[tKey] = {};
    progress.errorTypeByTopic[tKey][errorType] = (progress.errorTypeByTopic[tKey][errorType] || 0) + 1;
  }

  progress.recentEvents.unshift({
    ts: new Date().toISOString(),
    mode,
    topic: tKey,
    isCorrect: Number(incorrect) === 0,
    meta: {
      difficulty,
      timeSpentMs: Number(timeSpentSeconds || 0) * 1000,
      hintsUsed: Number(hintsUsed) || 0,
      metadata: metadata || {},
    },
  });
  progress.recentEvents = progress.recentEvents.slice(0, 30);

  const weakRows = Object.entries(progress.byTopic)
    .filter(([, v]) => (Number(v.attempts) || 0) >= 3 && (Number(v.incorrect) || 0) >= 2 && (Number(v.accuracy) || 0) < 85)
    .sort((a, b) => (Number(a[1].accuracy) || 0) - (Number(b[1].accuracy) || 0))
    .slice(0, 3)
    .map(([topicName, row]) => ({ topic: topicName, ...row }));
  progress.weakTopics = weakRows;

  saveLocalProgressFallback(studentId, progress);
  return progress;
}

function buildAdaptivePlanFromProgress(progress) {
  const p = normalizeProgressShape(progress);
  const totals = p.totals || {};
  const attempts = Number(totals.attempts) || 0;
  const accuracy = Number(totals.accuracy) || 0;
  if (!attempts) {
    return {
      ok: true,
      recommendedPractice: false,
      practiceType: "confidence_building_set",
      recommendedTopic: "fractions_add",
      difficulty: "easy",
      nextDifficulty: "easy",
      problems: [],
      analytics: { dominantErrorTypes: [] },
    };
  }

  const mergedErrors = {};
  for (const topicCounts of Object.values(p.errorTypeByTopic || {})) {
    for (const [err, count] of Object.entries(topicCounts || {})) {
      mergedErrors[err] = (mergedErrors[err] || 0) + (Number(count) || 0);
    }
  }
  const dominantError = pickTopErrorFromCounts(mergedErrors) || "UNANSWERED";
  const mapped = mapDominantErrorToUiPlan(dominantError);
  const dominantFrequency = Number(mergedErrors[dominantError]) || 0;
  const recommendedDifficulty = accuracy < 50 ? "easy" : normalizeDifficulty(mapped.difficulty || "easy");
  return {
    ok: true,
    recommendedPractice: accuracy < 85,
    practiceType: dominantError.toLowerCase(),
    recommendedTopic: mapped.topic,
    difficulty: recommendedDifficulty,
    nextDifficulty: recommendedDifficulty,
    problems: new Array(5).fill({}),
    analytics: {
      dominantErrorTypes: [{ errorType: dominantError, frequency: dominantFrequency }],
    },
  };
}

async function persistHomeworkSessionToSupabase({
  studentId = "",
  topic = "",
  difficulty = "easy",
  summary = {},
  errorCounts = {},
  timingByQuestion = {},
  hintsUsed = 0,
  isTargeted = false,
}) {
  if (!isUuidLike(studentId)) return { ok: false, skipped: true, reason: "non_uuid_student_id" };

  const attempts = Number(summary.total) || 0;
  const correct = Number(summary.correct) || 0;
  const incorrect = Number(summary.incorrect) || 0;
  const topicKey = toTopicKey(topic);
  const skillKey = toSkillKey(topicKey, practiceMeta?.skillName || "");
  const topError = pickTopErrorFromCounts(errorCounts || summary.mistakeBreakdown || {});
  const timeSpentSeconds = sumTimeSecondsFromTimingMap(timingByQuestion);
  const mode = isTargeted ? "targeted_practice" : "homework";

  const [activityResult, skillResult] = await Promise.all([
    logActivity({
      studentId,
      mode,
      topicKey,
      skillKey,
      difficulty: normalizeDifficulty(difficulty),
      result: incorrect === 0 ? "correct" : "incorrect",
      errorType: topError,
      timeSpentSeconds,
      hintsUsed,
      metadata: {
        sessionType: mode,
        attempts,
        correct,
        incorrect,
        mistakeBreakdown: summary.mistakeBreakdown || {},
      },
    }),
    upsertSkillProgress({
      studentId,
      topicKey,
      skillKey,
      attemptsDelta: attempts,
      correctDelta: correct,
      incorrectDelta: incorrect,
      hintsUsedDelta: hintsUsed,
      lastErrorType: topError,
    }),
  ]);

  if (!activityResult?.ok) console.error("[progress] activity write failed", activityResult?.error || activityResult);
  if (!skillResult?.ok) console.error("[progress] skill_progress upsert failed", skillResult?.error || skillResult);
  return { ok: !!(activityResult?.ok && skillResult?.ok), activityResult, skillResult };
}

async function persistGuidedCompletionToSupabase({
  studentId = "",
  topic = "fractions_add",
  difficulty = "easy",
  isCorrect = true,
  hintsUsed = 0,
  metadata = {},
}) {
  if (!isUuidLike(studentId)) return { ok: false, skipped: true, reason: "non_uuid_student_id" };
  const topicKey = toTopicKey(topic);
  const skillKey = toSkillKey(topicKey);
  const incorrectDelta = isCorrect ? 0 : 1;
  const correctDelta = isCorrect ? 1 : 0;
  const errorType = isCorrect ? null : "GUIDED_STEP_ERROR";

  const [activityResult, skillResult] = await Promise.all([
    logActivity({
      studentId,
      mode: "guided",
      topicKey,
      skillKey,
      difficulty: normalizeDifficulty(difficulty),
      result: isCorrect ? "correct" : "incorrect",
      errorType,
      timeSpentSeconds: 0,
      hintsUsed,
      metadata,
    }),
    upsertSkillProgress({
      studentId,
      topicKey,
      skillKey,
      attemptsDelta: 1,
      correctDelta,
      incorrectDelta,
      hintsUsedDelta: hintsUsed,
      lastErrorType: errorType,
    }),
  ]);

  if (!activityResult?.ok) console.error("[progress] guided activity write failed", activityResult?.error || activityResult);
  if (!skillResult?.ok) console.error("[progress] guided skill upsert failed", skillResult?.error || skillResult);
  return { ok: !!(activityResult?.ok && skillResult?.ok), activityResult, skillResult };
}

function bumpDifficultyOneLevel(level) {
  const d = normalizeDifficulty(level);
  if (d === "easy") return "medium";
  if (d === "medium") return "hard";
  return "hard";
}

function getRecommendedDifficulty(currentDifficulty, accuracy, attemptedCount = 0) {
  const current = normalizeDifficulty(currentDifficulty);
  const attempts = Number(attemptedCount) || 0;
  if (attempts < 10) return current;
  const a = Number(accuracy) || 0;
  if (a < 50) return "easy";
  if (a < 85) return current;
  return bumpDifficultyOneLevel(current);
}

function aggregateErrorCountsFromResults(results = []) {
  const counts = {};
  for (const row of results || []) {
    if (!row || row.isCorrect) continue;
    const key = (row.errorType || "ARITHMETIC_ERROR").toString().trim().toUpperCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function computeSetAccuracyForDifficulty(results = []) {
  // Chosen rule: exclude unanswered from denominator.
  const rows = Array.isArray(results) ? results : [];
  let attempted = 0;
  let correct = 0;
  let unanswered = 0;

  for (const row of rows) {
    const answer = (row?.userAnswer || "").toString().trim();
    if (!answer) {
      unanswered += 1;
      continue;
    }
    attempted += 1;
    if (row?.isCorrect) correct += 1;
  }

  const accuracy = attempted > 0 ? (correct / attempted) * 100 : 0;
  return {
    accuracy,
    attempted,
    correct,
    unanswered,
  };
}

function buildTenAnswerEvidenceFromProgress(progressData, fallbackSetStats, currentTopic = "") {
  const fallback = {
    accuracy: Number(fallbackSetStats?.accuracy) || 0,
    attempted: Number(fallbackSetStats?.attempted) || 0,
    correct: Number(fallbackSetStats?.correct) || 0,
    source: "current_set",
    topic: currentTopic || "",
  };

  const byTopic = progressData?.byTopic || {};
  const recentEvents = Array.isArray(progressData?.recentEvents) ? progressData.recentEvents : [];
  const topicKey = (currentTopic || "").toString().trim().toLowerCase();

  // Primary rule: true rolling 10 graded answers (homework mode only) for current topic.
  const recentTopicRows = recentEvents
    .filter((evt) => {
      const mode = (evt?.mode || "").toString().trim().toLowerCase();
      const topic = (evt?.topic || "").toString().trim().toLowerCase();
      return mode === "homework" && topic === topicKey;
    })
    .slice(0, 10);

  if (recentTopicRows.length > 0) {
    const attempted = recentTopicRows.length;
    const correct = recentTopicRows.filter((evt) => !!evt?.isCorrect).length;
    return {
      accuracy: (correct / attempted) * 100,
      attempted,
      correct,
      source: "progress_recent10_topic",
      topic: topicKey,
    };
  }

  const currentTopicRow = topicKey ? byTopic[topicKey] : null;

  // Primary rule: use current topic performance window.
  if (currentTopicRow && (Number(currentTopicRow.attempts) || 0) > 0) {
    const attempted = Number(currentTopicRow.attempts) || 0;
    const correct = Number(currentTopicRow.correct) || 0;
    return {
      accuracy: (correct / attempted) * 100,
      attempted,
      correct,
      source: "progress_current_topic",
      topic: topicKey,
    };
  }

  // Fallback: aggregate across progress topic stats.
  let attempted = 0;
  let correct = 0;
  for (const row of Object.values(byTopic)) {
    attempted += Number(row?.attempts) || 0;
    correct += Number(row?.correct) || 0;
  }

  const effectiveAttempts = attempted;
  if (effectiveAttempts <= 0) return fallback;
  const effectiveCorrect = correct;
  return {
    accuracy: (effectiveCorrect / effectiveAttempts) * 100,
    attempted: effectiveAttempts,
    correct: effectiveCorrect,
    source: "progress_all_topics",
    topic: topicKey,
  };
}

function mapDominantErrorToUiPlan(errorType = "") {
  const e = (errorType || "").toString().trim().toUpperCase();
  if (e === "LCM_ERROR") {
    return {
      topic: "fractions_add",
      difficulty: latestDifficultyRecommendation.recommendedDifficulty || "easy",
      count: 5,
      reason: "Let's practice finding least common denominators.",
    };
  }
  if (e === "SIMPLIFICATION_ERROR") {
    return {
      topic: "simplify_fraction",
      difficulty: latestDifficultyRecommendation.recommendedDifficulty || "easy",
      count: 5,
      reason: "Let's practice simplifying fractions step-by-step.",
    };
  }
  if (e === "ADDITION_ERROR") {
    return {
      topic: "fractions_add",
      difficulty: latestDifficultyRecommendation.recommendedDifficulty || "easy",
      count: 5,
      reason: "Let's practice adding converted numerators carefully.",
    };
  }
  if (e === "OPERATION_ERROR") {
    return {
      topic: "fractions_add",
      difficulty: latestDifficultyRecommendation.recommendedDifficulty || "easy",
      count: 5,
      reason: "Let's reinforce choosing the correct operation.",
    };
  }
  if (e === "UNANSWERED") {
    return {
      topic: "fractions_add",
      difficulty: latestDifficultyRecommendation.recommendedDifficulty || "easy",
      count: 5,
      reason: "Let's build confidence with easier practice first.",
    };
  }
  return {
    topic: (homeworkState?.topic || "fractions_add"),
    difficulty: latestDifficultyRecommendation.recommendedDifficulty || "easy",
    count: 5,
    reason: "Let's reinforce the recent weak step.",
  };
}

function formatErrorCountLines(counts = {}) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "No error types detected.";
  return entries
    .map(([errorType, count]) => `${count} ${humanizeErrorType(errorType)}`)
    .join(" • ");
}

function hasErrorCounts(counts = {}) {
  return Object.keys(counts || {}).length > 0;
}

function applyPracticeControlLock() {
  const lock = !!isTargetedPractice;
  if (hwGrade) hwGrade.disabled = lock;
  if (hwTopic) hwTopic.disabled = lock;
  if (hwDifficulty) hwDifficulty.disabled = lock;
  if (hwCount) hwCount.disabled = lock;
  if (generateBtn) generateBtn.disabled = lock;
}

function renderPracticeBanner() {
  if (!practiceBannerEl || !practiceBannerTextEl) return;
  if (!isTargetedPractice) {
    practiceBannerEl.style.display = "none";
    return;
  }
  const skill = practiceMeta.skillName || humanizeErrorType(practiceMeta.reason) || "Focused Skill";
  const topic = humanizeTopicName(practiceMeta.lockedTopic || hwTopic?.value || "fractions_add");
  const diff = humanizeTopicName(practiceMeta.lockedDifficulty || hwDifficulty?.value || "easy");
  practiceBannerTextEl.innerHTML = `<b>Targeted Practice:</b> ${skill} <span class="small">(${topic}, ${diff})</span>`;
  practiceBannerEl.style.display = "flex";
}

function setTargetedPracticeMode(enabled, meta = {}) {
  isTargetedPractice = !!enabled;
  if (isTargetedPractice) {
    practiceMeta = {
      reason: (meta.reason || "").toString(),
      lockedTopic: (meta.lockedTopic || "").toString(),
      lockedDifficulty: (meta.lockedDifficulty || "").toString(),
      skillName: (meta.skillName || "").toString(),
    };
  } else {
    practiceMeta = {
      reason: "",
      lockedTopic: "",
      lockedDifficulty: "",
      skillName: "",
    };
  }
  applyPracticeControlLock();
  renderPracticeBanner();
}

function renderRecommendedPractice(plan) {
  if (!recommendedPracticeBoxEl) return;
  if (!plan || !plan.recommendedPractice) {
    const totalAttempts = Number(progressSummaryEl?.querySelector(".stat-attempts .metric-value")?.textContent || 0);
    recommendedPracticeBoxEl.innerHTML =
      totalAttempts > 0
        ? "Recommendation is not available right now. Refresh progress after your next graded set."
        : "No recommendation yet. Complete a homework set to unlock targeted practice.";
    return;
  }

  const practiceType = (plan.practiceType || "").toString();
  const recommendedTopic = (plan.recommendedTopic || mapPracticeTypeToTopic(practiceType)).toString();
  const nextDifficulty = (plan.nextDifficulty || plan.difficulty || "easy").toString();
  const problemCount = Array.isArray(plan.problems) ? plan.problems.length : 5;

  recommendedPracticeBoxEl.innerHTML = `
    <div><b>Topic:</b> ${humanizeTopicName(recommendedTopic)}</div>
    <div><b>Difficulty:</b> ${humanizeTopicName(nextDifficulty)}</div>
    <div><b>Problems:</b> ${problemCount}</div>
    <button id="startTargetedPracticeBtn" class="primary" style="margin-top:8px;">Start Targeted Practice</button>
  `;

  const btn = document.getElementById("startTargetedPracticeBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerText = "Loading...";
      try {
        const topError = plan.analytics?.dominantErrorTypes?.[0]?.errorType || "UNANSWERED";
        const sourceTopic = plan.recommendedTopic || mapPracticeTypeToTopic(plan.practiceType);
        const res = await fetch(tutorEndpoint(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "targeted_practice_generate",
            studentId: getCurrentStudentId(),
            sourceState: {
              grade: 4,
              topic: sourceTopic,
              difficulty: nextDifficulty,
            },
            latestMistakeBreakdown: { [topError]: 1 },
            count: 5,
          }),
        });
        const data = await parseApiResponse(res);
        if (!data?.ok) {
          logApiError("targeted_practice_generate", data);
          throw new Error(readApiError(data, "Failed to start targeted practice."));
        }

        homeworkState = data.state || {};
        setTargetedPracticeMode(true, {
          reason: data.targeted?.reason || "",
          lockedTopic: data.targeted?.recommendedTopic || sourceTopic,
          lockedDifficulty: data.targeted?.recommendedDifficulty || nextDifficulty,
          skillName: humanizeTopicName(plan.practiceType || ""),
        });
        renderProblems((data.homework && Array.isArray(data.homework.problems)) ? data.homework.problems : (data.problems || []));
        if (targetedPracticeBox) {
          targetedPracticeBox.innerHTML = `<span class="small">Loaded targeted practice: <b>${humanizeTopicName(practiceType)}</b> (${humanizeTopicName(nextDifficulty)}).</span>`;
        }
        setMode("homework");
      } catch (err) {
        alert(err.message || "Failed to start targeted practice.");
      } finally {
        btn.disabled = false;
        btn.innerText = "Start Targeted Practice";
      }
    });
  }
}

function renderProgress(progress) {
  if (!progress) return;
  const t = progress.totals || {};
  if (progressSummaryEl) {
    const acc = t.accuracy ?? 0;
    const accClass = accuracyColorClass(acc);
    const status = accuracyStatus(acc);
    progressSummaryEl.innerHTML = `
      <div class="stat-card stat-attempts"><b>Attempts</b><div class="metric-value">${t.attempts ?? 0}</div></div>
      <div class="stat-card stat-correct"><b>Correct</b><div class="metric-value">${t.correct ?? 0}</div></div>
      <div class="stat-card stat-incorrect"><b>Incorrect</b><div class="metric-value">${t.incorrect ?? 0}</div></div>
      <div class="stat-card">
        <b class="text-${accClass}">Accuracy</b>
        <div class="metric-row">
          <span class="dot ${accClass}"></span>
          <div class="metric-value ${accClass}">${formatPercent2(acc)}</div>
        </div>
        <div class="small text-green">🟢 Mastered (85%+)</div>
        <div class="small text-orange">🟡 Developing (65-84%)</div>
        <div class="small text-red">🔴 Needs Practice (&lt;65%)</div>
      </div>
    `;
  }
  if (progressHeadlineEl) {
    const acc = t.accuracy ?? 0;
    const status = accuracyStatus(acc);
    const avgSec = t.averageTimePerProblemSec ?? 0;
    let pace = "Pace Insight: Building baseline.";
    if (acc < 65 && avgSec >= 90) pace = "Pace Insight: Confusion likely (high time + low accuracy).";
    else if (acc < 65 && avgSec > 0 && avgSec <= 30) pace = "Pace Insight: Rushing likely (low time + low accuracy).";
    else if (avgSec > 0) pace = "Pace Insight: Pace looks stable.";

    progressHeadlineEl.innerHTML =
      `<b class="text-${status.color}">Student got ${formatPercent2(acc)}</b><br/>` +
      `<span class="text-${status.color}">${status.label}</span><br/>` +
      `<span>Average time per problem: <b>${avgSec || 0}s</b></span><br/>` +
      `<span>${pace}</span>`;
  }

  const byTopicErrors = progress.errorTypeByTopic || {};
  const topicErrorRows = Object.entries(byTopicErrors)
    .map(([topic, counts]) => {
      const entries = Object.entries(counts || {})
        .filter(([, count]) => (Number(count) || 0) > 0)
        .sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
      return { topic, entries, total };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  if (errorTypeStatsEl) {
    errorTypeStatsEl.innerHTML = topicErrorRows.length
      ? topicErrorRows
          .map((topicRow) => {
            const topicTitle = humanizeTopicName(topicRow.topic);
            const lines = topicRow.entries
              .map(([type, count]) => {
                const p = topicRow.total ? Math.round((count / topicRow.total) * 100) : 0;
                return `
                  <div class="error-row">
                    <div class="error-label">${humanizeErrorType(type)} — ${count} (${p}%)</div>
                    <div class="error-track">
                      <div class="error-fill" style="width:${p}%;"></div>
                    </div>
                  </div>
                `;
              })
              .join("");

            return `
              <div style="margin-bottom:14px;">
                <div class="error-label" style="margin-bottom:6px;"><b>${topicTitle}</b> (${topicRow.total})</div>
                ${lines}
              </div>
            `;
          })
          .join("")
      : "No error patterns yet.";
  }

  const weak = Array.isArray(progress.weakTopics) ? progress.weakTopics : [];
  const byTopic = progress.byTopic || {};
  const topics = Object.entries(byTopic);
  if (weakTopicsListEl) {
    if (topics.length < 2) {
      weakTopicsListEl.innerHTML = "Weak topic comparison appears after activity in at least 2 topics.";
    } else {
      weakTopicsListEl.innerHTML = weak.length
        ? weak
            .map((w) => `${humanizeTopicName(w.topic)}: ${formatPercent2(w.accuracy)} (${w.correct}/${w.attempts})`)
            .join("<br/>")
        : "No weak topics right now.";
    }
  }
  if (topicStatsEl) {
    topicStatsEl.innerHTML = topics.length
      ? topics
          .map(([topic, s]) => `${humanizeTopicName(topic)}: ${formatPercent2(s.accuracy)} (${s.correct}/${s.attempts})`)
          .join("<br/>")
      : "No topic attempts yet.";
  }

  const events = Array.isArray(progress.recentEvents) ? progress.recentEvents : [];
  if (recentActivityEl) {
    recentActivityEl.innerHTML = events.length
      ? events
          .slice(0, 8)
          .map((e) => `${new Date(e.ts).toLocaleString()} - ${humanizeTopicName(e.mode)} / ${humanizeTopicName(e.topic)} - ${e.isCorrect ? "Correct" : "Incorrect"}`)
          .join("<br/>")
      : "No activity yet.";
  }
}

async function loadProgress() {
  const studentId = getCurrentStudentId();
  let progress = null;

  if (isUuidLike(studentId)) {
    progress = await fetchStudentProgressFromSupabase(studentId);
    if (!progress) {
      const fallbackProgress = loadLocalProgressFallback(studentId);
      progress = fallbackProgress && (fallbackProgress.totals?.attempts || 0) > 0 ? fallbackProgress : null;
    }
  }

  if (!progress) {
    const progressRes = await fetch(tutorEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "progress_summary",
        studentId,
      }),
    });
    const progressData = await parseApiResponse(progressRes);
    if (progressData?.ok) {
      progress = normalizeProgressShape(progressData.progress || {}, studentId);
      if (isUuidLike(studentId)) saveLocalProgressFallback(studentId, progress);
    } else {
      logApiError("progress_summary", progressData);
      progress = normalizeProgressShape(loadLocalProgressFallback(studentId), studentId);
    }
  } else {
    progress = normalizeProgressShape(progress, studentId);
  }

  renderProgress(progress || emptyProgressShape(studentId));
  latestAdaptivePlan = buildAdaptivePlanFromProgress(progress || emptyProgressShape(studentId));
  renderRecommendedPractice(latestAdaptivePlan);
}

function renderProblems(problemList) {
  problemsContainer.innerHTML = "";
  scoreContainer.innerHTML = "";
  if (targetedPracticeBox) targetedPracticeBox.innerHTML = "";
  homeworkQuestionState = {};

  for (const p of problemList) {
    homeworkQuestionState[p.id] = {
      tries: 0,
      revealed: false,
      revealOverride: false,
      startedAtMs: Date.now(),
      nextHintLevel: 1,
    };
    const expectedKind = p?.expected?.kind || p?.expected?.displayKind || "";
    const isNumberAnswer = expectedKind === "number" || p?.type?.startsWith?.("algebra_");
    const inputPlaceholder = isNumberAnswer ? "Answer (integer example: 14)" : "Answer (examples: 7/12 or 2 1/3)";
    const div = document.createElement("div");
    div.className = "problem";
    div.innerHTML = `
      <div><b>Q${p.id}.</b> ${p.question}</div>
      <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
        <input
          id="ans_${p.id}"
          name="hw_answer_${Date.now()}_${p.id}"
          placeholder="${inputPlaceholder}"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <button id="reveal_${p.id}" type="button">Reveal Answer</button>
      </div>
      <div id="res_${p.id}" class="result"></div>
    `;
    problemsContainer.appendChild(div);

    const revealBtn = document.getElementById(`reveal_${p.id}`);
    if (revealBtn) {
      revealBtn.addEventListener("click", () => {
        const resEl = document.getElementById(`res_${p.id}`);
        if (!resEl || !homeworkState?.problems) return;
        const qState = homeworkQuestionState[p.id] || { tries: 0, revealOverride: false };
        if (isTargetedPractice && !qState.revealOverride && qState.tries < 2) {
          const ok = confirm("This is targeted practice. You can reveal now, but try at least 2 attempts first. Reveal anyway?");
          if (!ok) {
            resEl.innerHTML = `<span class="small">Make at least 2 attempts first, or confirm reveal to continue.</span>`;
            return;
          }
          qState.revealOverride = true;
          homeworkQuestionState[p.id] = qState;
        }
        const full = homeworkState.problems.find((x) => x.id === p.id);
        if (!full?.expected) return;
        const correct = formatCorrectFromExpected(full.expected);
        homeworkQuestionState[p.id].revealed = true;
        resEl.innerHTML = `<span class="small"><b>Answer:</b> ${correct}</span>`;
      });
    }
  }
}

function formatCorrectFromExpected(expected) {
  if (expected?.kind === "number" || Number.isFinite(expected?.value)) {
    return String(Number(expected.value));
  }
  if (!expected?.rational) return "";
  const r = expected.rational;
  if (expected.displayKind === "mixed") {
    const w = Math.floor(r.num / r.den);
    const rem = r.num % r.den;
    if (rem === 0) return String(w);
    if (w === 0) return `${rem}/${r.den}`;
    return `${w} ${rem}/${r.den}`;
  }
  return `${r.num}/${r.den}`;
}

function renderHintButtons(problemId, nextHintLevel = 1) {
  const level = Math.max(1, Math.min(4, Number(nextHintLevel) || 1));
  const hasNextHint = level <= 3;
  const prompt = level === 1 ? "Would you like a hint?" : "Would you like another hint?";

  return `
    <div id="hintControls_${problemId}" class="small" style="margin-top:6px;">
      ${prompt}
      ${hasNextHint
        ? `<button id="hintNext_${problemId}" type="button" style="margin-left:6px;">Hint ${level}</button>`
        : `<span style="margin-left:6px;">All 3 hints used.</span>`}
    </div>
    <div id="hint_${problemId}" class="small" style="margin-top:6px;"></div>
  `;
}

function getProblemStateById(problemId) {
  if (!homeworkState?.problems || !Array.isArray(homeworkState.problems)) return null;
  return homeworkState.problems.find((p) => String(p.id) === String(problemId)) || null;
}

async function requestHint(problemId, hintLevel) {
  const hintEl = document.getElementById(`hint_${problemId}`);
  if (hintEl) hintEl.innerHTML = "Loading hint...";

  const problem = getProblemStateById(problemId);
  const answerEl = document.getElementById(`ans_${problemId}`);
  const studentAnswer = answerEl ? answerEl.value.trim() : "";

  try {
    const res = await fetch(tutorEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "hint",
        studentId: getCurrentStudentId(),
        topic: homeworkState?.topic || "",
        problem: problem || {},
        studentAnswer,
        hintLevel,
        meta: {
          difficulty: homeworkState?.difficulty || hwDifficulty?.value || "easy",
          questionId: problemId,
        },
      }),
    });
    const data = await parseApiResponse(res);
    if (!data?.ok) logApiError("hint", data);
    const text = (data && data.hintText) ? data.hintText : "Try checking your previous step first.";
    if (hintEl) hintEl.innerHTML = `<b>Hint ${hintLevel}:</b> ${text}`;

    const qState = homeworkQuestionState[problemId] || {};
    qState.nextHintLevel = Math.max((qState.nextHintLevel || 1), hintLevel + 1);
    homeworkQuestionState[problemId] = qState;

    const controlsEl = document.getElementById(`hintControls_${problemId}`);
    if (controlsEl) {
      if (qState.nextHintLevel <= 3) {
        controlsEl.innerHTML =
          `Would you like another hint?` +
          `<button id="hintNext_${problemId}" type="button" style="margin-left:6px;">Hint ${qState.nextHintLevel}</button>`;
      } else {
        controlsEl.innerHTML = "All 3 hints used.";
      }
    }
    attachHintHandlers(problemId, qState.nextHintLevel);
  } catch {
    if (hintEl) hintEl.innerHTML = "Could not load hint right now. Try again.";
  }
}

function attachHintHandlers(problemId, nextHintLevel = 1) {
  const btn = document.getElementById(`hintNext_${problemId}`);
  if (!btn) return;
  const level = Math.max(1, Math.min(3, Number(nextHintLevel) || 1));
  btn.addEventListener("click", () => requestHint(problemId, level));
}

async function generateHomework() {
  setTargetedPracticeMode(false);
  const grade = hwGrade.value;
  const topic = hwTopic.value;
  const difficulty = hwDifficulty.value;
  const count = hwCount.value;

  const res = await fetch(tutorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "homework_generate",
      studentId: getCurrentStudentId(),
      grade,
      topic,
      difficulty,
      count,
    }),
  });

  const data = await parseApiResponse(res);

  if (!data?.ok) {
    logApiError("homework_generate", data);
    scoreContainer.innerHTML = `<span class="bad">Error:</span> ${readApiError(data, "Failed to generate")}`;
    return;
  }

  homeworkState = data.state || {};
  setTargetedPracticeMode(false);
  renderProblems((data.homework && Array.isArray(data.homework.problems)) ? data.homework.problems : (data.problems || []));
}

async function gradeHomework() {
  if (!homeworkState) {
    scoreContainer.innerHTML = `<span class="bad">Generate homework first.</span>`;
    return;
  }

  const studentAnswers = {};
  const timingByQuestion = {};
  const nowMs = Date.now();
  for (const p of homeworkState.problems) {
    const inp = document.getElementById(`ans_${p.id}`);
    studentAnswers[p.id] = inp ? inp.value.trim() : "";
    const qState = homeworkQuestionState[p.id];
    if (qState && qState.startedAtMs && studentAnswers[p.id]) {
      timingByQuestion[p.id] = Math.max(0, nowMs - qState.startedAtMs);
    }
  }

  const res = await fetch(tutorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "homework_grade",
      studentId: getCurrentStudentId(),
      state: homeworkState,
      studentAnswers,
      timingByQuestion,
    }),
  });

  const data = await parseApiResponse(res);

  if (!data?.ok) {
    logApiError("homework_grade", data);
    scoreContainer.innerHTML = `<span class="bad">Error:</span> ${readApiError(data, "Failed to grade")}`;
    return;
  }

  const resultRows = Array.isArray(data.results) ? data.results : [];
  for (const r of resultRows) {
    const el = document.getElementById(`res_${r.id}`);
    if (!el) continue;
    const qState = homeworkQuestionState[r.id] || { tries: 0, revealed: false };
    if (!r.isCorrect && r.userAnswer) qState.tries += 1;
    homeworkQuestionState[r.id] = qState;

    if (r.isCorrect) {
      el.innerHTML = `<span class="good">✅ Correct</span>`;
    } else {
      const triesText = `<span class="small">Attempt ${Math.min(qState.tries, 3)}/3</span>`;
      const hintText = `<span class="small">${r.feedback}</span>`;
      const autoReveal = qState.tries >= 3 || qState.revealed;
      const nextHintLevel = qState.nextHintLevel || 1;
      if (autoReveal) {
        qState.revealed = true;
        el.innerHTML =
          `<span class="bad">❌ Incorrect</span> ${triesText}<br/>` +
          `${hintText}<br/>` +
          `<span class="small"><b>Answer:</b> ${r.correctAnswer}</span>` +
          renderHintButtons(r.id, nextHintLevel);
      } else {
        el.innerHTML =
          `<span class="bad">❌ Incorrect</span> ${triesText}<br/>` +
          `${hintText}<br/>` +
          `<span class="small">Try again, or click <b>Reveal Answer</b>.</span>` +
          renderHintButtons(r.id, nextHintLevel);
      }
      attachHintHandlers(r.id, nextHintLevel);
    }
  }

  const s = data.summary || { correct: 0, total: 0, scorePercent: 0, mistakeBreakdown: {} };
  latestMistakeBreakdown = s.mistakeBreakdown || {};
  latestCurrentErrorCounts = aggregateErrorCountsFromResults(resultRows);
  const hintsUsedThisSet = sumHintsUsedFromQuestionState(homeworkQuestionState);
  const setStats = computeSetAccuracyForDifficulty(resultRows);
  const currentTopicForLeveling = (homeworkState?.topic || hwTopic?.value || "").toString().trim().toLowerCase();
  const tenAnswerEvidence = buildTenAnswerEvidenceFromProgress(
    data.progress || {},
    setStats,
    currentTopicForLeveling
  );
  const currentDifficulty = homeworkState?.difficulty || hwDifficulty?.value || "easy";
  const recommendedDifficulty = getRecommendedDifficulty(
    currentDifficulty,
    tenAnswerEvidence.accuracy,
    tenAnswerEvidence.attempted
  );
  latestDifficultyRecommendation = {
    currentDifficulty: normalizeDifficulty(currentDifficulty),
    recommendedDifficulty,
    accuracy: tenAnswerEvidence.accuracy,
    attempted: tenAnswerEvidence.attempted,
    correct: tenAnswerEvidence.correct,
    unanswered: setStats.unanswered,
    evidenceSource: tenAnswerEvidence.source,
  };
  if (hwDifficulty) {
    hwDifficulty.value = recommendedDifficulty;
  }
  const difficultyMessage = buildDifficultyRecommendationMessage(latestDifficultyRecommendation);
  scoreContainer.innerHTML =
    `<b>Score:</b> ${s.correct}/${s.total} (${s.scorePercent}%)<br/>` +
    `<div class="small" style="margin-top:6px;">${difficultyMessage}</div>`;
  renderTargetedPracticeCTA(s, latestCurrentErrorCounts);

  const currentStudentId = getCurrentStudentId();
  try {
    const persistResult = await persistHomeworkSessionToSupabase({
      studentId: currentStudentId,
      topic: homeworkState?.topic || hwTopic?.value || "general",
      difficulty: homeworkState?.difficulty || hwDifficulty?.value || "easy",
      summary: s,
      errorCounts: latestCurrentErrorCounts,
      timingByQuestion,
      hintsUsed: hintsUsedThisSet,
      isTargeted: isTargetedPractice,
    });
    if (!persistResult?.ok && !persistResult?.skipped) {
      applySessionToLocalProgress({
        studentId: currentStudentId,
        mode: getModeForCurrentHomeworkSession(),
        topicKey: homeworkState?.topic || hwTopic?.value || "general",
        attempts: Number(s.total) || 0,
        correct: Number(s.correct) || 0,
        incorrect: Number(s.incorrect) || 0,
        timeSpentSeconds: sumTimeSecondsFromTimingMap(timingByQuestion),
        errorType: pickTopErrorFromCounts(latestCurrentErrorCounts),
        difficulty: homeworkState?.difficulty || hwDifficulty?.value || "easy",
        hintsUsed: hintsUsedThisSet,
        metadata: { scorePercent: Number(s.scorePercent) || 0 },
      });
    }
  } catch (err) {
    console.error("[progress] homework persistence exception", err);
    applySessionToLocalProgress({
      studentId: currentStudentId,
      mode: getModeForCurrentHomeworkSession(),
      topicKey: homeworkState?.topic || hwTopic?.value || "general",
      attempts: Number(s.total) || 0,
      correct: Number(s.correct) || 0,
      incorrect: Number(s.incorrect) || 0,
      timeSpentSeconds: sumTimeSecondsFromTimingMap(timingByQuestion),
      errorType: pickTopErrorFromCounts(latestCurrentErrorCounts),
      difficulty: homeworkState?.difficulty || hwDifficulty?.value || "easy",
      hintsUsed: hintsUsedThisSet,
      metadata: { scorePercent: Number(s.scorePercent) || 0 },
    });
  }

  if (isUuidLike(currentStudentId)) {
    await loadProgress();
  } else {
    renderProgress(normalizeProgressShape(data.progress || loadLocalProgressFallback(currentStudentId), currentStudentId));
  }
}

function renderTargetedPracticeCTA(summary, errorCounts = {}) {
  if (!targetedPracticeBox) return;
  const incorrect = summary?.incorrect || 0;
  const effectiveCounts = hasErrorCounts(errorCounts) ? errorCounts : (latestMistakeBreakdown || {});
  const topError = pickTopErrorTypeClient(effectiveCounts);

  if (incorrect <= 0) {
    targetedPracticeBox.innerHTML = `<span class="good">Great work. No targeted practice needed right now.</span>`;
    return;
  }

  const dominantCount = topError ? (effectiveCounts[topError] || 0) : 0;
  const mapped = mapDominantErrorToUiPlan(topError);
  const currentCountsText = formatErrorCountLines(effectiveCounts);
  const rec = latestDifficultyRecommendation || {};
  const recentTop = latestAdaptivePlan?.analytics?.dominantErrorTypes?.[0];
  const recentText = recentTop
    ? `Recent session trend: ${recentTop.frequency} ${humanizeErrorType(recentTop.errorType)}`
    : "";

  targetedPracticeBox.innerHTML = `
    <div class="small" style="line-height:1.5;">
      <b>Targeted Practice Summary</b><br/>
      Error counts this check: ${currentCountsText}<br/>
      ${topError
        ? `You made ${dominantCount} ${humanizeErrorType(topError)} related error${dominantCount === 1 ? "" : "s"}. ${mapped.reason}<br/>`
        : "We'll reinforce recent weak steps.<br/>"}
      Current-set accuracy (answered only): <b>${formatPercent2(rec.accuracy || 0)}</b> (${rec.correct || 0}/${rec.attempted || 0}). Unanswered: <b>${rec.unanswered || 0}</b>.<br/>
      Recommended next set: Topic: <b>${humanizeTopicName(mapped.topic)}</b>, Difficulty: <b>${humanizeTopicName(rec.recommendedDifficulty || mapped.difficulty)}</b>, Problems: <b>${mapped.count}</b>.<br/>
      ${recentText ? `${recentText}<br/>` : ""}
      <button id="generateTargetedBtn" class="primary" style="margin-top:8px;">Generate Targeted Practice</button>
    </div>
  `;

  const btn = document.getElementById("generateTargetedBtn");
  if (btn) btn.addEventListener("click", generateTargetedPractice);
}

function pickTopErrorTypeClient(mistakeBreakdown) {
  const entries = Object.entries(mistakeBreakdown || {});
  if (!entries.length) return "";
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0] || "";
}

async function generateTargetedPractice() {
  if (!homeworkState) return;
  const effectiveCounts = hasErrorCounts(latestCurrentErrorCounts) ? latestCurrentErrorCounts : (latestMistakeBreakdown || {});
  const dominantError = pickTopErrorTypeClient(effectiveCounts);
  const mapped = mapDominantErrorToUiPlan(dominantError);
  const nextDifficulty = latestDifficultyRecommendation.recommendedDifficulty || mapped.difficulty || "easy";

  // Auto-fill controls for targeted set.
  if (hwTopic) hwTopic.value = mapped.topic;
  if (hwDifficulty) hwDifficulty.value = nextDifficulty;
  if (hwCount) hwCount.value = String(mapped.count);

  const count = mapped.count;
  const res = await fetch(tutorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "targeted_practice_generate",
      studentId: getCurrentStudentId(),
      sourceState: {
        ...(homeworkState || {}),
        topic: mapped.topic,
        difficulty: nextDifficulty,
      },
      latestMistakeBreakdown: effectiveCounts,
      count,
    }),
  });

  const data = await parseApiResponse(res);
  if (!data?.ok) {
    logApiError("targeted_practice_generate", data);
    if (targetedPracticeBox) targetedPracticeBox.innerHTML = `<span class="bad">Failed to generate targeted practice.</span>`;
    return;
  }

  homeworkState = data.state || {};
  setTargetedPracticeMode(true, {
    reason: data.targeted?.errorType || dominantError,
    lockedTopic: mapped.topic,
    lockedDifficulty: nextDifficulty,
    skillName: humanizeErrorType(data.targeted?.errorType || dominantError),
  });
  renderProblems((data.homework && Array.isArray(data.homework.problems)) ? data.homework.problems : (data.problems || []));
  if (targetedPracticeBox) {
    const what = humanizeErrorType(data.targeted?.errorType || "");
    targetedPracticeBox.innerHTML = `<span class="small">Loaded targeted practice for <b>${what || "recent mistakes"}</b>. ${data.targeted?.reason || ""} Difficulty: <b>${humanizeTopicName(nextDifficulty)}</b>. Problems: <b>${mapped.count}</b>.</span>`;
  }
}

generateBtn.addEventListener("click", generateHomework);
gradeBtn.addEventListener("click", gradeHomework);

// ----------------- Guided Tutor -----------------
const chatBox = document.getElementById("chatBox");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const restartBtn = document.getElementById("restartBtn");

let guidedState = null;
let guidedInitialized = false;
let guidedSessionStartedAtMs = 0;

function detectGuidedQueryType(text) {
  const s = (text || "").toString().trim();
  if (!s) return "concept";
  // Deterministic fraction-add problem pattern: a/b + c/d (+ e/f)
  const fractionAddPattern = /^(?:-?\d+\s*\/\s*-?\d+)(?:\s*\+\s*-?\d+\s*\/\s*-?\d+){1,2}\s*=?\s*\??$/;
  if (fractionAddPattern.test(s.replace(/\s+/g, " "))) return "problem";
  return "concept";
}

function appendMessage(text, sender) {
  const div = document.createElement("div");
  div.className = `message ${sender}`;
  div.innerText = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function guidedWelcome() {
  const res = await fetch(tutorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "guided", action: "welcome" }),
  });

  const data = await parseApiResponse(res);
  if (!data?.ok) logApiError("guided_welcome", data);
  guidedState = data.state || null;
  guidedSessionStartedAtMs = Date.now();
  appendMessage(data.message || data.tutor?.text || "Welcome to Guided Tutor.", "tutor");
}

function guidedInit() {
  if (guidedInitialized) return;
  guidedInitialized = true;
  chatBox.innerHTML = "";
  guidedWelcome();
}

async function sendGuided() {
  const msg = userInput.value.trim();
  if (!msg) return;
  userInput.value = "";

  appendMessage(msg, "user");
  const queryType = detectGuidedQueryType(msg);
  const prevState = guidedState;

  const res = await fetch(tutorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "guided",
      studentId: getCurrentStudentId(),
      state: guidedState,
      studentAnswer: msg,
      queryType,
      context: {
        grade: hwGrade?.value || "4",
        topic: hwTopic?.value || "fractions_add",
      },
    }),
  });

  const data = await parseApiResponse(res);
  if (!data?.ok) logApiError("guided", data);
  guidedState = data.state || guidedState;
  appendMessage(data.message || data.tutor?.text || "(No response)", "tutor");

  const completedDeterministicLesson =
    queryType === "problem" &&
    (prevState?.phase === "in_lesson") &&
    (guidedState?.phase === "await_problem") &&
    !!data?.validation?.isCorrect;

  if (completedDeterministicLesson) {
    const studentId = getCurrentStudentId();
    const topicKey = "fractions_add";
    const elapsedSec = Math.max(0, Math.round((Date.now() - (guidedSessionStartedAtMs || Date.now())) / 1000));
    try {
      const persistResult = await persistGuidedCompletionToSupabase({
        studentId,
        topic: topicKey,
        difficulty: normalizeDifficulty(hwDifficulty?.value || "easy"),
        isCorrect: true,
        hintsUsed: 0,
        metadata: {
          queryType,
          elapsedSec,
          solved: true,
        },
      });
      if (!persistResult?.ok && !persistResult?.skipped) {
        applySessionToLocalProgress({
          studentId,
          mode: "guided",
          topicKey,
          attempts: 1,
          correct: 1,
          incorrect: 0,
          timeSpentSeconds: elapsedSec,
          errorType: null,
          difficulty: normalizeDifficulty(hwDifficulty?.value || "easy"),
          hintsUsed: 0,
          metadata: { queryType, solved: true },
        });
      }
    } catch (err) {
      console.error("[progress] guided persistence exception", err);
      applySessionToLocalProgress({
        studentId,
        mode: "guided",
        topicKey,
        attempts: 1,
        correct: 1,
        incorrect: 0,
        timeSpentSeconds: elapsedSec,
        errorType: null,
        difficulty: normalizeDifficulty(hwDifficulty?.value || "easy"),
        hintsUsed: 0,
        metadata: { queryType, solved: true },
      });
    }
    guidedSessionStartedAtMs = Date.now();
  }

  await loadProgress();
}

sendBtn.addEventListener("click", sendGuided);
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendGuided();
});

restartBtn.addEventListener("click", () => {
  chatBox.innerHTML = "";
  guidedInitialized = false;
  guidedInit();
});

initStudentSelector();
setMode("homework");
updateSessionDate();
startSessionTimer();
initAuth().catch((err) => {
  console.error("[auth] init failed", err);
  authStatus("Auth init failed. Continuing in local mode.", true);
  loadProgress();
});

const savedTheme = localStorage.getItem("plc_theme") || "light";
applyTheme(savedTheme);
if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    applyTheme(next);
  });
}

if (profileMenuBtn && profileMenu) {
  profileMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeNotificationMenu();
    profileMenu.classList.toggle("open");
  });
}

if (notificationBtn && notificationMenu) {
  notificationBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeProfileMenu();
    notificationMenu.classList.toggle("open");
  });
}

if (profileSettingsBtn) {
  profileSettingsBtn.addEventListener("click", () => {
    closeProfileMenu();
    alert("Settings: password change flow will be connected here.");
  });
}

if (profilePaymentBtn) {
  profilePaymentBtn.addEventListener("click", () => {
    closeProfileMenu();
    alert("Payment: credit card and billing flow will be connected here.");
  });
}

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof Node)) return;

  if (notificationMenu && notificationBtn && !notificationMenu.contains(target) && !notificationBtn.contains(target)) {
    closeNotificationMenu();
  }

  if (profileMenu && profileMenuBtn && !profileMenu.contains(target) && !profileMenuBtn.contains(target)) {
    closeProfileMenu();
  }
});

if (exitPracticeBtn) {
  exitPracticeBtn.addEventListener("click", () => {
    setTargetedPracticeMode(false);
    if (targetedPracticeBox) {
      targetedPracticeBox.innerHTML = `<span class="small">Exited targeted practice. You can generate regular homework now.</span>`;
    }
  });
}

setTargetedPracticeMode(false);

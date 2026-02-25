// ----------------- Mode Switching -----------------
const modeHomework = document.getElementById("modeHomework");
const modeGuided = document.getElementById("modeGuided");
const homeworkPanel = document.getElementById("homeworkPanel");
const guidedPanel = document.getElementById("guidedPanel");

function setMode(mode) {
  const isHomework = mode === "homework";
  modeHomework.classList.toggle("active", isHomework);
  modeGuided.classList.toggle("active", !isHomework);

  homeworkPanel.style.display = isHomework ? "block" : "none";
  guidedPanel.style.display = isHomework ? "none" : "block";

  if (!isHomework) guidedInit();
}

modeHomework.addEventListener("click", () => setMode("homework"));
modeGuided.addEventListener("click", () => setMode("guided"));

// ----------------- Homework Generator + Grader -----------------
const hwGrade = document.getElementById("hwGrade");
const hwTopic = document.getElementById("hwTopic");
const hwDifficulty = document.getElementById("hwDifficulty");
const hwCount = document.getElementById("hwCount");

const generateBtn = document.getElementById("generateBtn");
const gradeBtn = document.getElementById("gradeBtn");

const problemsContainer = document.getElementById("problemsContainer");
const scoreContainer = document.getElementById("scoreContainer");

let homeworkState = null;

function renderProblems(problemList) {
  problemsContainer.innerHTML = "";
  scoreContainer.innerHTML = "";

  for (const p of problemList) {
    const div = document.createElement("div");
    div.className = "problem";
    div.innerHTML = `
      <div><b>Q${p.id}.</b> ${p.question}</div>
      <div style="margin-top:8px;">
        <input id="ans_${p.id}" placeholder="Answer (examples: 7/12 or 2 1/3)" />
      </div>
      <div id="res_${p.id}" class="result"></div>
    `;
    problemsContainer.appendChild(div);
  }
}

async function generateHomework() {
  const grade = hwGrade.value;
  const topic = hwTopic.value;
  const difficulty = hwDifficulty.value;
  const count = hwCount.value;

  const res = await fetch("/.netlify/functions/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "homework_generate",
      grade,
      topic,
      difficulty,
      count,
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    scoreContainer.innerHTML = `<span class="bad">Error:</span> ${data.error || "Failed to generate"}`;
    return;
  }

  homeworkState = data.state;
  renderProblems(data.homework.problems);
}

async function gradeHomework() {
  if (!homeworkState) {
    scoreContainer.innerHTML = `<span class="bad">Generate homework first.</span>`;
    return;
  }

  const studentAnswers = {};
  for (const p of homeworkState.problems) {
    const inp = document.getElementById(`ans_${p.id}`);
    studentAnswers[p.id] = inp ? inp.value.trim() : "";
  }

  const res = await fetch("/.netlify/functions/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "homework_grade",
      state: homeworkState,
      studentAnswers,
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    scoreContainer.innerHTML = `<span class="bad">Error:</span> ${data.error || "Failed to grade"}`;
    return;
  }

  for (const r of data.results) {
    const el = document.getElementById(`res_${r.id}`);
    if (!el) continue;

    if (r.isCorrect) {
      el.innerHTML = `<span class="good">✅ Correct</span>`;
    } else {
      el.innerHTML = `<span class="bad">❌ Incorrect</span> &nbsp; Correct: <b>${r.correctAnswer}</b><br/><span class="small">${r.feedback}</span>`;
    }
  }

  const s = data.summary;
  scoreContainer.innerHTML = `<b>Score:</b> ${s.correct}/${s.total} (${s.scorePercent}%)`;
}

generateBtn.addEventListener("click", generateHomework);
gradeBtn.addEventListener("click", gradeHomework);

// ----------------- Guided Fractions Tutor -----------------
const chatBox = document.getElementById("chatBox");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const restartBtn = document.getElementById("restartBtn");

let guidedState = null;
let guidedInitialized = false;

function appendMessage(text, sender) {
  const div = document.createElement("div");
  div.className = `message ${sender}`;
  div.innerText = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function guidedWelcome() {
  const res = await fetch("/.netlify/functions/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "guided_welcome" }),
  });

  const data = await res.json();
  guidedState = data.state || null;
  appendMessage(data.tutor?.text || "Welcome to Guided Fractions Tutor.", "tutor");
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

  const res = await fetch("/.netlify/functions/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "guided_answer",
      state: guidedState,
      studentAnswer: msg,
    }),
  });

  const data = await res.json();
  guidedState = data.state || guidedState;
  appendMessage(data.tutor?.text || "(No response)", "tutor");
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
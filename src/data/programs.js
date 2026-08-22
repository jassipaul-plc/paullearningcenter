// Program/course data — content taken from the previous PLC website.
// Shaped deliberately like the future Otute catalog API (id, title,
// grade_band, courses, enroll_url) so switching to live API data later
// (build-time fetch) is a data-source swap, not a redesign.
export const programs = [
  {
    id: 'high-school-math',
    title: 'High School Math',
    gradeBand: 'High School',
    image: '/images/equations.jpg',
    blurb:
      'From Integrated Math through AP Calculus — deep conceptual understanding paired with steady exam readiness, so semester finals and AP exams feel familiar, not frightening.',
    detail:
      'High school math is where small gaps become big grades. We close those gaps first, then build ahead of the classroom so students walk into each unit already confident. AP students work through past exam problems and pacing strategies alongside the concepts themselves.',
    audience: 'Students in Math 1 through AP Calculus, including honors tracks',
    courses: ['AP Calculus AB', 'AP Calculus BC', 'Math 2 & 3 Honors', 'Math 1 & 2 Regular'],
  },
  {
    id: 'middle-school-math',
    title: 'Middle School Math',
    gradeBand: 'Middle School',
    image: '/images/student-review.jpg',
    blurb:
      'Accelerated and regular tracks that build the algebra-ready foundation high school demands — habits, fluency, and confidence before the stakes go up.',
    detail:
      'Middle school decides whether a student reaches high school ahead or behind. Our accelerated tracks prepare students aiming for advanced placement, while the regular track makes sure no one moves on with shaky fundamentals.',
    audience: 'Grades 7–8, both accelerated and regular pathways',
    courses: ['Grade 7 Accelerated', 'Grade 8 Accelerated', 'Regular Math Track'],
  },
  {
    id: 'elementary-math',
    title: 'Elementary Math',
    gradeBand: 'Elementary',
    image: '/images/child-writing.jpg',
    blurb:
      'Strong number sense and problem-solving habits, taught with patience and encouragement — where a lifelong relationship with math is decided.',
    detail:
      'Young learners need math to feel like a puzzle, not a punishment. We build fact fluency and word-problem thinking through guided practice, and prepare grade 5–6 students for advanced middle-school placement.',
    audience: 'Grades 3–6, from foundations to advanced prep',
    courses: ['Grade 3 & 4 Foundations', 'Grade 5 & 6 Advanced Prep', 'Problem Solving Skills'],
  },
  {
    id: 'english-ela',
    title: 'English & ELA',
    gradeBand: 'All Grades',
    image: '/images/ela.jpg',
    blurb:
      'Reading comprehension, grammar, and writing skills that carry across every subject — parents consistently tell us their child’s ELA "improved a lot".',
    detail:
      'Strong readers and writers do better in every class. We work on comprehension strategies, grammar and language mechanics, and structured writing — matched to what each student faces at school.',
    audience: 'Elementary through high school',
    courses: ['Reading Comprehension', 'Grammar & Language', 'Writing & Composition'],
  },
  {
    id: 'science',
    title: 'Science',
    gradeBand: 'High School',
    image: '/images/science.jpg',
    blurb:
      'Concept-first support in the core sciences, aligned with school coursework — because memorizing without understanding never survives the test.',
    detail:
      'We support students through the reasoning that science courses actually reward: setting up problems, connecting concepts, and preparing systematically for labs and exams.',
    audience: 'High school Biology, Chemistry, and Physics students',
    courses: ['Biology', 'Chemistry', 'Physics'],
  },
  {
    id: 'test-prep',
    title: 'Test Prep & Enrichment',
    gradeBand: 'Middle + High School',
    image: '/images/test-prep.jpg',
    blurb:
      'Structured preparation for the SAT, ACT, and AP exams — plus creative-thinking enrichment for students who want to be stretched.',
    detail:
      'Test prep here is not a cram course: students learn the content behind the questions, then the timing and strategy on top. Enrichment sessions build the problem-solving creativity that standardized curricula skip.',
    audience: 'Students preparing for SAT, ACT, or AP exams',
    courses: ['SAT', 'ACT', 'AP Course Support', 'Creative Thinking & Problem Solving'],
  },
];

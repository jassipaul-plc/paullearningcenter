// Semester finals results — transcribed from PLC's own published results
// flyers (the images in /images/result*.jpg, also posted publicly on
// Facebook). Names appear exactly as printed on the flyers; "(R)" markers
// are preserved as-is. The original flyer stays linked from each panel.
export const resultSessions = [
  {
    id: '2024-25-sem2',
    title: '2024-25 High School — Semester 2 Finals',
    flyer: '/images/result3.jpg',
    perfect: {
      label: 'Perfect Score 5 — AP Calculus AB',
      score: '5',
      subject: 'AP Calculus AB',
      students: ['Aaradhana', 'Alisha', 'Bryan', 'Dia'],
    },
    tiers: [
      {
        label: '90%+',
        groups: [
          { course: 'AP Calculus AB (Score 4)', students: ['Karthiksai', 'Riya', 'Sabreen', 'Tanmayi', 'Varnitha', 'Uzair', 'Alan'] },
          { course: 'Math 3 Honors', students: ['Aanya', 'Alekhya', 'Krish', 'Riya', 'Aishwarya', 'Ameilia', 'Amit S', 'Ansh', 'Arman K.', 'Mihir', 'Nitya', 'Omar A', 'Shashank', 'Yogita'] },
          { course: 'Math 2 Honors', students: ['Aaryva', 'Sarayu', 'Huiyeon', 'Varshith', 'Aditya'] },
          { course: 'Math 3 Regular', students: ['Asterina', 'Divisha'] },
          { course: 'Math 2 Regular', students: ['Nabil', 'Gurcharan'] },
          { course: 'Math 1 Regular', students: ['Riddheka', 'Ehan'] },
        ],
      },
      {
        label: '80%+',
        groups: [
          { course: 'Math 3 Honors', students: ['Aarav', 'Chitanya', 'Dhruva', 'Diya Dileep', 'Jesica', 'Kethan', 'Keya', 'Rasika', 'Sanjana', 'VictorDavid', 'Shuvam', 'Shruthik'] },
          { course: 'Math 2 Honors', students: ['Ayaan', 'Devanshu', 'Maheen', 'Preeth', 'Sahasra', 'Shradda', 'Sreyas', 'Treya'] },
          { course: 'Summer Skipper', students: ['Maithili', 'Nithya V', 'Shruti', 'Zachary', 'Shreya'] },
          { course: 'Math 3 Regular', students: ['Michelle', 'Beya', 'Jovina'] },
          { course: 'Statistics', students: ['Rishi'] },
        ],
      },
    ],
  },
  {
    id: '2024-25-sem1',
    title: '2024-25 High School — Semester 1 Finals',
    flyer: '/images/result2.jpg',
    perfect: {
      label: 'Perfect Score 100%',
      score: '100%',
      subject: 'Semester Finals',
      students: ['Yogita — Math 3 Honors', 'Garry — ELA 9th'],
    },
    tiers: [
      {
        label: '90%+',
        groups: [
          { course: 'AP Calculus AB', students: ['Alan', 'Akshaj', 'Dia', 'Bryan', 'Aradhana', 'Uzair'] },
          { course: 'Math 3 Honors', students: ['Victordavid', 'Shashank', 'Ayush', 'Riya', 'Sanjana', 'Ansh', 'Arman K', 'Aanya', 'Omar A', 'Rasika', 'Rhea', 'Aishwarya', 'Amit', 'Mihir', 'Nithya'] },
          { course: 'Math 2 Honors', students: ['Aaryva', 'Sarayu', 'Huiyeon'] },
          { course: 'Math 3 Regular', students: ['Michelle', 'Divisha', 'Beya', 'Asterina'] },
          { course: 'Math 2 Regular', students: ['Nabil'] },
          { course: 'Math 1 Regular', students: ['Riddheka'] },
        ],
      },
      {
        label: '80%+',
        groups: [
          { course: 'AP Calculus AB', students: ['Riya', 'Alisha', 'Sabreen', 'Aryansh', 'Karthiksai', 'Risa', 'Riya', 'Tanmayi', 'Varnitha'] },
          { course: 'Math 3 Honors', students: ['Kethan', 'Omar L', 'Jesica', 'Dhruva', 'Shuvam', 'Keya', 'Aarav', 'Catherine', 'Diya Dileep', 'Jositha', 'Amarjot'] },
          { course: 'Math 2 Honors', students: ['Treya', 'Diya', 'Aishwarya', 'Aditya', 'Divyanshu'] },
          { course: 'Math 3 Regular', students: ['Savan'] },
          { course: 'Math 2 Regular', students: ['Garry'] },
          { course: 'Math 1 Regular', students: ['Ehan'] },
          { course: 'Statistics', students: ['Rishi'] },
        ],
      },
    ],
  },
  {
    id: '2023-24-sem1',
    title: '2023-24 High School — Semester 1 Finals',
    flyer: '/images/result1.jpg',
    perfect: {
      label: 'Perfect Score 100%',
      score: '100%',
      subject: 'Semester Finals',
      students: ['Arvya — Math 1', 'Samarth — Math 2 H', 'Omar A — Math 2 H', 'Jasmine — Math 2 H', 'Aradhana — Math 3 H', 'Riya — Math 3 H', 'Bryan — Math 3 H'],
    },
    tiers: [
      {
        label: '90%+',
        groups: [
          { course: 'Math 3 Honors', students: ['Sabreen', 'Aryansh', 'Tanmayi', 'Akshaj', 'Dia', 'Catherine', 'Aliza (R)'] },
          { course: 'Math 2 Honors', students: ['VictorDavid', 'Shashank', 'Ayush', 'Dhruva', 'Naman', 'Ansh', 'Kethan', 'Chaitanya', 'Shuvam', 'Arman K', 'Aanya', 'Keya', 'Riya', 'Risham', 'Arman D', 'Vanshika'] },
          { course: 'Math 1', students: ['Darshini', 'Daisy', 'Preeth', 'Sreyas', 'Aditya', 'Anvi', 'Tanmay'] },
          { course: 'AP Calculus AB', students: ['Rohan'] },
          { course: 'Pre-Calculus', students: ['Alan'] },
        ],
      },
      {
        label: '80%+',
        groups: [
          { course: 'Math 3 Honors', students: ['Srushti', 'Pankhudi'] },
          { course: 'Math 2 Honors', students: ['Aarav', 'Omar L', 'Zara', 'Harry', 'Ivana', 'Gabby', 'Nida', 'Shruthik (R)', 'Jesica (R)', 'Mihir (R)', 'Jiya (R)', 'Joshuva'] },
          { course: 'Math 1', students: ['Diya', 'Neha', 'Deetha', 'Netra', 'Siri'] },
          { course: 'AP Calculus AB', students: ['Chandra', 'Abhishek'] },
        ],
      },
    ],
  },
];

// Aggregate counts across all published flyers — real, countable data.
export function resultStats() {
  let perfect = 0;
  let ninety = 0;
  let eighty = 0;
  for (const s of resultSessions) {
    perfect += s.perfect.students.length;
    for (const tier of s.tiers) {
      const n = tier.groups.reduce((sum, g) => sum + g.students.length, 0);
      if (tier.label.startsWith('90')) ninety += n;
      else eighty += n;
    }
  }
  return { perfect, ninety, eighty, sessions: resultSessions.length };
}

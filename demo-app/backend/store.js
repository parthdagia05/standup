const titles = [
  "Buy groceries", "Fix login bug", "Write blog post", "Call the bank",
  "Review PR #42", "Book flight to Goa", "Renew passport", "Plan sprint",
  "Update resume", "Clean the desk", "Pay electricity bill", "Read Kubernetes docs",
  "Water the plants", "Backup laptop", "Reply to recruiter", "Prepare demo",
  "Order new charger", "Fix flaky test", "Schedule dentist", "Learn Go generics",
  "Draft LFX cover letter", "Refactor auth module", "Buy birthday gift",
  "Set up ngrok", "Record demo video",
];

const todos = titles.map((title, i) => ({ id: i + 1, title, done: i % 4 === 0 }));

let lastId = todos.length;
const nextId = () => ++lastId;

module.exports = { todos, nextId };

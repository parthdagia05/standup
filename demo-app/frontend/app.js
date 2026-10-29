const list = document.getElementById("list");
const form = document.getElementById("add");
const input = document.getElementById("title");

// Pagination plan: page numbers in the UI ("Page 2 of 3"), so we'd like
// the API to take ?page=2&limit=10 and tell us the total count.
const PAGE_SIZE = 10;

async function load() {
  const res = await fetch("/todos");
  const todos = await res.json();
  render(todos);
}

function render(todos) {
  list.innerHTML = "";
  for (const todo of todos) {
    const li = document.createElement("li");
    li.textContent = todo.title;
    if (todo.done) li.classList.add("done");
    list.appendChild(li);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  await fetch("/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  input.value = "";
  load();
});

load();

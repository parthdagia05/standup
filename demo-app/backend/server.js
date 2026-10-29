const path = require("node:path");
const express = require("express");
const { todos, nextId } = require("./store");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Returns every todo. Fine for 25 items, not for 25,000.
app.get("/todos", (req, res) => {
  res.json(todos);
});

app.post("/todos", (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "title is required" });
  }
  const todo = { id: nextId(), title: title.trim(), done: false };
  todos.push(todo);
  res.status(201).json(todo);
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Todo app on http://localhost:${port}`));
}

module.exports = app;

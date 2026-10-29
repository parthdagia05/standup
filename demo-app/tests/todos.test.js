const { test, before, after } = require("node:test");
const assert = require("node:assert");
const app = require("../backend/server");

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test("GET /todos returns every todo as an array", async () => {
  const res = await fetch(`${base}/todos`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  assert.ok(body.length >= 25);
  assert.ok(body[0].title);
});

test("POST /todos adds a todo that shows up in the list", async () => {
  const res = await fetch(`${base}/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Ship Standup" }),
  });
  assert.strictEqual(res.status, 201);
  const list = await (await fetch(`${base}/todos`)).json();
  assert.ok(list.some((t) => t.title === "Ship Standup"));
});

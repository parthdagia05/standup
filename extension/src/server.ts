import type { Server } from "node:http";
import express from "express";
import { bus } from "./bus";
import { decisions } from "./decisions/router";

/**
 * Bolna's `submit_decision` custom function POSTs here (through ngrok):
 *   POST /decision { decision_id, choice }
 * `choice` may be an option verbatim or whatever the caller said.
 */
export function startServer(port: number): Server {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, pending: decisions.allPending().map((d) => ({ id: d.id, question: d.question, options: d.options })) });
  });

  app.post("/decision", async (req, res) => {
    const body = { ...req.query, ...(req.body ?? {}) } as Record<string, unknown>;
    const choice = String(body.choice ?? body.answer ?? "").trim();
    // Fall back to the oldest pending decision if Bolna didn't pass an id.
    const id = String(body.decision_id ?? body.decisionId ?? decisions.oldestPending()?.id ?? "");
    bus.emit({ type: "log", level: "info", text: `Phone answer for ${id || "?"}: "${choice}"` });

    const d = decisions.get(id);
    if (!d) return res.json({ ok: false, message: "That decision is already answered or doesn't exist." });
    if (!choice) return res.json({ ok: false, message: `Please pick one of: ${d.options.join(", ")}` });

    const exact = d.options.find((o) => o.toLowerCase() === choice.toLowerCase());
    const ok = exact ? decisions.answer(id, exact, "phone") : await decisions.answerFromSpeech(id, choice, "phone");
    res.json(ok ? { ok: true, message: "Got it, passing that to the team." } : { ok: false, message: `Didn't match an option. Options are: ${d.options.join(", ")}` });
  });

  const server = app.listen(port, () => bus.emit({ type: "log", level: "info", text: `Decision server on http://localhost:${port}` }));
  server.on("error", (err) => bus.emit({ type: "log", level: "error", text: `Server error: ${err.message}` }));
  return server;
}

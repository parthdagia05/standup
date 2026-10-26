import * as esbuild from "esbuild";

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  // The Agent SDK is ESM-only and ships a native binary, so it stays in
  // node_modules and is loaded with a real dynamic import at runtime.
  external: ["vscode", "@anthropic-ai/claude-agent-sdk"],
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}

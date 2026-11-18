// Launch Radar v3 — entrypoint.
//
// Reads the sealed snapshot, ranks the pre-token protocols with the comps
// curve in lib/model.ts, writes the ranked board, the dashboard's data,
// copies the dashboard and screenshots, and writes the dossier with the
// kit's own buildDossier. Deterministic: no clock, no randomness outside
// the model's fixed seeds, total sort orders everywhere, so two runs
// write the same bytes.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const repoRoot = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

function inputPath(): string {
  const fromArg = argValue("--input");
  if (fromArg) return fromArg;
  const dir = process.env.MAKEFUN_INPUT_DIR;
  if (dir) return join(dir, "snapshot.json");
  return "/input/snapshot.json";
}

function outputDir(): string {
  return process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src, { withFileTypes: true })) {
    if (!name.isFile()) continue;
    copyFileSync(join(src, name.name), join(dst, name.name));
  }
}

function main(): void {
  const snapshot = JSON.parse(readFileSync(inputPath(), "utf8"));
  const out = outputDir();
  const board = buildBoard(snapshot);

  mkdirSync(out, { recursive: true });
  mkdirSync(join(out, "dashboard"), { recursive: true });
  mkdirSync(join(out, "screenshots"), { recursive: true });

  // The ranked board: one row per protocol, rank 1 first by implied value.
  writeFileSync(join(out, "board.json"), JSON.stringify(board, null, 2) + "\n");

  // The dashboard's data, compact on purpose: the dossier shows the whole
  // dashboard source, capped at 65,536 bytes, so rows travel as arrays and
  // only the top 10 rows carry their farm steps verbatim. Every other
  // row's steps are rebuilt in the page by app.js from the same templates
  // (same chain gas, same capital tier, same category action), so the
  // detail view shows the exact steps board.json holds for that row.
  const compactRows = board.rows.map((r) => [
    r.slug,
    r.name,
    r.category,
    r.chains[0] ?? "Ethereum",
    r.tvl_usd,
    r.change_7d,
    r.age_days,
    r.anchor,
    r.implied_value_usd,
    r.farm_cost_usd,
    r.farm_minutes,
    r.farm_capital_usd,
    r.watchlist ? 1 : 0,
    r.chains.length,
  ]);
  const topSteps: Record<string, string[]> = {};
  for (const r of board.rows.slice(0, 10)) topSteps[r.slug] = r.farm_steps;
  const data = {
    meta: {
      asOf: board.asOf,
      counts: board.counts,
      rows: board.rows.length,
      peers: board.validation.peers,
      intercept: Math.round(board.validation.intercept * 1000) / 1000,
      slope: Math.round(board.validation.slope * 1000) / 1000,
      curveMedApe: Math.round(board.validation.curveMedApe * 1000) / 1000,
      flatMedApe: Math.round(board.validation.flatMedApe * 1000) / 1000,
      curveWins: board.validation.curveWins,
      seeds: board.validation.seeds.map((s) => ({
        seed: s.seed,
        nHold: s.nHold,
        curve: Math.round(s.curveMedApe * 1000) / 1000,
        flat: Math.round(s.flatMedApe * 1000) / 1000,
      })),
      buckets: board.validation.buckets.map((b) => ({
        label: b.label,
        n: b.n,
        anchor: Math.round(b.medianAnchor * 10000) / 10000,
      })),
      catMedians: board.validation.categoryMedians.map((c) => ({
        category: c.category,
        n: c.n,
        anchor: Math.round(c.medianAnchor * 10000) / 10000,
      })),
    },
    rows: compactRows,
    topSteps,
  };
  const dataJs = `window.RADAR = ${JSON.stringify(data)};\n`;
  copyTree(join(repoRoot, "dashboard"), join(out, "dashboard"));
  writeFileSync(join(out, "dashboard", "data.js"), dataJs);
  const shots = join(repoRoot, "screenshots");
  if (existsSync(shots)) copyTree(shots, join(out, "screenshots"));

  const dossier = buildDossier(out, { text_max_bytes: 65536 });
  writeFileSync(join(out, "dossier.json"), dossier);

  const top = board.rows[0]!;
  console.log(
    `radar v3: ${board.rows.length} rows ` +
      `(${board.counts.watchlist} watchlist, ${board.counts.eligible} eligible early), ` +
      `${board.validation.peers} tokenised peers, ` +
      `curve slope ${board.validation.slope.toFixed(3)}, ` +
      `blind MedAPE curve ${board.validation.curveMedApe.toFixed(3)} vs flat ${board.validation.flatMedApe.toFixed(3)} ` +
      `(${board.validation.curveWins}/5 seeds), ` +
      `top ${top.slug} implied $${top.implied_value_usd.toLocaleString("en-US")}, ` +
      `dossier ${dossier.length} bytes`,
  );
}

main();

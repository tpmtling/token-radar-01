import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function inputPath(): string {
  const given = arg('input', '');
  if (given !== '') return given.endsWith('.json') ? resolve(given) : resolve(given, 'snapshot.json');
  for (const candidate of ['/input/snapshot.json', join(here, 'input', 'snapshot.json'), join(here, 'snapshot.json')]) {
    if (existsSync(candidate)) return candidate;
  }
  return join(here, 'snapshot.json');
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    const target = join(to, name);
    if (!statSync(source).isFile() || resolve(source) === resolve(target)) continue;
    copyFileSync(source, target);
    copied.push(name);
  }
  return copied;
}

const inputFile = inputPath();
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = resolve(arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? here));
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the board was refused: ${issue}\n`);
  process.exit(1);
}

const shots = readdirSync(join(here, 'screenshots')).filter((name) => !name.startsWith('.') && statSync(join(here, 'screenshots', name)).isFile());
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name} has an invalid name\n`);
    process.exit(1);
  }
}

const boardBytes = `${JSON.stringify({ rows: board })}\n`;
const dataBytes = dataScript(radar);
mkdirSync(join(here, 'dashboard'), { recursive: true });
writeFileSync(join(here, 'board.json'), boardBytes);
writeFileSync(join(here, 'dashboard', 'data.js'), dataBytes);
const dossier = buildDossier(here, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
writeFileSync(join(here, 'dossier.json'), dossier);

if (out !== here) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), boardBytes);
  writeFileSync(join(out, 'dossier.json'), dossier);
  copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
  copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlisted, ${board.length} rows (${radar.summary.included} ranked, ${radar.summary.excluded} excluded, ${radar.summary.early} early)\n` +
  `token radar: wrote board.json, dashboard/data.js (${dataBytes.length} bytes), dossier.json (${dossier.length} bytes) in ${here}` +
  (out === here ? '\n' : ` and copied the entry to ${out}\n`)
);

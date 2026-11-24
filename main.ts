// Vice Blocks 3D — delivery entry point for the make.fun gta6-01 bounty.
//
// The playable part is a static offline bundle in game/: hand-written
// WebGL, no dependencies and nothing downloaded at runtime. This module
// only packages that bundle. It copies game/ plus screenshots/ into the
// destination folder and asks the vendored make.fun helper to write
// dossier.json under the scorer's own limits, so an oversize package is
// caught locally rather than during judging.
//
// Local run:  MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader MAKEFUN_OUTPUT_DIR substitutes for /output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const rootHere = fileURLToPath(new URL('.', import.meta.url));
const destination = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(destination, { recursive: true });
cpSync(join(rootHere, 'game'), join(destination, 'game'), { recursive: true });

const shotsHere = join(rootHere, 'screenshots');
mkdirSync(join(destination, 'screenshots'), { recursive: true });
if (existsSync(shotsHere)) {
  cpSync(shotsHere, join(destination, 'screenshots'), { recursive: true });
}

const dossier = buildDossier(destination, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(destination, 'dossier.json'), dossier);

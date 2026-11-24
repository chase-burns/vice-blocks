// main.ts — the handover step for this competition entry.
//
// When the grader runs this file with plain `node main.ts`, it does
// three small things and then exits:
//
//   1. It works out where this repository lives, from this file's own
//      URL, so the caller's working directory does not matter.
//   2. It copies the two payload folders — `game/` (the playable
//      static site) and `screenshots/` (the four stills) — into the
//      output directory, which is $MAKEFUN_OUTPUT_DIR when that
//      variable is set and `/output` otherwise.
//   3. It asks the vendored helper library to summarise the copied
//      tree and writes the bytes it returns to `dossier.json` in the
//      same output directory.
//
// Nothing here starts a server or waits for input: the copies and the
// dossier write are plain synchronous filesystem work, so the process
// finishes almost immediately. The size limits handed to the dossier
// builder are the ones this bounty publishes, spelled out in full
// below so the file can be read on its own.

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The folder this file sits in is the repository root; the payload
// directories and the output dossier are all addressed relative to it
// or to the output directory, never relative to the process cwd.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// Where the finished entry is assembled. The grader points this at a
// scratch directory through the environment; `/output` is the fallback
// used when the variable is absent.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The caps this bounty fixes for a dossier: how much text may be
// summarised, how many screenshots are allowed and how large each may
// be, and the ceilings on the game tree's file count, total size and
// individual path length.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// Copy one payload directory from the repository into the output
// directory, creating the destination (and any parents) as needed and
// replacing whatever a previous run may have left there.
function copyPayload(name: string): void {
  cpSync(join(repoRoot, name), join(outputDir, name), {
    recursive: true,
    force: true,
  });
}

function main(): void {
  mkdirSync(outputDir, { recursive: true });
  copyPayload('game');
  copyPayload('screenshots');
  // The dossier describes the output tree, so it is built only after
  // both copies have landed, and from the output directory itself.
  const dossierBytes = buildDossier(outputDir, DOSSIER_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);
}

main();

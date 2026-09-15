#!/usr/bin/env node
/**
 * Node port of the continuous-learning-v2 data-directory resolver.
 *
 * Parity target: skills/continuous-learning-v2/scripts/lib/homunculus-dir.sh
 * and instinct-cli.py::_resolve_homunculus_dir. Three implementations of one
 * path rule is already one too many, so this file must not drift — see
 * tests/lib/homunculus-dir-parity.test.js, which runs the shell function and
 * this port across the same env permutations and asserts they agree.
 *
 * Resolution precedence:
 *   1. CLV2_HOMUNCULUS_DIR, when absolute
 *   2. XDG_DATA_HOME/ecc-homunculus, when XDG_DATA_HOME is absolute
 *   3. HOME/.local/share/ecc-homunculus
 *
 * A non-absolute override is rejected with a warning rather than silently
 * resolved against cwd: a relative data dir would scatter learner state into
 * whatever repository happened to be open.
 */

'use strict';

const path = require('path');

const DIR_NAME = 'ecc-homunculus';

function isAbsolutePosixOrWin(value) {
  return typeof value === 'string' && value.length > 0 && path.isAbsolute(value);
}

/**
 * @param {{env?: NodeJS.ProcessEnv, warn?: (msg: string) => void}} [options]
 * @returns {string|null} absolute path, or null when HOME is unusable
 */
function resolveHomunculusDir(options = {}) {
  const env = options.env || process.env;
  const warn = options.warn || (msg => process.stderr.write(`${msg}\n`));

  const override = env.CLV2_HOMUNCULUS_DIR;
  if (override) {
    if (isAbsolutePosixOrWin(override)) return override;
    warn(`[ecc] CLV2_HOMUNCULUS_DIR=${override} is not absolute; ignoring`);
  }

  const xdg = env.XDG_DATA_HOME;
  if (xdg) {
    if (isAbsolutePosixOrWin(xdg)) return path.join(xdg, DIR_NAME);
    warn(`[ecc] XDG_DATA_HOME=${xdg} is not absolute; ignoring`);
  }

  const home = env.HOME || '';
  if (isAbsolutePosixOrWin(home)) {
    return path.join(home, '.local', 'share', DIR_NAME);
  }

  warn(`[ecc] HOME=${home} is not absolute; cannot resolve homunculus dir`);
  return null;
}

module.exports = { resolveHomunculusDir, DIR_NAME };

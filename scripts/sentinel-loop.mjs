import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export function msUntilNextHourUtc(now, hour) {
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0),
  );
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

const SENTINEL_PATH = join(dirname(fileURLToPath(import.meta.url)), 'sentinel.mjs');

function spawnSentinelRun() {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [SENTINEL_PATH], { stdio: 'inherit' });
    child.on('exit', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(2));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawHour = process.env.SENTINEL_RUN_HOUR_UTC;
  const hour = rawHour === undefined || rawHour.trim() === '' ? 9 : Number(rawHour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    console.log('=== SENTINEL LOOP FAILURE — configuration ===');
    console.log(`SENTINEL_RUN_HOUR_UTC must be an integer 0-23, got: ${rawHour}`);
    process.exit(2);
  }

  // Run once immediately on start so a deploy or restart doubles as the smoke
  // trigger; the cost is at most one extra quiet run before the schedule settles.
  let code = await spawnSentinelRun();
  console.log(`sentinel run finished with exit ${code}`);

  // The loop never exits on a child failure — the issue channel and Render
  // logs carry that signal instead; a bad SENTINEL_RUN_HOUR_UTC value above
  // is the only condition that ends the process.
  for (;;) {
    await sleep(msUntilNextHourUtc(new Date(), hour));
    code = await spawnSentinelRun();
    console.log(`sentinel run finished with exit ${code}`);
  }
}

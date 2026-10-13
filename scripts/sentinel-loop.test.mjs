import test from 'node:test';
import assert from 'node:assert/strict';
import { msUntilNextHourUtc } from './sentinel-loop.mjs';

test('msUntilNextHourUtc returns the time until later today when the hour has not passed', () => {
  const now = new Date('2026-07-07T05:30:00.000Z');
  const ms = msUntilNextHourUtc(now, 9);
  assert.equal(ms, 3 * 60 * 60 * 1000 + 30 * 60 * 1000);
});

test('msUntilNextHourUtc rolls over to tomorrow when the hour has already passed today', () => {
  const now = new Date('2026-07-07T12:00:00.000Z');
  const ms = msUntilNextHourUtc(now, 9);
  const expected = new Date('2026-07-08T09:00:00.000Z').getTime() - now.getTime();
  assert.equal(ms, expected);
});

test('msUntilNextHourUtc returns a full day when now is exactly the target hour', () => {
  const now = new Date('2026-07-07T09:00:00.000Z');
  assert.equal(msUntilNextHourUtc(now, 9), 24 * 60 * 60 * 1000);
});

test('msUntilNextHourUtc handles hour 0 wraparound', () => {
  const now = new Date('2026-07-07T23:30:00.000Z');
  const ms = msUntilNextHourUtc(now, 0);
  const expected = new Date('2026-07-08T00:00:00.000Z').getTime() - now.getTime();
  assert.equal(ms, expected);
});

test('msUntilNextHourUtc for hour 0 earlier in the day targets tomorrow midnight', () => {
  const now = new Date('2026-07-07T00:30:00.000Z');
  const ms = msUntilNextHourUtc(now, 0);
  const expected = new Date('2026-07-08T00:00:00.000Z').getTime() - now.getTime();
  assert.equal(ms, expected);
});

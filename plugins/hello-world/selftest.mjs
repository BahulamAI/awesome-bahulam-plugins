/**
 * Offline smoke test for the hello-world plugin handlers.
 * Run: node plugins/hello-world/selftest.mjs
 */

import { call as hello } from './tools/hello.mjs';
import { call as wordCount } from './tools/word-count.mjs';
import { call as collatz } from './tools/collatz.mjs';

let failures = 0;
function check(label, cond, detail = '') {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

// hello
{
  const r = await hello({});
  check('hello default greets "world"', r.success && r.output.message.includes('world'));

  const s = await hello({ name: 'Ravi', shout: true });
  check('hello shout uppercases', s.success && s.output.shouted && s.output.message === s.output.message.toUpperCase());
}

// word_count
{
  const empty = await wordCount({});
  check('word_count rejects missing text', empty.success === false);

  const r = await wordCount({ text: 'One two three. Four five!\n\nSix seven.' });
  const o = r.output;
  check('word_count counts words', r.success && o.words === 7, `got ${o.words}`);
  check('word_count counts sentences', o.sentences === 3, `got ${o.sentences}`);
  check('word_count counts paragraphs', o.paragraphs === 2, `got ${o.paragraphs}`);
  check('word_count longest_word', o.longest_word === 'three.' || o.longest_word === 'three', `got "${o.longest_word}"`);
}

// collatz_sequence — pure math, verifiable against known values.
{
  const bad = await collatz({ start: 0 });
  check('collatz rejects start=0', bad.success === false);
  const bad2 = await collatz({ start: 1.5 });
  check('collatz rejects non-integer', bad2.success === false);

  const one = await collatz({ start: 1 });
  check('collatz(1) → 0 steps', one.success && one.output.steps === 0 && one.output.converged);

  const six = await collatz({ start: 6 });
  // 6 → 3 → 10 → 5 → 16 → 8 → 4 → 2 → 1  (8 steps, peak 16)
  check('collatz(6) → 8 steps', six.output.steps === 8, `got ${six.output.steps}`);
  check('collatz(6) → peak 16', six.output.peak === 16, `got ${six.output.peak}`);
  check('collatz(6) sequence length matches steps', six.output.sequence.length === six.output.steps + 1);

  const twentySeven = await collatz({ start: 27 });
  // 27 is the famous long one: 111 steps, peaks at 9232.
  check('collatz(27) → 111 steps', twentySeven.output.steps === 111, `got ${twentySeven.output.steps}`);
  check('collatz(27) → peak 9232', twentySeven.output.peak === 9232, `got ${twentySeven.output.peak}`);

  const capped = await collatz({ start: 27, max_steps: 5 });
  check('collatz respects max_steps', capped.output.steps === 5 && !capped.output.converged);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

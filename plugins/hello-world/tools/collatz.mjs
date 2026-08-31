/**
 * collatz_sequence — a self-contained math trick.
 *
 * Pick any positive integer n. Apply the Collatz rule:
 *   n -> n/2  (if n is even)
 *   n -> 3n+1 (if n is odd)
 * The Collatz conjecture says every starting n eventually reaches 1.
 * Verified for every integer up to 2^68 — but no proof exists.
 *
 * Reference tool that shows:
 *   - Pure computation (no I/O)
 *   - Input validation with a clean structured error
 *   - Returning array data suited to a chart visualization
 *   - Bounded work (max_steps guard) — critical for handlers so a bad
 *     input can't hang the CLI
 */

export const name = 'collatz_sequence';
export const description = 'Compute the Collatz sequence for a positive integer';

const HARD_STEP_CAP = 10000; // n=27 needs 111 steps and peaks at 9232; 10k is very safe

export async function call(args = {}) {
  const n = Number(args.start);
  if (!Number.isInteger(n) || n < 1) {
    return { success: false, output: 'collatz_sequence: `start` must be a positive integer' };
  }
  if (n > Number.MAX_SAFE_INTEGER / 4) {
    return { success: false, output: 'collatz_sequence: `start` is too large for safe integer math' };
  }
  const maxSteps = Math.min(HARD_STEP_CAP, Math.max(1, Number(args.max_steps) || HARD_STEP_CAP));

  const sequence = [n];
  let x = n;
  let steps = 0;
  let peak = n;
  while (x !== 1 && steps < maxSteps) {
    x = (x % 2 === 0) ? x / 2 : 3 * x + 1;
    sequence.push(x);
    if (x > peak) peak = x;
    steps++;
  }

  const converged = x === 1;
  return {
    success: true,
    output: {
      start: n,
      steps,
      peak,                                  // highest value the sequence hit
      peak_ratio: Math.round((peak / n) * 100) / 100,
      converged,                             // did we actually reach 1?
      final: x,
      sequence,                              // full trajectory for charting
      note: converged
        ? `Reached 1 in ${steps} steps. Peak was ${peak} (${Math.round((peak / n) * 100) / 100}× the start).`
        : `Stopped at step ${steps} without reaching 1 (max_steps=${maxSteps}).`,
    },
  };
}

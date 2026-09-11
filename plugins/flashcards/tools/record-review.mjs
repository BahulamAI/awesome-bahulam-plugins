/**
 * record_review — grade one card and reschedule it (SM-2).
 *
 * This is the tool that makes the plugin a study tool rather than a
 * notebook: it writes the immutable `reviews` row (the permanent record) and
 * moves the card's schedule, which is what a future session reads to decide
 * what is due.
 *
 * `schedule` is exported so selftest.mjs can pin the maths directly, without
 * standing up a state DB.
 */

export const name = 'record_review';
export const description = 'Grade one card and reschedule it with the SM-2 rule';

/** SM-2 never lets a card become easier to retain by failing it forever. */
export const MIN_EASE = 1.3;
/** Ceiling on the interval so a long-lived card cannot run away to decades. */
export const MAX_INTERVAL_DAYS = 3650;

/**
 * The SM-2 step: given a rating and the card's current schedule, return the
 * next one.
 *
 * Order matters and is the canonical one — the interval is computed with the
 * OLD ease factor, and only then is the ease factor updated from the rating.
 * Doing it the other way round quietly changes every interval the learner
 * ever sees.
 *
 * Ratings: 0-2 failed (lapse), 3 hard, 4 good, 5 easy.
 *
 * @param {number} rating 0..5
 * @param {{ ease_factor: number, interval_days: number, reps: number, lapses: number }} card
 * @returns {{ reps: number, lapses: number, interval_days: number, ease_factor: number }}
 */
export function schedule(rating, card) {
  const q = Math.trunc(Number(rating));
  const ease = Number(card.ease_factor);
  const interval = Number(card.interval_days);
  const reps = Number(card.reps);
  const lapses = Number(card.lapses);

  let nextReps;
  let nextLapses;
  let nextInterval;
  let nextEase;

  if (q >= 3) {
    nextReps = reps + 1;
    nextLapses = lapses;
    if (nextReps === 1) nextInterval = 1;
    else if (nextReps === 2) nextInterval = 6;
    else nextInterval = Math.round(interval * ease);
    // The canonical SM-2 ease adjustment: it falls for a hard pass, holds
    // for a good pass, and rises for an easy one.
    nextEase = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  } else {
    nextReps = 0;
    nextLapses = lapses + 1;
    nextInterval = 1;
    nextEase = ease - 0.2;
  }

  return {
    reps: nextReps,
    lapses: nextLapses,
    interval_days: Math.max(1, Math.min(Math.trunc(nextInterval), MAX_INTERVAL_DAYS)),
    // Rounded to 3dp so the stored value does not drift into float noise
    // that makes the panel's average look like a bug.
    ease_factor: Math.max(MIN_EASE, Math.round(nextEase * 1000) / 1000),
  };
}

/**
 * Consecutive reviews graded >= 3, counting back from the most recent.
 * Bounded so a long history cannot turn this into an unbounded scan.
 */
export function currentStreak(state) {
  const recent = state.query('SELECT rating FROM reviews ORDER BY id DESC LIMIT 100');
  let streak = 0;
  for (const row of recent) {
    if (Number(row.rating) >= 3) streak += 1;
    else break;
  }
  return streak;
}

/**
 * @param {object} args { card_id, rating, response_time_ms?, note? }
 * @param {object} options.state Shared Blackboard (a Promise, per CLI convention)
 */
export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'record_review: plugin state unavailable' };
  }

  const cardId = Number(args.card_id);
  if (!Number.isInteger(cardId) || cardId < 1) {
    return { success: false, output: 'record_review: `card_id` must be a positive integer' };
  }

  const rating = Number(args.rating);
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    return {
      success: false,
      output: 'record_review: `rating` must be an integer from 0 to 5 '
        + '(0-2 failed recall, 3 hard, 4 good, 5 easy)',
    };
  }

  const rows = state.query(
    'SELECT id, deck_id, ease_factor, interval_days, reps, lapses FROM cards WHERE id = ?',
    [cardId],
  );
  if (rows.length === 0) {
    return { success: false, output: `record_review: no card with id ${cardId}.` };
  }
  const card = rows[0];

  const now = new Date();
  const nowIso = now.toISOString();
  const next = schedule(rating, card);
  const dueAt = new Date(now.getTime() + next.interval_days * 86400000).toISOString();

  const responseTime = Number(args.response_time_ms);

  // The permanent record. The card row is a schedule; this is the ledger,
  // and it is what makes "why is this card at 34 days?" answerable later.
  state.query(
    'INSERT INTO reviews(card_id, rating, previous_interval_days, new_interval_days, '
      + 'previous_ease_factor, new_ease_factor, response_time_ms, note, reviewed_at) '
      + 'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      cardId,
      rating,
      Number(card.interval_days),
      next.interval_days,
      Number(card.ease_factor),
      next.ease_factor,
      Number.isFinite(responseTime) ? Math.trunc(responseTime) : null,
      args.note ? String(args.note) : null,
      nowIso,
    ],
  );

  state.query(
    'UPDATE cards SET ease_factor = ?, interval_days = ?, due_at = ?, reps = ?, lapses = ?, '
      + 'last_rating = ?, last_reviewed_at = ?, updated_at = ? WHERE id = ?',
    [next.ease_factor, next.interval_days, dueAt, next.reps, next.lapses, rating, nowIso, nowIso, cardId],
  );

  const deckRows = state.query('SELECT id, name FROM decks WHERE id = ?', [Number(card.deck_id)]);
  const deckName = deckRows[0]?.name ?? null;

  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const dueNow = Number(
    state.query('SELECT COUNT(*) AS n FROM cards WHERE due_at <= ?', [nowIso])[0]?.n || 0,
  );
  const newCards = Number(
    state.query('SELECT COUNT(*) AS n FROM cards WHERE reps = 0')[0]?.n || 0,
  );

  state.set('study_progress', {
    active_deck: deckName,
    deck_id: Number(card.deck_id),
    due_now: dueNow,
    new_cards: newCards,
    streak: currentStreak(state),
    updated_at: nowIso,
  });
  state.append('study_log', {
    event: rating >= 3 ? 'reviewed_passed' : 'reviewed_failed',
    card_id: cardId,
    deck: deckName,
    rating,
    interval_days: next.interval_days,
    due_at: dueAt,
    at: nowIso,
  });

  return {
    success: true,
    output: {
      card_id: cardId,
      rating,
      passed: rating >= 3,
      interval_days: next.interval_days,
      ease_factor: next.ease_factor,
      due_at: dueAt,
      reps: next.reps,
      lapses: next.lapses,
      due_now: dueNow,
    },
  };
}

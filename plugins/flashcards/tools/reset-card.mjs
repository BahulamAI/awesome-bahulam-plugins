/**
 * reset_card — put a card back to brand-new.
 *
 * The escape hatch for a card that is *wrong* rather than forgotten: a typo
 * in the answer, two facts fused into one question, a bad first draft from
 * the generator. Grading cannot fix those, because grading only moves the
 * schedule.
 *
 * History is deliberately kept. The `reviews` table is an audit trail, and
 * resetting a schedule does not un-happen the reviews — deleting them would
 * quietly rewrite the learner's record.
 */

export const name = 'reset_card';
export const description = 'Put a card back to brand-new and make it due immediately';

/** The same ease factor a freshly imported card starts at. */
export const NEW_EASE = 2.5;

/**
 * @param {object} args { card_id }
 * @param {object} options.state Shared Blackboard (a Promise, per CLI convention)
 */
export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'reset_card: plugin state unavailable' };
  }

  const cardId = Number(args.card_id);
  if (!Number.isInteger(cardId) || cardId < 1) {
    return { success: false, output: 'reset_card: `card_id` must be a positive integer' };
  }

  const rows = state.query('SELECT id, deck_id FROM cards WHERE id = ?', [cardId]);
  if (rows.length === 0) {
    return { success: false, output: `reset_card: no card with id ${cardId}.` };
  }

  const now = new Date().toISOString();
  state.query(
    'UPDATE cards SET ease_factor = ?, interval_days = 0, due_at = ?, reps = 0, lapses = 0, '
      + 'last_rating = NULL, last_reviewed_at = NULL, updated_at = ? WHERE id = ?',
    [NEW_EASE, now, now, cardId],
  );

  const kept = Number(
    state.query('SELECT COUNT(*) AS n FROM reviews WHERE card_id = ?', [cardId])[0]?.n || 0,
  );
  const deckRows = state.query('SELECT name FROM decks WHERE id = ?', [Number(rows[0].deck_id)]);
  const deckName = deckRows[0]?.name ?? null;

  state.append('study_log', {
    event: 'card_reset',
    card_id: cardId,
    deck: deckName,
    at: now,
  });

  return {
    success: true,
    output: {
      card_id: cardId,
      ease_factor: NEW_EASE,
      interval_days: 0,
      due_at: now,
      reps: 0,
      lapses: 0,
      reviews_kept: kept,
    },
  };
}

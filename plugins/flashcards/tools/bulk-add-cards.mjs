/**
 * bulk_add_cards — add a batch of Q&A cards to a deck.
 *
 * The sink for generation. Decks get built from a topic or a document, but
 * the cards always land here, and they land all-or-nothing: every card is
 * validated before the first INSERT, because a half-imported batch leaves
 * the learner with a deck they cannot trust.
 *
 * `validateCards` is exported so selftest.mjs can pin the rules without a DB.
 */

export const name = 'bulk_add_cards';
export const description = 'Add a batch of Q&A cards to a deck in one call';

/** Bounded so one tool call cannot be turned into an unbounded write. */
export const MAX_BATCH = 200;

/**
 * Validate the whole batch up front, and normalize it into insert-ready rows.
 *
 * @param {unknown} raw the `cards` argument
 * @returns {{ valid: boolean, error?: string, cards?: object[] }}
 */
export function validateCards(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { valid: false, error: '`cards` must be a non-empty array' };
  }
  if (raw.length > MAX_BATCH) {
    return { valid: false, error: `\`cards\` may not exceed ${MAX_BATCH} per call (got ${raw.length})` };
  }

  const cards = [];
  for (const [i, card] of raw.entries()) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      return { valid: false, error: `cards[${i}] must be an object` };
    }
    const question = String(card.question ?? '').trim();
    const answer = String(card.answer ?? '').trim();
    if (!question) return { valid: false, error: `cards[${i}].question is required` };
    if (!answer) return { valid: false, error: `cards[${i}].answer is required` };

    const tags = Array.isArray(card.tags)
      ? card.tags.map(t => String(t ?? '').trim()).filter(Boolean)
      : [];

    cards.push({
      question,
      answer,
      explanation: card.explanation ? String(card.explanation) : null,
      tags: tags.length ? JSON.stringify(tags) : null,
      source_ref: card.source_ref ? String(card.source_ref) : null,
    });
  }
  return { valid: true, cards };
}

/**
 * @param {object} args { deck_id, cards: [{ question, answer, explanation?, tags?, source_ref? }] }
 * @param {object} options.state Shared Blackboard (a Promise, per CLI convention)
 */
export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'bulk_add_cards: plugin state unavailable' };
  }

  const deckId = Number(args.deck_id);
  if (!Number.isInteger(deckId) || deckId < 1) {
    return { success: false, output: 'bulk_add_cards: `deck_id` must be a positive integer' };
  }

  const deckRows = state.query('SELECT id, name, archived FROM decks WHERE id = ?', [deckId]);
  if (deckRows.length === 0) {
    return { success: false, output: `bulk_add_cards: no deck with id ${deckId}. Call create_deck first.` };
  }
  const deck = deckRows[0];
  if (Number(deck.archived) === 1) {
    return {
      success: false,
      output: `bulk_add_cards: deck "${deck.name}" is archived — unarchive it before adding cards.`,
    };
  }

  const checked = validateCards(args.cards);
  if (!checked.valid) {
    return { success: false, output: `bulk_add_cards: ${checked.error}` };
  }

  const now = new Date().toISOString();
  const cardIds = [];

  // A brand-new card is due immediately: never reviewed, no interval, the
  // default 2.5 ease factor. The INSERT states those explicitly rather than
  // leaning on column defaults, so the row is the same on any backend.
  for (const card of checked.cards) {
    const info = state.query(
      'INSERT INTO cards(deck_id, question, answer, explanation, tags, source_ref, '
        + 'ease_factor, interval_days, due_at, reps, lapses, created_at, updated_at) '
        + 'VALUES(?, ?, ?, ?, ?, ?, 2.5, 0, ?, 0, 0, ?, ?)',
      [
        deckId,
        card.question,
        card.answer,
        card.explanation,
        card.tags,
        card.source_ref,
        now,
        now,
        now,
      ],
    );
    cardIds.push(Number(info.lastInsertRowid));
  }

  const total = Number(state.query('SELECT COUNT(*) AS n FROM cards WHERE deck_id = ?', [deckId])[0]?.n || 0);
  state.patch('study_progress', {
    active_deck: deck.name,
    deck_id: deckId,
    due_now: Number(state.query('SELECT COUNT(*) AS n FROM cards WHERE deck_id = ? AND due_at <= ?', [deckId, now])[0]?.n || 0),
    new_cards: Number(state.query('SELECT COUNT(*) AS n FROM cards WHERE deck_id = ? AND reps = 0', [deckId])[0]?.n || 0),
    updated_at: now,
  });
  state.append('study_log', {
    event: 'cards_added',
    deck_id: deckId,
    deck: deck.name,
    added: cardIds.length,
    at: now,
  });

  return {
    success: true,
    output: {
      deck_id: deckId,
      added: cardIds.length,
      card_ids: cardIds,
      cards_in_deck: total,
    },
  };
}

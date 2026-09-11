/**
 * get_study_stats — summarise cards, backlog and review history.
 *
 * Authored rather than generated: the generated state tools return rows, and
 * this returns a verdict. Counting what is due, what has never been seen, the
 * rating mix and retention is the difference between "here is your table" and
 * "here is where you stand".
 *
 * Every query is built from the same two condition arrays so the deck filter
 * cannot be silently dropped out of one of them.
 */

export const name = 'get_study_stats';
export const description = 'Summarise cards, backlog and review history';

/** A pass is anything graded 3 or above — the same line `schedule` uses. */
const PASS_RATING = 3;

/**
 * @param {object} args { deck_id? }
 * @param {object} options.state Shared Blackboard (a Promise, per CLI convention)
 */
export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'get_study_stats: plugin state unavailable' };
  }

  let deckId = null;
  const rawDeckId = args.deck_id;
  if (rawDeckId !== undefined && rawDeckId !== null && rawDeckId !== '') {
    deckId = Number(rawDeckId);
    if (!Number.isInteger(deckId) || deckId < 1) {
      return { success: false, output: 'get_study_stats: `deck_id` must be a positive integer' };
    }
    if (state.query('SELECT id FROM decks WHERE id = ?', [deckId]).length === 0) {
      return { success: false, output: `get_study_stats: no deck with id ${deckId}.` };
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const weekIso = new Date(now.getTime() + 7 * 86400000).toISOString();
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const midnightIso = midnight.toISOString();

  const count = (sql, params = []) => Number(state.query(sql, params)[0]?.n || 0);

  const cardConds = [];
  const cardArgs = [];
  if (deckId) {
    cardConds.push('deck_id = ?');
    cardArgs.push(deckId);
  }
  const cardWhere = (extra = [], extraArgs = []) => {
    const conds = [...cardConds, ...extra];
    return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', args: [...cardArgs, ...extraArgs] };
  };

  const reviewConds = [];
  const reviewArgs = [];
  if (deckId) {
    reviewConds.push('card_id IN (SELECT id FROM cards WHERE deck_id = ?)');
    reviewArgs.push(deckId);
  }
  const reviewWhere = (extra = [], extraArgs = []) => {
    const conds = [...reviewConds, ...extra];
    return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', args: [...reviewArgs, ...extraArgs] };
  };

  const all = cardWhere();
  const due = cardWhere(['due_at <= ?'], [nowIso]);
  const dueWeek = cardWhere(['due_at > ?', 'due_at <= ?'], [nowIso, weekIso]);
  const unseen = cardWhere(['reps = 0']);
  const seen = cardWhere(['reps > 0']);
  const lapsed = cardWhere(['lapses > 0']);

  const reviewsAll = reviewWhere();
  const reviewsPassed = reviewWhere([`rating >= ${PASS_RATING}`]);
  const reviewsToday = reviewWhere(['reviewed_at >= ?'], [midnightIso]);

  const cardsTotal = count(`SELECT COUNT(*) AS n FROM cards ${all.sql}`, all.args);
  const reviewsTotal = count(`SELECT COUNT(*) AS n FROM reviews ${reviewsAll.sql}`, reviewsAll.args);
  const reviewsPassedTotal = count(`SELECT COUNT(*) AS n FROM reviews ${reviewsPassed.sql}`, reviewsPassed.args);

  const avgRow = state.query(`SELECT AVG(ease_factor) AS a FROM cards ${all.sql}`, all.args)[0];
  const averageEase = Number(avgRow?.a);

  const byRating = state.query(
    `SELECT rating, COUNT(*) AS n FROM reviews ${reviewsAll.sql} GROUP BY rating ORDER BY rating`,
    reviewsAll.args,
  );
  const lastRow = state.query(`SELECT MAX(reviewed_at) AS t FROM reviews ${reviewsAll.sql}`, reviewsAll.args)[0];

  const decks = deckId ? 1 : count('SELECT COUNT(*) AS n FROM decks WHERE archived = 0');

  return {
    success: true,
    output: {
      deck_id: deckId,
      decks,
      cards: cardsTotal,
      due_now: count(`SELECT COUNT(*) AS n FROM cards ${due.sql}`, due.args),
      due_this_week: count(`SELECT COUNT(*) AS n FROM cards ${dueWeek.sql}`, dueWeek.args),
      new_cards: count(`SELECT COUNT(*) AS n FROM cards ${unseen.sql}`, unseen.args),
      seen_cards: count(`SELECT COUNT(*) AS n FROM cards ${seen.sql}`, seen.args),
      lapsed_cards: count(`SELECT COUNT(*) AS n FROM cards ${lapsed.sql}`, lapsed.args),
      average_ease_factor: Number.isFinite(averageEase) ? Math.round(averageEase * 100) / 100 : null,
      reviews: reviewsTotal,
      passed_reviews: reviewsPassedTotal,
      reviewed_today: count(`SELECT COUNT(*) AS n FROM reviews ${reviewsToday.sql}`, reviewsToday.args),
      // Null rather than 0 or 100 when nothing has been reviewed: an
      // untouched deck has no retention rate, and reporting one is a lie.
      retention_pct: reviewsTotal ? Math.round((reviewsPassedTotal / reviewsTotal) * 100) : null,
      reviews_by_rating: byRating.map(r => ({ rating: Number(r.rating), count: Number(r.n) })),
      last_reviewed_at: lastRow?.t ?? null,
    },
  };
}

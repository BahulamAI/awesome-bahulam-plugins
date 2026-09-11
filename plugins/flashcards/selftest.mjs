/**
 * Offline smoke test for the flashcards plugin.
 * Run: node plugins/flashcards/selftest.mjs
 *
 * The write handlers issue real SQL against the tables this plugin declares in
 * `config.state.tables`, so the stateful cases run against node:sqlite in
 * :memory: — the same backend the CLI uses for a plugin's state.db. On a Node
 * build without node:sqlite the DB-backed cases are skipped and the pure
 * schedule/marking logic still runs.
 *
 * This file deliberately does NOT import the CLI's state module: a plugin in
 * this repo has to stand alone. makeFakeState() below mirrors the public shape
 * of the proxy the CLI injects (`get/set/patch/append/list/query`), and
 * DECLARED_DDL mirrors the DDL the CLI derives from config.state.tables —
 * kept in sync by hand, so if it drifts the assertions below fail loudly.
 */

import { call as createDeck, deckKey } from './tools/create-deck.mjs';
import { call as bulkAddCards, validateCards, MAX_BATCH } from './tools/bulk-add-cards.mjs';
import { call as recordReview, schedule, currentStreak, MIN_EASE, MAX_INTERVAL_DAYS } from './tools/record-review.mjs';
import { call as resetCard, NEW_EASE } from './tools/reset-card.mjs';
import { call as updateDeck } from './tools/update-deck.mjs';
import { call as getStudyStats } from './tools/get-study-stats.mjs';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch { /* Node < 22.5 — stateful cases skip */ }

let failures = 0;
function check(label, cond, detail = '') {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

// The DDL the CLI derives from config.state.tables.
const DECLARED_DDL = `
  CREATE TABLE decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL DEFAULT 'topic',
    source_ref TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX decks_name_idx ON decks(name);
  CREATE TABLE cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL REFERENCES decks(id),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    explanation TEXT,
    tags TEXT,
    source_ref TEXT,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_rating INTEGER,
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX cards_deck_id_idx ON cards(deck_id);
  CREATE INDEX cards_due_at_idx ON cards(due_at);
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id),
    rating INTEGER NOT NULL,
    previous_interval_days INTEGER NOT NULL,
    new_interval_days INTEGER NOT NULL,
    previous_ease_factor REAL NOT NULL,
    new_ease_factor REAL NOT NULL,
    response_time_ms INTEGER,
    note TEXT,
    reviewed_at TEXT NOT NULL
  );
  CREATE INDEX reviews_card_id_idx ON reviews(card_id);
`;

/** Minimal stand-in for the CLI's per-plugin state proxy. */
function makeFakeState() {
  const db = new DatabaseSync(':memory:');
  db.exec(DECLARED_DDL);
  const kv = new Map();
  const records = [];
  let nextId = 1;
  return {
    get(key, fallback = null) {
      return kv.has(String(key)) ? JSON.parse(kv.get(String(key))) : fallback;
    },
    set(key, value) {
      kv.set(String(key), JSON.stringify(value));
      return value;
    },
    patch(key, partial) {
      const current = kv.has(String(key)) ? JSON.parse(kv.get(String(key))) : null;
      const next = current && typeof current === 'object' && !Array.isArray(current)
        ? { ...current, ...partial }
        : { ...partial };
      kv.set(String(key), JSON.stringify(next));
      return next;
    },
    append(stream, payload) {
      const row = { id: nextId++, stream: String(stream), payload, created_at: new Date(0).toISOString() };
      records.push(row);
      return row.id;
    },
    list(stream, { limit = 50, order = 'desc' } = {}) {
      const rows = records.filter(r => r.stream === String(stream));
      const ordered = order === 'asc' ? rows : [...rows].reverse();
      return ordered.slice(0, limit);
    },
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      const args = Array.isArray(params) ? params : [params];
      if (String(sql).trim().slice(0, 6).toUpperCase() === 'SELECT') return stmt.all(...args);
      const info = stmt.run(...args);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    close() { db.close(); },
  };
}

/** Every case gets a clean DB, so no test can depend on another's ordering. */
async function withState(fn) {
  const state = makeFakeState();
  try {
    return await fn(state, { state: Promise.resolve(state) });
  } finally {
    state.close();
  }
}

// ── Pure logic, no state needed ──────────────────────────────────────
{
  check('deckKey folds case and collapses whitespace', deckKey('  HTTP   Caching ') === 'http caching');
  check('deckKey treats two spellings as one deck', deckKey('HTTP Caching') === deckKey('http  caching'));

  check('validateCards rejects a non-array', validateCards('nope').valid === false);
  check('validateCards rejects an empty batch', validateCards([]).valid === false);
  check('validateCards rejects a missing answer', validateCards([{ question: 'q' }]).valid === false);
  check('validateCards rejects a blank question', validateCards([{ question: '   ', answer: 'a' }]).valid === false);
  check('validateCards enforces the batch cap',
    validateCards(new Array(MAX_BATCH + 1).fill({ question: 'q', answer: 'a' })).valid === false);
  check('validateCards serializes tags as JSON',
    validateCards([{ question: 'q', answer: 'a', tags: ['x', ' y '] }]).cards[0].tags === '["x","y"]');
  check('validateCards drops an empty tag list to null',
    validateCards([{ question: 'q', answer: 'a', tags: [] }]).cards[0].tags === null);

  // The SM-2 ladder: 1 day, then 6, then interval x ease.
  const fresh = { ease_factor: 2.5, interval_days: 0, reps: 0, lapses: 0 };
  const firstPass = schedule(4, fresh);
  check('schedule: first pass is one day', firstPass.interval_days === 1 && firstPass.reps === 1, JSON.stringify(firstPass));
  check('schedule: a "good" grade holds the ease factor', firstPass.ease_factor === 2.5, String(firstPass.ease_factor));

  const secondPass = schedule(4, firstPass);
  check('schedule: second pass is six days', secondPass.interval_days === 6, JSON.stringify(secondPass));

  const thirdPass = schedule(4, secondPass);
  check('schedule: third pass multiplies by the ease factor', thirdPass.interval_days === 15, JSON.stringify(thirdPass));

  const easyPass = schedule(5, thirdPass);
  check('schedule: an "easy" grade raises the ease factor', easyPass.ease_factor === 2.6, String(easyPass.ease_factor));
  check('schedule: the interval uses the OLD ease factor', easyPass.interval_days === 38, JSON.stringify(easyPass));

  const hardPass = schedule(3, thirdPass);
  check('schedule: a "hard" grade lowers the ease factor', hardPass.ease_factor === 2.36, String(hardPass.ease_factor));

  const lapsed = schedule(0, easyPass);
  check('schedule: a failure returns to one day', lapsed.interval_days === 1);
  check('schedule: a failure resets reps and counts a lapse',
    lapsed.reps === 0 && lapsed.lapses === easyPass.lapses + 1);
  check('schedule: a failure costs 0.2 of ease factor', lapsed.ease_factor === 2.4, String(lapsed.ease_factor));

  check('schedule: the ease factor floors at 1.3',
    schedule(0, { ease_factor: 1.4, interval_days: 10, reps: 3, lapses: 1 }).ease_factor === MIN_EASE);
  check('schedule: the ease factor cannot sink below the floor on repeat failures',
    schedule(1, { ease_factor: MIN_EASE, interval_days: 10, reps: 3, lapses: 9 }).ease_factor === MIN_EASE);
  check('schedule: the interval is capped',
    schedule(4, { ease_factor: 2.5, interval_days: 3000, reps: 5, lapses: 0 }).interval_days === MAX_INTERVAL_DAYS);
}

// ── Everything below needs real SQL ──────────────────────────────────
if (!DatabaseSync) {
  console.log('\nSKIP stateful cases — node:sqlite unavailable on this Node build');
} else {
  // Building a deck and filling it.
  await withState(async (state, opts) => {
    const deck = await createDeck({ name: 'HTTP caching', source_type: 'topic' }, opts);
    check('create_deck creates a deck', deck.success && deck.output.deck_id === 1, JSON.stringify(deck.output));
    check('create_deck makes the deck active', state.get('study_progress')?.active_deck === 'HTTP caching');
    check('create_deck logs the event', state.list('study_log')[0].payload.event === 'deck_created');
    check('create_deck rejects a duplicate name case-insensitively',
      (await createDeck({ name: 'http  caching' }, opts)).success === false);
    check('create_deck requires a name', (await createDeck({}, opts)).success === false);
    check('create_deck rejects an unknown source_type',
      (await createDeck({ name: 'other', source_type: 'guess' }, opts)).success === false);

    check('bulk_add_cards rejects an unknown deck',
      (await bulkAddCards({ deck_id: 99, cards: [{ question: 'q', answer: 'a' }] }, opts)).success === false);
    check('bulk_add_cards rejects a malformed card',
      (await bulkAddCards({ deck_id: 1, cards: [{ question: 'q' }] }, opts)).success === false);
    check('bulk_add_cards writes nothing when the batch is invalid',
      Number(state.query('SELECT COUNT(*) AS n FROM cards')[0].n) === 0);

    const added = await bulkAddCards({
      deck_id: 1,
      cards: [
        { question: 'What does Cache-Control: no-store forbid?', answer: 'Storing the response.', tags: ['headers', 'caching'] },
        { question: 'Which status code means Not Modified?', answer: '304' },
      ],
    }, opts);
    check('bulk_add_cards inserts every card', added.success && added.output.added === 2, JSON.stringify(added.output));
    check('bulk_add_cards reports the deck total', added.output.cards_in_deck === 2);
    check('bulk_add_cards stores tags as JSON',
      JSON.parse(state.query('SELECT tags FROM cards WHERE id = ?', [added.output.card_ids[0]])[0].tags).includes('caching'));
    check('bulk_add_cards leaves the cards unseen',
      state.query('SELECT reps FROM cards')[0].reps === 0);
    check('bulk_add_cards logs one event for the batch',
      state.list('study_log')[0].payload.event === 'cards_added'
      && state.list('study_log')[0].payload.added === 2);

    const cardId = added.output.card_ids[0];

    check('record_review rejects an out-of-range rating',
      (await recordReview({ card_id: cardId, rating: 9 }, opts)).success === false);
    check('record_review rejects an unknown card',
      (await recordReview({ card_id: 999, rating: 4 }, opts)).success === false);

    const review1 = await recordReview({ card_id: cardId, rating: 4, response_time_ms: 4200 }, opts);
    check('record_review moves the due date into the future',
      new Date(review1.output.due_at).getTime() > Date.now());
    check('record_review writes the review row', Number(state.query('SELECT COUNT(*) AS n FROM reviews')[0].n) === 1);
    check('record_review keeps the history honest',
      Number(state.query('SELECT previous_interval_days, new_interval_days FROM reviews')[0].new_interval_days) === 1);
    check('record_review counts the streak', currentStreak(state) === 1 && state.get('study_progress').streak === 1);
    check('record_review logs a pass', state.list('study_log')[0].payload.event === 'reviewed_passed');

    const review2 = await recordReview({ card_id: cardId, rating: 5 }, opts);
    check('record_review steps the second pass to six days', review2.output.interval_days === 6, JSON.stringify(review2.output));

    const failed = await recordReview({ card_id: cardId, rating: 1 }, opts);
    check('record_review sends a failed card back to one day', failed.output.interval_days === 1);
    check('record_review zeroes the streak after a failure', failed.output.due_now >= 0 && currentStreak(state) === 0);
    check('record_review logs a failure', state.list('study_log')[0].payload.event === 'reviewed_failed');

    const reset = await resetCard({ card_id: cardId }, opts);
    check('reset_card restores the brand-new schedule',
      reset.success && reset.output.ease_factor === NEW_EASE && reset.output.interval_days === 0);
    check('reset_card keeps the review history', reset.output.reviews_kept === 3, String(reset.output.reviews_kept));
    check('reset_card clears the last rating',
      state.query('SELECT last_rating FROM cards WHERE id = ?', [cardId])[0].last_rating === null);
    check('reset_card rejects an unknown card', (await resetCard({ card_id: 999 }, opts)).success === false);

    const stats = await getStudyStats({}, opts);
    check('get_study_stats counts the bank', stats.output.cards === 2);
    check('get_study_stats counts every review', stats.output.reviews === 3);
    check('get_study_stats reports retention', stats.output.retention_pct === 67, String(stats.output.retention_pct));
    check('get_study_stats reports the rating mix',
      JSON.stringify(stats.output.reviews_by_rating) === JSON.stringify([{ rating: 1, count: 1 }, { rating: 4, count: 1 }, { rating: 5, count: 1 }]),
      JSON.stringify(stats.output.reviews_by_rating));
    check('get_study_stats counts both cards as unseen after the reset', stats.output.new_cards === 2);
    check('get_study_stats reports the backlog', stats.output.due_now === 2);
    check('get_study_stats counts one active deck', stats.output.decks === 1);
    check('get_study_stats averages the ease factor', stats.output.average_ease_factor === 2.5);
    check('get_study_stats carries a last-reviewed timestamp', typeof stats.output.last_reviewed_at === 'string');
    check('get_study_stats rejects an unknown deck', (await getStudyStats({ deck_id: 99 }, opts)).success === false);
    check('get_study_stats scopes to a deck', (await getStudyStats({ deck_id: 1 }, opts)).output.cards === 2);
  });

  // Archiving: the reason the tool exists is that an archived deck must stop
  // accepting new cards and stop appearing in the active list.
  await withState(async (state, opts) => {
    await createDeck({ name: 'Temporary' }, opts);
    await bulkAddCards({ deck_id: 1, cards: [{ question: 'q', answer: 'a' }] }, opts);

    const renamed = await updateDeck({ deck_id: 1, name: 'Kept', description: 'renamed' }, opts);
    check('update_deck renames a deck', renamed.success && renamed.output.name === 'Kept', JSON.stringify(renamed.output));
    check('update_deck rejects an empty change set', (await updateDeck({ deck_id: 1 }, opts)).success === false);
    check('update_deck rejects an unknown deck', (await updateDeck({ deck_id: 9, name: 'x' }, opts)).success === false);
    check('update_deck rejects an invalid archived flag', (await updateDeck({ deck_id: 1, archived: 5 }, opts)).success === false);

    const archived = await updateDeck({ deck_id: 1, archived: 1 }, opts);
    check('update_deck archives a deck', archived.success && archived.output.archived === 1);
    check('update_deck logs the archive', state.list('study_log')[0].payload.event === 'deck_archived');
    check('an archived deck refuses new cards',
      (await bulkAddCards({ deck_id: 1, cards: [{ question: 'q2', answer: 'a2' }] }, opts)).success === false);
    check('an archived deck keeps its cards',
      Number(state.query('SELECT COUNT(*) AS n FROM cards WHERE deck_id = 1')[0].n) === 1);
    check('archiving leaves the deck out of the active list',
      state.query('SELECT COUNT(*) AS n FROM decks WHERE archived = 0')[0].n === 0);
  });

  // Every handler must fail cleanly when the CLI injects no state handle.
  {
    const tools = [
      ['create_deck', createDeck, { name: 'x' }],
      ['bulk_add_cards', bulkAddCards, { deck_id: 1, cards: [{ question: 'q', answer: 'a' }] }],
      ['record_review', recordReview, { card_id: 1, rating: 4 }],
      ['reset_card', resetCard, { card_id: 1 }],
      ['update_deck', updateDeck, { deck_id: 1, name: 'x' }],
      ['get_study_stats', getStudyStats, {}],
    ];
    for (const [label, fn, args] of tools) {
      const result = await fn(args, {});
      check(`${label} reports a missing state handle`, result.success === false && typeof result.output === 'string');
    }
  }
}

console.log(failures === 0 ? '\nALL FLASHCARDS SELFTESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

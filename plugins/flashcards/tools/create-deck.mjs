/**
 * create_deck — create a deck and make it the active one.
 *
 * Decks are the unit the learner thinks in, and the foreign key every card
 * hangs off, so this is the first write in any build. The name is the
 * natural key (case-insensitively unique) because asking a human to remember
 * a numeric deck id is a reliable way to end up with three decks called
 * "biology".
 *
 * `deckKey` is exported so selftest.mjs can pin the comparison rule without
 * standing up a state DB.
 */

export const name = 'create_deck';
export const description = 'Create a deck and make it the active one';

/**
 * The canonical form deck names are compared on, so "HTTP Caching" and
 * "http  caching" resolve to the same deck instead of two.
 */
export function deckKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const SOURCE_TYPES = new Set(['topic', 'document', 'mixed']);
const MAX_NAME_LENGTH = 120;

/**
 * @param {object} args { name, description?, source_type?, source_ref? }
 * @param {object} options.state Shared Blackboard (a Promise, per CLI convention)
 */
export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'create_deck: plugin state unavailable' };
  }

  const deckName = String(args.name ?? '').trim();
  if (!deckName) {
    return { success: false, output: 'create_deck: `name` is required' };
  }
  if (deckName.length > MAX_NAME_LENGTH) {
    return { success: false, output: `create_deck: \`name\` is too long (max ${MAX_NAME_LENGTH} characters)` };
  }

  const sourceType = args.source_type === undefined || args.source_type === null || args.source_type === ''
    ? 'topic'
    : String(args.source_type).trim().toLowerCase();
  if (!SOURCE_TYPES.has(sourceType)) {
    return {
      success: false,
      output: `create_deck: \`source_type\` must be one of ${[...SOURCE_TYPES].join(', ')}`,
    };
  }

  // Compared in JS rather than with COLLATE NOCASE so the rule is the same
  // one selftest.mjs pins, and so it still holds on a backend with different
  // collation defaults.
  const wanted = deckKey(deckName);
  const clash = state.query('SELECT id, name FROM decks').find(row => deckKey(row.name) === wanted);
  if (clash) {
    return {
      success: false,
      output: `create_deck: a deck named "${clash.name}" already exists (id ${clash.id}). `
        + 'Add cards to it instead, or pick a different name.',
    };
  }

  const now = new Date().toISOString();
  const info = state.query(
    'INSERT INTO decks(name, description, source_type, source_ref, archived, created_at, updated_at) '
      + 'VALUES(?, ?, ?, ?, 0, ?, ?)',
    [
      deckName,
      args.description ? String(args.description) : null,
      sourceType,
      args.source_ref ? String(args.source_ref) : null,
      now,
      now,
    ],
  );
  const deckId = Number(info.lastInsertRowid);

  state.set('study_progress', {
    active_deck: deckName,
    deck_id: deckId,
    due_now: 0,
    new_cards: 0,
    streak: 0,
    updated_at: now,
  });
  state.append('study_log', {
    event: 'deck_created',
    deck_id: deckId,
    deck: deckName,
    source_type: sourceType,
    at: now,
  });

  return {
    success: true,
    output: {
      deck_id: deckId,
      name: deckName,
      description: args.description ? String(args.description) : null,
      source_type: sourceType,
      source_ref: args.source_ref ? String(args.source_ref) : null,
      cards: 0,
      created_at: now,
    },
  };
}

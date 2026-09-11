/**
 * update_deck — rename, re-describe or archive a deck.
 *
 * Archive rather than delete: a deck that has been studied is a record of
 * the learner's work, and the reason to put it away is clutter, not regret.
 * An archived deck keeps its cards and its review history and simply drops
 * out of the study queue.
 *
 * The name-uniqueness rule is imported from create-deck rather than restated,
 * because two copies of "what counts as the same deck name" is exactly how a
 * rename quietly creates a duplicate.
 */

import { deckKey } from './create-deck.mjs';

export const name = 'update_deck';
export const description = 'Rename, re-describe or archive a deck';

const MAX_NAME_LENGTH = 120;

/**
 * @param {object} args { deck_id, name?, description?, archived? }
 * @param {object} options.state Shared Blackboard (a Promise, per CLI convention)
 */
export async function call(args = {}, options = {}) {
  const state = options.state ? await options.state : null;
  if (!state) {
    return { success: false, output: 'update_deck: plugin state unavailable' };
  }

  const deckId = Number(args.deck_id);
  if (!Number.isInteger(deckId) || deckId < 1) {
    return { success: false, output: 'update_deck: `deck_id` must be a positive integer' };
  }

  const rows = state.query('SELECT id, name, archived FROM decks WHERE id = ?', [deckId]);
  if (rows.length === 0) {
    return { success: false, output: `update_deck: no deck with id ${deckId}.` };
  }
  const deck = rows[0];

  const sets = [];
  const params = [];
  const changes = {};

  if (args.name !== undefined && args.name !== null && String(args.name).trim()) {
    const nextName = String(args.name).trim();
    if (nextName.length > MAX_NAME_LENGTH) {
      return { success: false, output: `update_deck: \`name\` is too long (max ${MAX_NAME_LENGTH} characters)` };
    }
    const wanted = deckKey(nextName);
    const clash = state.query('SELECT id, name FROM decks WHERE id != ?', [deckId])
      .find(row => deckKey(row.name) === wanted);
    if (clash) {
      return {
        success: false,
        output: `update_deck: a deck named "${clash.name}" already exists (id ${clash.id}).`,
      };
    }
    sets.push('name = ?');
    params.push(nextName);
    changes.name = nextName;
  }

  if (args.description !== undefined) {
    const description = args.description === null || String(args.description).trim() === ''
      ? null
      : String(args.description);
    sets.push('description = ?');
    params.push(description);
    changes.description = description;
  }

  if (args.archived !== undefined && args.archived !== null && args.archived !== '') {
    const archived = Number(args.archived);
    if (archived !== 0 && archived !== 1) {
      return { success: false, output: 'update_deck: `archived` must be 0 or 1' };
    }
    sets.push('archived = ?');
    params.push(archived);
    changes.archived = archived;
  }

  // Rejecting an empty update rather than bumping updated_at for nothing: a
  // no-op write would invalidate the panel's cache and look like progress.
  if (!sets.length) {
    return {
      success: false,
      output: 'update_deck: nothing to change — pass `name`, `description` or `archived`.',
    };
  }

  const now = new Date().toISOString();
  sets.push('updated_at = ?');
  params.push(now);
  state.query(`UPDATE decks SET ${sets.join(', ')} WHERE id = ?`, [...params, deckId]);

  state.append('study_log', {
    event: changes.archived === 1 ? 'deck_archived' : 'deck_updated',
    deck_id: deckId,
    deck: changes.name ?? deck.name,
    at: now,
  });

  return {
    success: true,
    output: {
      deck_id: deckId,
      name: changes.name ?? deck.name,
      archived: changes.archived ?? Number(deck.archived),
      updated_at: now,
      changed: Object.keys(changes),
    },
  };
}

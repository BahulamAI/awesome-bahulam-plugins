# flashcards

Turns a document or a bare topic into flashcards, then keeps them reviewable.

Cards live in the plugin's own SQLite state with an SM-2 schedule — ease
factor, interval, due date — so *what is due today* is a query rather than a
note. A new session opens already knowing the active deck, the backlog and the
streak, with no re-importing and no re-teaching.

## Install

```bash
bahulam install https://github.com/BahulamAI/awesome-bahulam-plugins --subdir plugins/flashcards
bahulam info flashcards
```

## Quickstart

From a topic:

> make me flashcards on HTTP caching

From a document:

> build a deck from ~/notes/http-caching.md

The tutor reads the document, hands the material to the `card-generator`
sub-agent, and writes the result through `bulk_add_cards`. Then:

> what's due?

## How generation works

There is no document-ingestion tool. Both sources end in the same place:

1. **Topic** — the entry agent agrees a scope, then delegates the topic to
   `card-generator`.
2. **Document** — the entry agent reads it with the built-in `read_file`,
   then delegates the relevant material to `card-generator`.
3. `card-generator` checks the existing bank with `list_cards` so it does not
   duplicate what is already there, drafts atomic cards, and writes them in
   one `bulk_add_cards` call.

File reading stays in the built-in tool, which already owns path handling and
permissions, instead of being re-implemented inside the plugin.

## Tools

### `create_deck`

```json
{ "name": "HTTP caching", "source_type": "topic" }
```

```json
{ "deck_id": 1, "name": "HTTP caching", "source_type": "topic", "cards": 0 }
```

Names are unique case-insensitively, so `HTTP Caching` and `http  caching`
collide rather than becoming two decks.

### `bulk_add_cards`

```json
{
  "deck_id": 1,
  "cards": [
    { "question": "What does Cache-Control: no-store forbid?", "answer": "Storing the response.", "tags": ["headers"] },
    { "question": "Which status code means Not Modified?", "answer": "304" }
  ]
}
```

```json
{ "deck_id": 1, "added": 2, "card_ids": [1, 2], "cards_in_deck": 2 }
```

The whole batch is validated before the first write, and the batch cap is 200.
A malformed batch writes nothing rather than half-importing.

### `record_review`

```json
{ "card_id": 1, "rating": 4, "response_time_ms": 4200 }
```

```json
{ "card_id": 1, "rating": 4, "passed": true, "interval_days": 6, "ease_factor": 2.5, "due_at": "2026-08-30T10:14:02.771Z" }
```

### `reset_card`

```json
{ "card_id": 1 }
```

```json
{ "card_id": 1, "ease_factor": 2.5, "interval_days": 0, "reviews_kept": 3 }
```

For a card that is *wrong*, not one that was forgotten. Review history is kept.

### `update_deck`

```json
{ "deck_id": 1, "name": "HTTP caching (RFC 9111)", "archived": 0 }
```

```json
{ "deck_id": 1, "name": "HTTP caching (RFC 9111)", "archived": 0, "changed": ["name"] }
```

Archiving keeps the cards and the history and just drops the deck out of the
study queue.

### `get_study_stats`

```json
{ "deck_id": 1 }
```

```json
{
  "deck_id": 1, "cards": 24, "due_now": 7, "due_this_week": 15,
  "new_cards": 5, "seen_cards": 19, "lapsed_cards": 3,
  "average_ease_factor": 2.41, "reviews": 61, "passed_reviews": 52,
  "reviewed_today": 12, "retention_pct": 85,
  "reviews_by_rating": [{ "rating": 0, "count": 3 }, { "rating": 4, "count": 40 }, { "rating": 5, "count": 12 }]
}
```

`retention_pct` is `null`, not `0`, when nothing has been reviewed — an
untouched deck has no retention rate.

### Generated read-only tools

The manifest declares four tools the CLI synthesizes from the schema, so the
agent can inspect state without a handler module per question:
`list_decks`, `list_cards`, `list_due_cards`, `list_reviews`. A filter is
applied only when its argument is supplied, so omitting `as_of` from
`list_due_cards` lists the whole bank rather than returning nothing.

## Rating semantics

- `0`–`2` — failed recall. A **lapse**: interval back to 1 day, ease factor
  down by 0.2, lapse counter incremented.
- `3` — hard. Interval still grows; ease factor falls.
- `4` — good. Interval grows; ease factor holds.
- `5` — easy. Interval grows; ease factor rises.

The interval uses the **old** ease factor and only then is the ease factor
updated — the canonical SM-2 order. The first two passes are fixed at 1 day
and 6 days; after that the interval is `round(previous × ease)`, capped at
3650 days, and the ease factor never drops below 1.3.

## State schema

- `decks` — `id`, `name` (unique), `description`, `source_type`,
  `source_ref`, `archived`, timestamps.
- `cards` — `id`, `deck_id`, `question`, `answer`, `explanation`, `tags`,
  `source_ref`, plus the schedule: `ease_factor`, `interval_days`, `due_at`,
  `reps`, `lapses`, `last_rating`, `last_reviewed_at`.
- `reviews` — immutable history: the rating, the interval and ease factor
  before and after, response time, and a note.

The schedule lives on the card so "what is due" is one indexed scan rather
than a join per question; `reviews` is the ledger that makes "why is this card
at 34 days?" answerable.

## Workspace panel

`Flashcards` renders as a central-panel tab: the flip surface (reveal, then
Again / Hard / Good / Easy), the deck browser, the due queue, the aggregate
progress tiles and the live `study_log`. It reads the same `state.db` the
tutor writes to and repaints over SSE whenever the agent grades a card in the
chat.

## Selftest

```bash
node plugins/flashcards/selftest.mjs
```

Runs the SM-2 ladder, the batch validation rules and the full tool flow
against `node:sqlite` in `:memory:`, using a stand-in for the CLI's state
proxy. The plugin never imports the CLI. On a Node build without
`node:sqlite` the stateful cases skip and the pure schedule logic still runs.

## Security

No credentials, no network access, no remote code. Every write binds
positional parameters; the only author-supplied SQL is the predicate fragment
declared in `config.state.context_tools.where`, which the CLI validates
against the plugin's own declared tables.

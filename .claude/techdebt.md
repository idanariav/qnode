# Tech Debt / Future Work

Running log of deferred refactors, follow-ups, and "do it properly later"
items surfaced during work sessions but intentionally **not** scheduled or
executed at the time. This is a reference backlog, not a roadmap — nothing
here should be picked up unless explicitly requested in a future session.

When adding an entry: say what it is, why it wasn't done now, and roughly
how big/risky it is. When an item is finally addressed, delete its entry
(git history keeps the record).

## Deleted external nodes are never cleaned up

`indexCollection()`'s deletion pass (added alongside incremental indexing)
only removes in-collection nodes (`collection = col.name`) whose file is
gone from disk. External nodes (`collection = NULL`) are left alone even
if their file is deleted, because the schema doesn't track which
collection(s) reference a given external node — deleting one collection's
view of it could break another collection that still depends on the same
path. A stale external node/edges will linger until something else
touches that path.
Why not done now: safe cleanup needs either a join table (external node →
referencing collections) or a global "does any collection's vault_root
still see this file" sweep across all collections, both bigger than the
in-collection case; the in-collection fix was the unambiguous, safe part
of the incremental-indexing work and this was intentionally left out of
scope.
Size/risk: small-medium — mostly a schema/bookkeeping question, not
algorithmically hard.

## Minor: repeated `collection ? queryA : queryB` branching in store.ts

`status()`, `allMetrics()`, `clearMetrics()`, `loadResolvedEdges()`,
`loadInCollectionNodes()` each hand-roll their own "optionally filter by
collection" branch as two near-duplicate prepared statements. The SQL
differs enough (JOINs, column lists) that a generic helper isn't an
obvious win — flagged for awareness, not necessarily worth doing.
Size/risk: trivial, cosmetic only.
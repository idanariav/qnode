# Tech Debt / Future Work

Running log of deferred refactors, follow-ups, and "do it properly later"
items surfaced during work sessions but intentionally **not** scheduled or
executed at the time. This is a reference backlog, not a roadmap — nothing
here should be picked up unless explicitly requested in a future session.

When adding an entry: say what it is, why it wasn't done now, and roughly
how big/risky it is. When an item is finally addressed, delete its entry
(git history keeps the record).

## Minor: repeated `collection ? queryA : queryB` branching in store.ts

`status()`, `allMetrics()`, `clearMetrics()`, `loadResolvedEdges()`,
`loadInCollectionNodes()` each hand-roll their own "optionally filter by
collection" branch as two near-duplicate prepared statements. The SQL
differs enough (JOINs, column lists) that a generic helper isn't an
obvious win — flagged for awareness, not necessarily worth doing.
Size/risk: trivial, cosmetic only.
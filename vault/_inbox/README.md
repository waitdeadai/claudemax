# _inbox/ — agent-proposed truth, awaiting your bless

`cmax ground export` writes every `status='proposed'` row that has no
`source_path` yet (i.e. appended by an agent during a run, never blessed) into
this directory as a markdown note with `blessed: false`.

This is the human-in-the-loop surface. To accept a proposal:

1. Read the note. Edit it (fix the slug/key, tighten the value, set `scope`,
   set `invariant: true` if it belongs in CLAUDE.md).
2. Set `blessed: true`.
3. Move it to `../decisions/` or `../facts/`.
4. Run `cmax ground compile` to promote it to `accepted`.

Nothing here is trusted until you bless it. Notes are never auto-blessed.
Discard a bad proposal by deleting its note.

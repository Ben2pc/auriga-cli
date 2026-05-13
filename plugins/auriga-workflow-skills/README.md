# auriga-workflow-skills

Bundles the auriga-owned workflow execution skills:

- `incremental-impl`
- `test-designer`
- `session-compound`

These skills used to ship as standalone entries in `skills-lock.json`. They
now travel together as one default-on plugin so the workflow's execution tools
share the same distribution model as the rest of the auriga-owned runtime.

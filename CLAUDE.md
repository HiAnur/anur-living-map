@AGENTS.md

## Keeping agent docs accurate

- If anything in `AGENTS.md` or `.claude/skills/` is wrong or missing, fix it in the same change.
- When you change code that one of them describes (commands, paths, patterns, behaviour), update it in the same change.
- Put each fact in the narrowest place: `AGENTS.md` only for what every task needs; detail for one area goes in a skill (`.claude/skills/<name>/SKILL.md`) that `AGENTS.md` lists.
- Before creating or editing any of them, follow the `maintaining-agent-docs` skill, then run `python3 .github/agent-docs/check.py`.

## Before you finish

- Comments explain why, in the present tense, in a few lines. No dates, names, ticket or PR numbers, or incident stories: those go in the commit message or PR. Refer to docs by skill name, not "see CLAUDE.md".

## `main` is PR-only

- Never commit on `main` or push to it; `.claude/hooks/protect-main.sh` blocks both. Branch first (`git switch -c <branch>`), push the branch, open a PR.
- Every merge to `main` publishes a release that running copies offer as an update, so `main` only moves through a reviewed PR.
- Other sessions may share this working tree. Check `git status` and the current branch before you start, and do not switch branches or reset under someone else's changes.
- After you pull `main` yourself (`git pull`, a rebase), run `npm run skill`: the installed skill is a copy of `skill/SKILL.md`, and the server rewrites it only on its own start or one-click update.

## Pull requests

- Write the PR description in the sections of `.github/pull_request_template.md`; `gh pr create --body` does not apply the template for you.
- Link the GitHub issue (`Fixes #N`); if there is none, write `No issue`.
- Tick every Risk box that applies and say why under it; leave the rest unticked.
- Do not wait for reviews after opening the PR. As your last step, check once for comments from people: `python3 .github/agent-tools/pr_feedback.py list <pr>`. If it lists any, follow the `addressing-pr-reviews` skill.

## Shipping log

- After a product change merges, update `CHANGELOG.md` in a follow-up documentation PR and merge it before finishing. Log-only corrections do not need another entry.
- Use the merge date in America/Los_Angeles. Order days and entries within each day newest first by the verified merge time, keeping changes from the same merge together. Store each entry’s UTC merge time in a hidden `<!-- merged-at: ISO-8601 -->` comment; show dates but no times to readers. Use one short sentence per change, covering the benefit and where to find it when needed. Small fixes get one-line bullets. Omit implementation details, testing notes and repeated captions; add a second sentence only if users need it to use the feature. Link the PR or commit. Update the existing entry for the same change instead of duplicating it on every push.
- Format entries with HTML definition lists: a bold title in `<dt>` and indented content in `<dd>`. Do not put bullet dots beside titles or descriptions. Prefix each categorized title with the emoji and visible category words: `✨ [New feature]`, `🧹 [Layout cleanup]`, or `🚀 [Major feature]`. Reserve Major feature for a substantial capability or workflow. Use at most one emoji per title; fixes outside these categories have none. Do not choose decorative emojis for individual topics. Put descriptions, small fixes and screenshots in the matching `<dd>` so they visibly indent beneath the title.
- The log contains merged changes only. Do not add entries before merge or use Pending labels. Confirm the merge before writing; do not imply that every installed copy has already updated. Verify each entry against the current release, including when backfilling. Omit removed behavior and combine earlier iterations into one description of the workflow users can use today.
- For a significant visual feature or interaction change, attach screenshots under `docs/shipping/` showing where it is and what changed. Prefer before and after views when available; otherwise show the result and briefly describe the previous behavior. Use a sample map without private content. Frame the feature with the nearby context that locates it, such as the selected map box and its right-hand details panel. Do not isolate a field so tightly that readers cannot tell where it lives. Trim unrelated browser chrome and controls, and keep the displayed image compact and readable. Small changes only need text.
- Before finishing, verify the log's claims and image links against the running result. Include the log link in the completion reply for a merged product change. If no entry is warranted, state the reason in the PR.

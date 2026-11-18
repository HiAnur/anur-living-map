@AGENTS.md

## Keeping agent docs accurate

- If anything in `AGENTS.md` or `.claude/skills/` is wrong or missing, fix it in the same change.
- When you change code that one of them describes (commands, paths, patterns, behaviour), update it in the same change.
- Put each fact in the narrowest place: `AGENTS.md` only for what every task needs; detail for one area goes in a skill (`.claude/skills/<name>/SKILL.md`) that `AGENTS.md` lists.
- Before creating or editing any of them, follow the `maintaining-agent-docs` skill, then run `python3 .github/agent-docs/check.py`.

## Before you finish

- Comments explain why, in the present tense, in a few lines. No dates, names, ticket or PR numbers, or incident stories: those go in the commit message or PR. Refer to docs by skill name, not "see CLAUDE.md".

## Every PR goes into `dev`; `main` is only what customers may get

- Branch from `origin/dev` (`git switch -c <branch> origin/dev`) and open every PR with `gh pr create --base dev`. GitHub's default base is `main`, so a PR that names no base lands in the wrong place; `.claude/hooks/protect-main.sh` refuses `gh pr create` without `--base`.
- `main` holds only work that is ready for customers, because every release is cut from it. Work the team is still testing stays on `dev`.
- A fix customers need now is copied to `main` by its own PR, only when the user asks: `git switch -c copy-<name> origin/main`, `git cherry-pick <commit on dev>`, then `gh pr create --base main`. Copy nothing that leans on unfinished work.
- Never commit on `dev` or `main` or push to them; the same hook blocks both. Every merge to `dev` becomes a dev build the team's copies update to within minutes.
- Other sessions may share this working tree. Check `git status` and the current branch before you start, and do not switch branches or reset under someone else's changes.
- After you pull `dev` yourself (`git pull`, a rebase), run `npm run skill`: the installed skill is a copy of `skill/SKILL.md`, and the server rewrites it only on its own start.

## Preview a branch on its own port

- After changing the team map (`team/live`, `team/skill`) in a worktree, run `team/live/preview.sh` from that worktree and give the user the link it prints. Run it again after each later change: it restarts on the same port, so the user's tab keeps working.
- Never start, stop or restart the server on `4323`: it is the user's everyday map, running from their own clone.
- After the branch's PR merges, run `team/live/preview.sh stop` in the worktree before removing it. `team/live/preview.sh list` shows every preview running.

## Pull requests

- Write the PR description in the sections of `.github/pull_request_template.md`; `gh pr create --body` does not apply the template for you.
- Link the GitHub issue (`Fixes #N`); if there is none, write `No issue`.
- Tick every Risk box that applies and say why under it; leave the rest unticked.
- Do not wait for reviews after opening the PR. As your last step, check once for comments from people: `python3 .github/agent-tools/pr_feedback.py list <pr>`. If it lists any, follow the `addressing-pr-reviews` skill.

## Shipping log

- After a customer-visible product change merges, update `CHANGELOG.md` in a follow-up documentation PR and merge it before finishing. Internal maintenance and log-only corrections do not need an entry.
- The log is customer-facing only. Include meaningful capabilities and improvements customers can see or use; omit internal refactors, configuration names, storage paths, developer setup and routine maintenance. Order entries newest first by the verified merge time, keeping changes from the same merge together. Store each entry’s UTC merge time in a hidden `<!-- merged-at: ISO-8601 -->` comment; do not show date headings or timestamps to readers. Use one short sentence per change, covering the benefit and where to find it when needed. Small fixes get one-line bullets. Omit implementation details, testing notes and repeated captions; add a second sentence only if users need it to use the feature. Keep PR or commit links in hidden `<!-- source: URL -->` comments, not in customer copy. Update the existing entry for the same change instead of duplicating it on every push.
- Format entries with HTML definition lists: a bold title in `<dt>` and indented content in `<dd>`. Do not put bullet dots beside titles or descriptions. Prefix each categorized title with the emoji and visible category words: `✨ [New feature]`, `🧹 [Layout cleanup]`, or `🚀 [Major feature]`. Reserve Major feature for a substantial capability or workflow. Use at most one emoji per title; fixes outside these categories have none. Do not choose decorative emojis for individual topics. Put descriptions, small fixes and screenshots in the matching `<dd>` so they visibly indent beneath the title.
- The log contains merged changes only. Do not add entries before merge or use Pending labels. Confirm the merge before writing; do not imply that every installed copy has already updated. Verify each entry against the current release, including when backfilling. Omit removed behavior and combine earlier iterations into one description of the workflow users can use today.
- For a significant visual feature or interaction change, attach screenshots under `docs/shipping/` showing where it is and what changed. Prefer before and after views when available; otherwise show the result and briefly describe the previous behavior. Use a sample map without private content. Frame the feature with the nearby context that locates it, such as the selected map box and its right-hand details panel. Do not isolate a field so tightly that readers cannot tell where it lives. Trim unrelated browser chrome and controls, and keep the displayed image compact and readable. Small changes only need text.
- Before finishing, verify the log's claims and image links against the running result. Include the log link in the completion reply for a merged product change. If no entry is warranted, state the reason in the PR.

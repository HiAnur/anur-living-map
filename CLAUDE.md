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

- Before every push, review the change for the shipping log in `CHANGELOG.md`. Add or update a concise entry for each user-visible feature or fix; group small layout, wording and maintenance changes into one-line bullets. A push that only corrects the log does not need another entry.
- Use the merge date in America/Los_Angeles, newest day first. Say what changed for the person using the app and where to find it, in one or two sentences. Link the PR or commit. Update the existing entry for the same change instead of duplicating it on every push.
- The log contains merged changes only. Do not add entries before merge or use Pending labels. Confirm the merge before writing; do not imply that every installed copy has already updated.
- For a significant visual feature or interaction change, attach screenshots under `docs/shipping/` showing where it is and what changed. Prefer before and after views when available; otherwise show the result and briefly describe the previous behavior. Use a sample map without private content. Frame the feature with the nearby context that locates it, such as the selected map box and its right-hand details panel. Do not isolate a field so tightly that readers cannot tell where it lives. Trim unrelated browser chrome and controls, and keep the displayed image compact and readable. Small changes only need text.
- Before finishing, verify the log's claims and image links against the running result. Include the log link in the completion reply for a merged product change. If no entry is warranted, state the reason in the PR.

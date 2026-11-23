# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `craigmoyle/netballtrials`. Use the `gh` CLI.

## Conventions

- Create issues with `gh issue create`; read them with `gh issue view`; list them with `gh issue list`.
- Use GitHub sub-issues for parent/child work where available.
- Represent blockers with GitHub issue dependencies; otherwise write `Blocked by: #<number>` in the issue.
- Comment, label, and close issues with `gh issue comment`, `gh issue edit`, and `gh issue close`.
- Infer the repository from the Git remote. File issues only in the user’s repository, not the skills source repository.
- When a skill says “publish to the issue tracker,” create a GitHub issue. When it says “fetch the relevant ticket,” read the issue.

## Pull requests as a triage surface

**No.** Pull requests are not treated as issue requests.

## Wayfinding

Use a `wayfinder:map` issue as the map and linked child issues as tickets. Use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` for child issue types. Track blockers with GitHub issue dependencies.

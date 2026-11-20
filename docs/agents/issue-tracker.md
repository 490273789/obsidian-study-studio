# GitHub Issues

Track issues and specs in `490273789/obsidian-study-studio`. Use `gh` from
the repository root. Before creating the first issue in a session, check
the target with `gh repo view --json nameWithOwner`.

- To fetch a ticket and its discussion, use
  `gh issue view <number> --json number,title,body,labels,comments`.
- To publish a spec or ticket, use `gh issue create --title "..." --body-file <file>`.
- Link child tickets using GitHub sub-issues. If unavailable, write
  `Part of #<parent>` at the top of each child ticket.
- Record blockers using GitHub issue dependencies. If unavailable, write
  `Blocked by: #<number>` at the top of the blocked ticket.
  Work can start once every blocker is closed.
- When closing a ticket with an explanation, post the comment before closing it.

PRs as a request surface: no.

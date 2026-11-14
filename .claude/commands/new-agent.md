---
description: Draft a new Claude Code helper in .claude/agents/ (build lane, guide §42.8). Stops for your review.
---
I want a helper that: $ARGUMENTS

1. List `.claude/agents/` and say whether an existing helper already fits. If one does, stop and recommend it.
2. Otherwise draft ONE file `.claude/agents/<kebab-name>.md` with frontmatter (name, description saying when to use it,
   the smallest `tools` list that works) and a short, single-purpose prompt. Prefer read-only tools.
3. Ask the security-reviewer and ai-safety-reviewer subagents to read the draft and report.
4. Stop. Show the diff. Do not commit; I review and commit myself.

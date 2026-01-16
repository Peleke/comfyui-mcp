# Build Journal System

A documentation-as-code system for capturing development work as publishable content.

## Philosophy

1. **Write fast, not pretty** - "Refrigerator to-do list" energy
2. **Never delete mistakes** - They're the most valuable teaching content
3. **Include the journey** - Wrong turns > polished outcomes
4. **AI reflection is required** - Meta-commentary on the collaboration itself

## Directory Structure

```
buildlog/
├── BUILDLOG_SYSTEM.md          # This file (system docs)
├── _TEMPLATE.md                # Entry template
├── 2026-01-15-runpod-deploy.md # Entries by date + slug
├── 2026-01-16-supabase-storage.md
└── assets/                     # Screenshots, outputs
    ├── viking-portrait.png
    └── error-screenshot.png
```

## Entry Template

Copy `_TEMPLATE.md` for each new entry. Sections:

### Required Sections

| Section | Purpose |
|---------|---------|
| **The Goal** | What we're building and why (1-2 paragraphs) |
| **What We Built** | Architecture, components table |
| **The Journey** | Chronological, including fuckups |
| **Test Results** | Actual commands, actual outputs |
| **Code Samples** | Key snippets, not full files |
| **AI Experience** | Reflection on collaboration |

### Optional Sections

| Section | When to Include |
|---------|-----------------|
| **Cost Analysis** | Infrastructure/API costs involved |
| **Performance** | Benchmarks, timing data |
| **What's Left** | If work is incomplete |
| **Screenshots** | When visual context helps |

## When to Write Entries

Write an entry when:
- Major feature/component completed
- Significant debugging session resolved
- Infrastructure deployed
- After any 2+ hour focused session
- Before context-switching to different work

## Quality Bar

Each entry should be **publishable** as:
- Envato Tuts+ tutorial ($500-750 value)
- Manning/O'Reilly book chapter
- Dev.to / Hashnode article
- Internal team knowledge base

This means:
- Complete code samples that actually run
- Real error messages, not sanitized versions
- Honest reflection on what didn't work

## AI Instructions (for CLAUDE.md)

Add to your project's CLAUDE.md:

```markdown
## Build Journal

After completing significant work (features, debugging sessions, deployments),
write a build journal entry to `buildlog/YYYY-MM-DD-{slug}.md`.

Use the template at `buildlog/_TEMPLATE.md`. Include:
- The goal and what was built
- The journey INCLUDING mistakes and wrong turns
- Actual test commands and outputs
- Code samples with context
- AI Experience reflection on the collaboration

Quality bar: Publishable as a $500+ tutorial article.

Ask user: "Should I write a build journal entry for this work?"
```

## Maintenance

- Review monthly for patterns/themes
- Extract recurring mistakes into "lessons learned"
- Consider publishing standout entries
- Link related entries together

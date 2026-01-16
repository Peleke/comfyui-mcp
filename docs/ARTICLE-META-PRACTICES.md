# Teaching Your AI Assistant: Meta-Development Practices for Claude Code

*How we use CLAUDE.md guidelines and Serena memories to help Claude learn from mistakes and avoid them in future sessions.*

---

## The Problem: AI Assistants Forget

You've just spent two hours debugging an issue with Claude Code. You found the root cause, implemented a fix, and learned a valuable lesson about your codebase.

Tomorrow, you start a new session. Claude has no memory of yesterday's hard-won knowledge. You're back to square one.

This isn't a flaw—it's how LLMs work. Each conversation starts fresh. But that doesn't mean your project-specific knowledge has to be lost.

---

## Two Tools for Persistent Knowledge

Claude Code provides two mechanisms for persisting knowledge across sessions:

### 1. CLAUDE.md - Project Instructions

A `CLAUDE.md` file in your project root is automatically loaded at the start of every session. It's your chance to tell Claude:

- Architectural principles to follow
- Common mistakes to avoid
- Project-specific conventions
- Commands and workflows

### 2. Serena Memories - Contextual Knowledge

If you use the Serena MCP server, you can write and read "memories"—markdown files that persist between sessions. Unlike CLAUDE.md (which loads automatically), memories are read on-demand when relevant.

---

## A Real Example: Contract Testing Lessons

We recently implemented contract testing for our ComfyUI MCP server. Along the way, we made several mistakes that Claude kept repeating:

1. **Guessing input names** instead of verifying against source files
2. **Assuming schema matched reality** when our builders used different patterns
3. **Writing tests for nodes that didn't exist** in certain workflow configurations

After fixing these issues, we captured the lessons in both CLAUDE.md and a Serena memory.

### CLAUDE.md Addition

We added a "Workflow Development Guidelines" section:

```markdown
## Workflow Development Guidelines

### Contract Testing & Schema Management

This project uses **contract testing** to validate workflows against ComfyUI's
`/object_info` schema. Key files:

- `src/contracts/comfyui-schema.json` - Schema snapshot (source of truth for tests)
- `src/contracts/workflow-validator.ts` - Validation logic
- `src/contracts/workflow.contract.test.ts` - Contract tests for all builders

**CRITICAL: Schema-First Development**

When creating or modifying schemas/contracts:

1. **Never guess input names** - Always verify against the actual source:
   - For ComfyUI nodes: Check `/object_info` endpoint OR existing workflow JSON files
   - For our builders: Read the actual builder function, not just the test

2. **Verify against working workflows** - The `src/workflows/*.json` files are
   exported from working ComfyUI setups. When in doubt, these are the source of truth.

3. **Run contract tests early and often**:
   ```bash
   npm run test:contracts
   ```

### Common Mistakes to Avoid

| Mistake | Example | How to Avoid |
|---------|---------|--------------|
| Assuming input names | `gen_text` vs `speech` | Read the actual workflow JSON |
| Assuming required vs optional | `embeds_scaling` | Check if builder actually uses it |
| Assuming node structure | `SetLatentNoiseMask` vs `VAEEncodeForInpaint` | Read the builder implementation |
| Schema drift from reality | TTS node inputs changed | Always verify against workflow files |
```

This section loads automatically in every session. Claude now knows to verify input names before guessing.

### Serena Memory

We also created a detailed memory with implementation specifics:

```bash
# Created via Serena MCP
mcp__serena__write_memory(
  memory_file_name: "contract-testing-guide",
  content: "# Contract Testing for ComfyUI Workflows\n\n## Overview\n..."
)
```

The memory includes:

- File locations and purposes
- Commands to run
- Validation rules
- **Specific gotchas** with before/after examples
- Step-by-step process for adding new nodes

**Key difference from CLAUDE.md**: Memories are longer and more detailed. They're read when Claude determines they're relevant, not loaded automatically. This keeps context efficient.

---

## Writing Effective CLAUDE.md Guidelines

### What to Include

**Do include:**
- Architectural decisions that apply across the codebase
- Common mistakes you've seen Claude make
- Project-specific conventions (naming, file structure)
- Commands Claude should know (`npm run test:contracts`)
- Checklists for common operations

**Don't include:**
- Implementation details that change frequently
- Step-by-step tutorials (use memories instead)
- Information only relevant to specific features

### Structure for Scannability

Claude reads CLAUDE.md at the start of every session. Make it scannable:

```markdown
## Section Name

**CRITICAL**: One-line summary of the most important point.

Brief explanation (2-3 sentences max).

### Subsection with Details

| Pattern | Example | Notes |
|---------|---------|-------|
| ... | ... | ... |
```

Use tables for patterns and examples—they're dense and easy to scan.

### The Mistake Table Pattern

We found tables particularly effective for documenting mistakes:

```markdown
### Common Mistakes to Avoid

| Mistake | Example | How to Avoid |
|---------|---------|--------------|
| Guessing input names | `gen_text` vs `speech` | Read workflow JSON |
| Assuming node exists | `SetLatentNoiseMask` | Read builder source |
| Hardcoding values | `steps: 20` | Use constants/config |
```

Claude can quickly check if a planned action matches a known mistake.

---

## Writing Effective Serena Memories

### When to Create a Memory

Create a memory when:
- You've solved a complex problem that might recur
- You've learned something non-obvious about the codebase
- You want to preserve implementation details too long for CLAUDE.md
- You're documenting a subsystem in depth

### Memory Structure

```markdown
# [Feature/Topic] Guide

## Overview
One paragraph explaining what this is and why it matters.

## Key Files
- `path/to/file.ts` - Purpose
- `path/to/other.ts` - Purpose

## Commands
```bash
npm run relevant:command
```

## Common Gotchas

### Gotcha 1: [Title]
What goes wrong and why.

**Wrong:**
```typescript
// Code that seems right but isn't
```

**Right:**
```typescript
// Correct approach
```

## Step-by-Step: [Common Operation]
1. First step
2. Second step
3. Third step
```

### Naming Memories

Memory names should be descriptive and scannable:

- `contract-testing-guide` - How to use contract testing
- `deployment-runpod` - RunPod deployment specifics
- `workflow-builder-patterns` - Patterns for workflow builders

Claude sees the list of memory names and decides which to read based on relevance to the current task.

---

## The Feedback Loop

The real power comes from treating this as a continuous process:

```
┌─────────────────┐
│  Claude makes   │
│    mistake      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  You debug and  │
│   find cause    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Update CLAUDE  │
│  .md or memory  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Future sessions │
│  avoid mistake  │
└─────────────────┘
```

Every debugging session is an opportunity to improve future sessions.

### Example: The Schema Drift Bug

During contract testing implementation, Claude kept creating schemas with input names from documentation rather than actual workflow files. The fix:

1. **Immediate**: Fixed the schema manually
2. **Preventive**: Added to CLAUDE.md:
   ```markdown
   **Never guess input names** - Always verify against the actual source
   ```
3. **Detailed**: Created memory with specific examples:
   ```markdown
   | Node | Old Names | Actual Names |
   |------|-----------|--------------|
   | F5TTSAudioInputs | gen_text, ref_text | speech, sample_text |
   ```

Now Claude checks workflow files before assuming input names.

---

## Practical Tips

### 1. Update CLAUDE.md During the Session

When you catch Claude making a mistake:

```
"Before we continue, let's add that to CLAUDE.md so we don't hit this again."
```

Claude can edit CLAUDE.md directly. The update takes effect in the next session.

### 2. Create Memories at Natural Breakpoints

After completing a significant feature or debugging session:

```
"Let's create a Serena memory capturing what we learned about [topic]."
```

Don't wait until the end of a long session—context might be summarized away.

### 3. Review and Prune Periodically

CLAUDE.md and memories can grow stale. Periodically review:

- Is this still accurate?
- Is this still relevant?
- Can this be condensed?

### 4. Use Checklists for Repetitive Operations

For operations Claude performs repeatedly:

```markdown
### Pre-Commit Checklist

Before committing workflow-related changes:

- [ ] `npm run test:contracts` passes
- [ ] `npm test` passes (full suite)
- [ ] Schema matches actual workflow files
- [ ] New nodes added to schema if needed
```

Claude can mentally check these off, reducing mistakes.

---

## Results

After implementing these practices for our contract testing work:

| Metric | Before | After |
|--------|--------|-------|
| Schema mistakes per session | 3-5 | 0-1 |
| Time spent re-explaining context | 10-15 min | 2-3 min |
| Test failures from wrong assumptions | Common | Rare |

The investment in CLAUDE.md and memories pays off quickly.

---

## Key Takeaways

1. **CLAUDE.md is for principles** - Architectural decisions, common mistakes, conventions
2. **Memories are for details** - Implementation specifics, step-by-step guides, gotchas
3. **Update during sessions** - Don't wait; capture lessons when they're fresh
4. **Use tables for patterns** - Scannable format for mistake→solution mappings
5. **Treat it as a feedback loop** - Every mistake is an opportunity to improve

Your AI assistant can learn from your project—you just have to teach it.

---

*This article is part of a series on AI-assisted development. See also: [Contract Testing for AI Workflows](./ARTICLE-CONTRACT-TESTING.md)*

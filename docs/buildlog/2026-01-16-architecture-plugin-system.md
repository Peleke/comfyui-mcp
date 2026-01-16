# Build Journal: Architecture Plugin System

**Date:** 2026-01-16
**Duration:** ~4 hours (planning + implementation + review)
**Status:** Complete

---

## The Goal

Build an architecture-aware plugin system that detects model types (SD1.5, SDXL, Pony, Illustrious, Flux) from checkpoint filenames and returns appropriate defaults, ControlNet models, and IP-Adapter configs. This eliminates hardcoded model mappings scattered across tools and makes adding new architectures trivial.

**Why it matters:** Every time someone uses a Pony model with the wrong ControlNet, or Flux with negative prompts, they get garbage output. The system should be smart enough to know what works with what.

---

## What We Built

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Architecture Registry                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │  SD1.5  │ │  SDXL   │ │  Pony   │ │Illustr. │ │  Flux  │ │
│  │ pri=40  │ │ pri=50  │ │ pri=80  │ │ pri=90  │ │ pri=100│ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌───────────┐    ┌───────────┐    ┌───────────┐
   │controlnet │    │ ipadapter │    │  avatar   │
   │   .ts     │    │   .ts     │    │   .ts     │
   └───────────┘    └───────────┘    └───────────┘
```

### Components

| Component | Status | Notes |
|-----------|--------|-------|
| `types.ts` | Working | Core interfaces, ControlNetType canonical definition |
| `registry.ts` | Working | Detection, capability queries, model lookups |
| `index.ts` | Working | Plugin registration, exports |
| `plugins/sd15.ts` | Working | 512x768, 20 steps, CFG 7 |
| `plugins/sdxl.ts` | Working | 1024x1024, 28 steps, CFG 7 (fallback) |
| `plugins/pony.ts` | Working | Furry/yiff detection, SDXL ControlNet |
| `plugins/illustrious.ts` | Working | Noobai/wai detection, SDXL ControlNet |
| `plugins/flux.ts` | Working | No negative prompt, 4 steps, CFG 1 |
| Unit tests | Working | 33 tests |
| Integration tests | Working | 9 tests (live ComfyUI when available) |

---

## The Journey

### Phase 1: Planning with Structured Methodology

**What we tried:**
Used the 7-phase planning methodology:
1. Context Loading
2. Full Reconnaissance
3. Synthesis
4. Problem Decomposition
5. Solution Space Exploration
6. Draft Blueprint
7. Defense in Depth

**What happened:**
Created a comprehensive 300+ line plan covering types, registry, plugins, test strategy, integration points. Plan was approved by user.

**The issue:**
Plan was *architecturally* complete but missed *implementation details* that only surface during actual coding:

1. **ControlNetType duplication** - Plan didn't audit where `ControlNetType` was already defined
2. **Constructor signatures** - ComfyUIClient had changed to object params
3. **Flux ControlNet reality** - Plan said "no ControlNet support" but Flux ControlNet models actually exist now

**Lesson:**
Planning methodologies excel at architecture but can't substitute for reading actual code during implementation.

---

### Phase 2: Implementation

**What we tried:**
Implemented per the plan - types, registry, plugins, then tool integration.

**What happened:**
Clean implementation. The abstraction pattern worked well:

```typescript
// Each plugin is self-contained
export const fluxArchitecture: ModelArchitecture = {
  id: "flux",
  patterns: [/flux/i, /schnell/i, /dev(?!il)/i],
  priority: 100,
  supportsNegativePrompt: false,
  supportsControlNet: false,  // <-- This is wrong, actually
  defaults: { width: 1024, height: 1024, steps: 4, cfgScale: 1, ... },
};
```

**The fix:**
No fix needed during implementation - it compiled and tests passed.

**Lesson:**
Tests passing ≠ correct behavior. We tested what we *thought* was true, not what *is* true.

---

### Phase 3: Integration Test Bug

**What we tried:**
Running the integration test suite.

**What happened:**
```
TypeError: Cannot read properties of undefined (reading 'getObjectInfo')
  at src/architectures/architectures.integration.test.ts:64:34
```

**The fix:**
```typescript
// Wrong - old constructor signature
ctx.client = new ComfyUIClient(COMFYUI_URL);

// Right - object params
ctx.client = new ComfyUIClient({ url: COMFYUI_URL });
```

**Lesson:**
API changes in one part of the codebase can break tests written against old signatures. Integration tests caught this; unit tests couldn't.

---

### Phase 4: PR Review - The Real Gaps

**What we tried:**
"Brutal PR review" after implementation complete.

**What happened:**
Review found three issues the plan missed:

| Gap | Nature | Why Plan Missed It |
|-----|--------|-------------------|
| Singleton at module load | Architectural | Plan focused on *what* not *when* |
| Pony detection too aggressive | Domain knowledge | `furry` pattern might misfire |
| Flux ControlNet exists | External reality | Knowledge cutoff / assumption |

**The fix:**
Documented as concerns in review. Not blocking for merge but tracked for follow-up.

**Lesson:**
Plans operate on *stated requirements* and *known constraints*. They can't discover:
- External ecosystem changes (Flux ControlNet now exists)
- Edge case domain knowledge (furry model naming conventions)
- Runtime behavior (singleton initialization order)

---

## Test Results

### Unit Tests

**Command:**
```bash
npx vitest run src/architectures/
```

**Response:**
```
✓ src/architectures/architectures.test.ts (33 tests) 7ms
✓ src/architectures/architectures.integration.test.ts (9 tests) 15ms

Test Files  2 passed (2)
     Tests  42 passed (42)
```

**Result:** Pass - all detection, capability, and model selection tests working.

### Type Check

**Command:**
```bash
npx tsc --noEmit
```

**Response:**
```
(No output - clean)
```

**Result:** Pass - zero type errors.

---

## Code Samples

### Priority-Based Detection

```typescript
// registry.ts:51-74
detect(checkpointName: string): ArchitectureDetection {
  const normalized = checkpointName.toLowerCase();

  // Try each architecture in priority order (highest first)
  for (const arch of this.sortedArchitectures) {
    for (const pattern of arch.patterns) {
      if (pattern.test(normalized)) {
        return {
          architecture: arch,
          confidence: arch.priority / 100,
          reason: `Matched pattern ${pattern}`,
        };
      }
    }
  }

  // Fallback chain: XL suffix → SDXL, otherwise → SDXL
  return this.fallbackDetection(normalized);
}
```

This is the heart of the system. Priority ordering means Flux (100) beats Pony (80) beats SDXL (50). Pattern specificity within each architecture handles edge cases.

### Architecture-Aware Tool Integration

```typescript
// controlnet.ts - before
const controlNetModel = input.controlnet_model || DEFAULT_CONTROLNET_MODELS[controlType];

// controlnet.ts - after
const controlNetModel = input.controlnet_model || getControlNetModel(model, controlType);

function getControlNetModel(checkpointName: string, controlType: ControlNetType): string {
  const model = architectures.getControlNetModel(checkpointName, controlType);
  return model ?? sd15Fallback[controlType];  // Safe fallback
}
```

Single line change in tool code, all the intelligence lives in the registry.

---

## What's Left

- [ ] Add Flux ControlNet support when models stabilize
- [ ] Consider dynamic plugin loading (not hardcoded imports)
- [ ] Add SD3 architecture when ControlNet/IPAdapter available
- [ ] Review Pony detection patterns for edge cases

---

## Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Files Changed | 17 | New architecture system + tool integration |
| Lines Added | ~1,100 | Types, registry, 5 plugins, tests |
| Lines Removed | ~100 | Hardcoded mappings in tools |
| Commits | 8 | Clean history, logical progression |
| Test Coverage | 42 tests | 33 unit + 9 integration |

---

## AI Experience Reflection

### What Worked Well

1. **Structured planning caught architecture issues early** - The 7-phase methodology ensured we had types, registry, and plugin patterns defined before coding
2. **Test-first integration tests** - Writing integration tests forced us to think about real ComfyUI behavior
3. **Incremental commits** - Each commit was logically complete, making review easy

### What Was Frustrating

1. **Planning can't substitute for code reading** - The plan was thorough but didn't catch the `ControlNetType` duplication because I hadn't *read* builder.ts line by line
2. **Knowledge cutoff creates blind spots** - Flux ControlNet exists now but I didn't know that during planning
3. **Domain knowledge gaps** - Pony/furry model naming conventions aren't in any documentation

### The Core Gap: Plans vs Reality

The planning methodology excels at:
- Breaking down complex work
- Identifying components and interfaces
- Sequencing implementation
- Risk identification

The planning methodology cannot:
- Discover code that already exists (must read it)
- Know about external ecosystem changes
- Surface edge cases in domain-specific naming

### For Next Time: Pre-Review Checklist

Before considering implementation "complete," run this checklist:

1. **Type Audit** - Grep for any types being introduced. Are they defined elsewhere?
   ```bash
   grep -r "type.*ControlNetType" src/
   ```

2. **API Surface Check** - For each file touched, verify constructor/function signatures haven't changed
   ```bash
   git diff main -- src/client.ts | grep "constructor\|export function"
   ```

3. **External Reality Check** - For "not supported" claims, do a quick search
   ```
   "Does Flux ControlNet exist?" → Search reveals xlabs-ai/flux-controlnet
   ```

4. **Pattern Edge Cases** - For regex patterns, generate adversarial test cases
   ```typescript
   // What if someone names a model "butterfly.safetensors"?
   // Contains "furry" → false positive as Pony
   // (Actually safe - "furry" not "fur")
   ```

5. **Singleton/Initialization** - Ask "when does this code run?" not just "what does it do?"

### Meta-Observation

The brutal PR review found 3 issues. All 3 were discoverable *during* implementation if I had:
1. Run `grep` before defining types
2. Checked constructor signatures when writing tests
3. Questioned my own "supportsControlNet: false" assertion

The lesson isn't "plan better" - the plan was good. The lesson is **verify assumptions at implementation time, not review time**.

---

## Files Changed

```
src/architectures/
├── index.ts              # Plugin registration, exports
├── registry.ts           # Detection engine, capability queries
├── types.ts              # Core interfaces (ControlNetType canonical)
├── plugins/
│   ├── sd15.ts           # SD 1.5 architecture
│   ├── sdxl.ts           # SDXL architecture (fallback)
│   ├── pony.ts           # Pony/furry detection
│   ├── illustrious.ts    # Illustrious/noobai detection
│   └── flux.ts           # Flux architecture
├── architectures.test.ts           # 33 unit tests
└── architectures.integration.test.ts # 9 integration tests

src/tools/
├── controlnet.ts         # Now uses architecture registry
├── ipadapter.ts          # Now uses architecture registry
└── avatar.ts             # Uses getDefaults() for SDXL

src/workflows/
└── builder.ts            # Re-exports ControlNetType from architectures
```

---

*Next entry: Flux ControlNet support or contract testing implementation*

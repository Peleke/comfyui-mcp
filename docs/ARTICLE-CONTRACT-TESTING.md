# Contract Testing for AI Workflows: How We Validate ComfyUI Pipelines Without a GPU

*How we went from 632 passing tests and zero confidence to catching real bugs before they reach production—without spending a dime on GPU time.*

---

## The Problem: When Tests Lie to You

We had 632 passing tests. Green checkmarks everywhere. CI pipeline glowing with success.

And yet, every time we deployed, something broke.

The model name was wrong. A node input was misspelled. The sampler didn't exist. Connections pointed to outputs that weren't there.

Our tests were lying to us.

Here's what a typical "passing" test looked like:

```typescript
it("builds txt2img workflow", () => {
  const workflow = buildTxt2ImgWorkflow({
    prompt: "a cat",
    model: "sd_xl_base_1.0.safetensors",
    steps: 20,
  });

  expect(workflow["1"].class_type).toBe("CheckpointLoaderSimple");
  expect(workflow["1"].inputs.ckpt_name).toBe("sd_xl_base_1.0.safetensors");
  expect(workflow["3"].class_type).toBe("KSampler");
});
```

This test passes. It tells us the workflow has the right shape.

But it tells us **nothing** about whether:
- `CheckpointLoaderSimple` is a real ComfyUI node
- `ckpt_name` is the correct input name (not `checkpoint_name` or `model`)
- `KSampler` accepts the inputs we're providing
- The node connections reference valid outputs

We were testing our assumptions, not reality.

---

## Context: What We're Building

We're building an MCP (Model Context Protocol) server for ComfyUI—the node-based AI image generation tool. Our server exposes ComfyUI's capabilities through a clean API: text-to-image, image-to-image, ControlNet, inpainting, upscaling, TTS, and lip-sync video generation.

The architecture looks like this:

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Claude    │────▶│  ComfyUI MCP    │────▶│   ComfyUI   │
│   (Client)  │     │   (Our Code)    │     │   (GPU)     │
└─────────────┘     └─────────────────┘     └─────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ JSON Workflow │
                    │  (Node Graph) │
                    └───────────────┘
```

Our code builds JSON workflows—node graphs that ComfyUI executes. Each workflow is a dictionary of nodes, with connections between them:

```json
{
  "1": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" }
  },
  "2": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "a beautiful sunset",
      "clip": ["1", 1]
    }
  }
}
```

The problem: these workflows are **contracts**. If we get any detail wrong—node name, input name, connection index—ComfyUI rejects the workflow at runtime.

And testing against a live ComfyUI instance requires a GPU. GPUs cost money. Our CI runs on every PR. The math doesn't work.

---

## The Testing Gap

Traditional testing approaches leave a gap:

```
           /\
          /  \     E2E Tests: Accurate but expensive
         /    \    $0.10/run, requires GPU
        /------\
       /   ??   \  THE GAP: What goes here?
      /          \
     /------------\
    /              \ Unit Tests: Fast but mock reality
   /                \ $0, but validate nothing about ComfyUI
  /------------------\
```

**Unit tests** are fast and free, but they only test our internal logic. They can't tell us if our workflows will actually run.

**E2E tests** against real ComfyUI are accurate, but:
- Require GPU infrastructure ($$$)
- Take minutes per test (vs milliseconds)
- Introduce flakiness (network, GPU availability, model loading)
- Can't run on every PR

We needed something in the middle. Something that validates workflow correctness without execution.

---

## The Insight: ComfyUI Already Has a Contract

Here's what changed everything: ComfyUI has an endpoint called `/object_info`.

This endpoint returns the **complete schema** for every node in the system:

```json
{
  "CheckpointLoaderSimple": {
    "input": {
      "required": {
        "ckpt_name": [["model1.safetensors", "model2.safetensors"]]
      }
    },
    "output": ["MODEL", "CLIP", "VAE"],
    "output_name": ["MODEL", "CLIP", "VAE"]
  },
  "KSampler": {
    "input": {
      "required": {
        "model": ["MODEL"],
        "positive": ["CONDITIONING"],
        "negative": ["CONDITIONING"],
        "latent_image": ["LATENT"],
        "seed": ["INT", { "default": 0, "min": 0, "max": 18446744073709551615 }],
        "steps": ["INT", { "default": 20, "min": 1, "max": 10000 }],
        "cfg": ["FLOAT", { "default": 8.0, "min": 0.0, "max": 100.0 }],
        "sampler_name": [["euler", "euler_ancestral", "dpmpp_2m"]],
        "scheduler": [["normal", "karras", "exponential"]],
        "denoise": ["FLOAT", { "default": 1.0, "min": 0.0, "max": 1.0 }]
      }
    },
    "output": ["LATENT"]
  }
}
```

This is **the contract**. It defines:
- Which nodes exist
- What inputs each node requires (and their types)
- What outputs each node produces
- Valid enum values (samplers, schedulers, model files)
- Numeric constraints (min, max, step)

If we validate our workflows against this schema, we can catch structural errors **without executing anything**.

---

## Implementation: Contract Testing for Workflows

### Step 1: Capture the Schema

First, we need to capture `/object_info` and commit it to our repo. This becomes our "contract snapshot":

```typescript
// src/contracts/schema-fetcher.ts
async function fetchSchema(comfyuiUrl: string): Promise<ComfyUIObjectInfo> {
  const response = await fetch(`${comfyuiUrl}/object_info`);
  return response.json();
}

// Filter to only the nodes we actually use
const COMMON_NODES = [
  "CheckpointLoaderSimple",
  "KSampler",
  "KSamplerAdvanced",
  "CLIPTextEncode",
  "VAEDecode",
  "VAEEncode",
  "EmptyLatentImage",
  "SaveImage",
  "LoadImage",
  "ImageScale",
  "UpscaleModelLoader",
  "ImageUpscaleWithModel",
  // ... and 30+ more
];

async function main() {
  const fullSchema = await fetchSchema(process.env.COMFYUI_URL);

  // Extract only the nodes we need
  const schema: Record<string, NodeSchema> = {};
  for (const node of COMMON_NODES) {
    if (fullSchema[node]) {
      schema[node] = fullSchema[node];
    }
  }

  // Add metadata
  schema._meta = {
    fetchedAt: new Date().toISOString(),
    comfyuiVersion: "...",
    nodeCount: Object.keys(schema).length,
  };

  await fs.writeFile(
    "src/contracts/comfyui-schema.json",
    JSON.stringify(schema, null, 2)
  );
}
```

Now we have a ~3000-line JSON file committed to our repo that defines exactly what ComfyUI expects.

### Step 2: Build the Validator

The validator checks workflows against the schema:

```typescript
// src/contracts/workflow-validator.ts

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  stats: {
    nodeCount: number;
    connectionCount: number;
    unknownNodeTypes: string[];
  };
}

export function validateWorkflow(
  workflow: ComfyUIWorkflow,
  schema: ComfyUIObjectInfo,
  options: ValidationOptions = {}
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const [nodeId, node] of Object.entries(workflow)) {
    // 1. Check node type exists
    const nodeSchema = schema[node.class_type];
    if (!nodeSchema) {
      errors.push({
        nodeId,
        nodeType: node.class_type,
        field: "class_type",
        message: `Unknown node type "${node.class_type}"`,
        severity: "error",
      });
      continue;
    }

    // 2. Check required inputs
    const requiredInputs = nodeSchema.input?.required || {};
    for (const [inputName, inputDef] of Object.entries(requiredInputs)) {
      if (node.inputs[inputName] === undefined) {
        errors.push({
          nodeId,
          nodeType: node.class_type,
          field: inputName,
          message: `Missing required input "${inputName}"`,
          severity: "error",
        });
      }
    }

    // 3. Validate input types
    for (const [inputName, value] of Object.entries(node.inputs)) {
      const inputDef = requiredInputs[inputName] || optionalInputs[inputName];
      if (inputDef) {
        const typeErrors = validateInputType(value, inputDef);
        errors.push(...typeErrors);
      }
    }

    // 4. Validate connections
    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (isNodeReference(value)) {
        const [refNodeId, outputIndex] = value;

        // Check referenced node exists
        if (!workflow[refNodeId]) {
          errors.push({
            nodeId,
            field: inputName,
            message: `References non-existent node "${refNodeId}"`,
            severity: "error",
          });
        }

        // Check output index is valid
        const refNode = workflow[refNodeId];
        const refSchema = schema[refNode.class_type];
        if (refSchema && outputIndex >= refSchema.output.length) {
          errors.push({
            nodeId,
            field: inputName,
            message: `Output index ${outputIndex} out of range`,
            severity: "error",
          });
        }
      }
    }
  }

  return {
    valid: errors.filter(e => e.severity === "error").length === 0,
    errors: errors.filter(e => e.severity === "error"),
    warnings: errors.filter(e => e.severity === "warning"),
    stats: { /* ... */ },
  };
}
```

### Step 3: Write Contract Tests

Now we can test every workflow builder:

```typescript
// src/contracts/workflow.contract.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { validateWorkflow, loadBundledSchema } from "./workflow-validator.js";
import { buildTxt2ImgWorkflow } from "../workflows/txt2img.js";
import { buildControlNetWorkflow } from "../workflows/controlnet.js";

describe("Workflow Contract Tests", () => {
  let schema: ComfyUIObjectInfo;

  beforeAll(async () => {
    schema = await loadBundledSchema();
  });

  describe("txt2img workflows", () => {
    it("builds valid basic workflow", () => {
      const workflow = buildTxt2ImgWorkflow({
        prompt: "a test image",
        negativePrompt: "bad quality",
        model: "sd_xl_base_1.0.safetensors",
        width: 1024,
        height: 1024,
        steps: 20,
        cfg: 7,
        seed: 42,
        sampler: "euler",
        scheduler: "normal",
      });

      const result = validateWorkflow(workflow, schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("validates all node connections", () => {
      const workflow = buildTxt2ImgWorkflow({ /* ... */ });
      const result = validateWorkflow(workflow, schema);

      // Specifically check connection validity
      expect(result.stats.connectionCount).toBeGreaterThan(0);
      expect(result.errors.filter(e =>
        e.message.includes("References non-existent")
      )).toHaveLength(0);
    });
  });

  describe("ControlNet workflows", () => {
    it("validates Canny workflow", () => {
      const workflow = buildControlNetWorkflow({
        controlType: "canny",
        // ... params
      });

      const result = validateWorkflow(workflow, schema);
      expect(result.valid).toBe(true);
    });
  });

  // Test EVERY workflow builder
  describe("img2img workflows", () => { /* ... */ });
  describe("inpaint workflows", () => { /* ... */ });
  describe("IP-Adapter workflows", () => { /* ... */ });
  describe("TTS workflows", () => { /* ... */ });
  describe("lip-sync workflows", () => { /* ... */ });
});
```

### Step 4: Test Edge Cases

The validator catches real bugs:

```typescript
describe("error detection", () => {
  it("catches unknown node types", () => {
    const workflow = {
      "1": {
        class_type: "NonExistentNode",
        inputs: {}
      }
    };

    const result = validateWorkflow(workflow, schema);

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Unknown node type");
  });

  it("catches missing required inputs", () => {
    const workflow = {
      "1": {
        class_type: "KSampler",
        inputs: {
          // Missing: model, positive, negative, latent_image
          seed: 42,
          steps: 20,
        }
      }
    };

    const result = validateWorkflow(workflow, schema);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e =>
      e.message.includes('Missing required input "model"')
    )).toBe(true);
  });

  it("catches out-of-range values", () => {
    const workflow = buildTxt2ImgWorkflow({
      steps: 50000,  // Max is 10000
      cfg: 500,      // Max is 100
    });

    const result = validateWorkflow(workflow, schema);

    expect(result.errors.some(e =>
      e.message.includes("above maximum")
    )).toBe(true);
  });
});
```

---

## CI Integration

Add contract tests to your CI pipeline:

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm test

  contract-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npm run test:contracts
```

The contract tests run in ~500ms with zero external dependencies.

---

## Real Bugs We Caught

After implementing contract testing, we immediately caught several bugs that unit tests missed:

### Bug 1: Wrong Input Name

```typescript
// Our code
node.inputs.ckpt_name = modelName;

// Actual ComfyUI schema expected: "checkpoint_name"
```

Contract test error:
```
ERROR [1/CheckpointLoaderSimple] ckpt_name: Unknown input "ckpt_name"
```

### Bug 2: Missing Required Input

```typescript
// Our IPAdapterAdvanced node was missing "image"
const workflow = {
  "5": {
    class_type: "IPAdapterAdvanced",
    inputs: {
      model: ["1", 0],
      ipadapter: ["4", 0],
      // Missing: image input!
    }
  }
};
```

Contract test error:
```
ERROR [5/IPAdapterAdvanced] image: Missing required input "image"
```

### Bug 3: Schema Drift

When we upgraded ComfyUI, some node inputs changed. The F5-TTS node renamed inputs:

```typescript
// Old schema
input: { gen_text: "...", ref_text: "...", ref_audio: "..." }

// New schema
input: { speech: "...", sample_text: "...", sample_audio: "..." }
```

Our unit tests still passed (they mocked everything). The contract tests caught it immediately.

---

## When to Use Contract Testing

Contract testing is ideal when:

1. **You generate structured data** that another system consumes
2. **The consumer has a schema** you can validate against
3. **Integration testing is expensive** (requires external services, GPUs, etc.)
4. **Schema drift is a risk** (the external system evolves independently)

It's NOT a replacement for E2E testing—you still need to verify actual execution works. But it's a powerful middle layer that catches structural bugs cheaply.

### The Final Testing Pyramid

```
           /\
          /  \     E2E: Full pipeline execution
         /    \    Weekly, catches runtime issues
        /------\
       /        \  Contract: Schema validation
      /          \ Every PR, catches structural bugs
     /------------\
    /              \ Unit: Internal logic
   /                \ Every PR, catches code bugs
  /------------------\
```

---

## Keeping the Schema Updated

The schema snapshot needs periodic updates as ComfyUI evolves. We added a script:

```json
{
  "scripts": {
    "contracts:update": "tsx src/contracts/schema-fetcher.ts --common --output src/contracts/comfyui-schema.json"
  }
}
```

Run it whenever:
- You add support for new nodes
- You upgrade ComfyUI
- Contract tests fail unexpectedly (might indicate schema drift)

The schema file is committed to git, so changes are visible in PR diffs.

---

## Results

After implementing contract testing:

| Metric | Before | After |
|--------|--------|-------|
| Test count | 632 | 673 |
| CI time | 2 min | 2.5 min |
| CI cost | $0 | $0 |
| Confidence | Low | High |

The key insight: **673 tests that validate reality are worth more than 1000 tests that validate assumptions**.

---

## Key Takeaways

1. **Mocks can lie.** Tests that only verify internal consistency give false confidence.

2. **Look for existing contracts.** Many systems expose schemas (OpenAPI, GraphQL introspection, ComfyUI's `/object_info`). Use them.

3. **Snapshot the contract.** Committing the schema makes changes visible and reviewable.

4. **Test structure, not execution.** Contract tests validate "will this be accepted?" not "will this produce good output?"

5. **Layer your testing.** Contract tests complement unit tests and E2E tests—they don't replace them.

The goal isn't more tests. It's **tests that tell the truth**.

---

*This article documents the contract testing implementation for [comfyui-mcp](https://github.com/Peleke/comfyui-mcp), an MCP server for AI image generation with ComfyUI.*

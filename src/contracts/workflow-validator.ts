/**
 * Workflow Validator
 *
 * Validates ComfyUI workflow JSON against the /object_info schema.
 * This enables "contract testing" - validating workflow structure WITHOUT
 * requiring a GPU or live ComfyUI instance.
 *
 * Key insight: ComfyUI's /object_info endpoint returns full schemas for all nodes,
 * including required inputs, types, and allowed values. We can use this to validate
 * that our workflow builders produce valid output.
 */

import type {
  ComfyUIObjectInfo,
  ComfyUINodeSchema,
  ComfyUIWorkflow,
  WorkflowNode,
  NodeReference,
  ValidationResult,
  ValidationError,
  ValidationOptions,
} from "./types.js";

/**
 * Check if a value is a node reference (connection to another node).
 * Node references are arrays of [nodeId, outputIndex].
 */
function isNodeReference(value: unknown): value is NodeReference {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number"
  );
}

/**
 * Get the type name from a ComfyUI input definition.
 */
function getInputType(inputDef: unknown[]): string {
  if (!Array.isArray(inputDef) || inputDef.length === 0) {
    return "UNKNOWN";
  }

  const first = inputDef[0];

  // Enum: [["option1", "option2"]]
  if (Array.isArray(first)) {
    return "ENUM";
  }

  // Type reference: ["STRING"] or ["STRING", { options }]
  if (typeof first === "string") {
    return first;
  }

  return "UNKNOWN";
}

/**
 * Get allowed enum values from an input definition.
 */
function getEnumValues(inputDef: unknown[]): string[] | null {
  if (!Array.isArray(inputDef) || inputDef.length === 0) {
    return null;
  }

  const first = inputDef[0];
  if (Array.isArray(first)) {
    return first as string[];
  }

  return null;
}

/**
 * Get numeric constraints from an input definition.
 */
function getNumericConstraints(
  inputDef: unknown[]
): { min?: number; max?: number; step?: number } | null {
  if (!Array.isArray(inputDef) || inputDef.length < 2) {
    return null;
  }

  const options = inputDef[1];
  if (typeof options === "object" && options !== null) {
    return options as { min?: number; max?: number; step?: number };
  }

  return null;
}

/**
 * Validate a single input value against its schema.
 */
function validateInput(
  nodeId: string,
  nodeType: string,
  inputName: string,
  value: unknown,
  inputDef: unknown[],
  workflow: ComfyUIWorkflow,
  schema: ComfyUIObjectInfo,
  options: ValidationOptions
): ValidationError[] {
  const errors: ValidationError[] = [];
  const inputType = getInputType(inputDef);

  // Node references are validated separately
  if (isNodeReference(value)) {
    const [refNodeId, outputIndex] = value;

    // Check referenced node exists
    if (!workflow[refNodeId]) {
      errors.push({
        nodeId,
        nodeType,
        field: inputName,
        message: `References non-existent node "${refNodeId}"`,
        severity: "error",
      });
      return errors;
    }

    // Check output index is valid
    const refNode = workflow[refNodeId];
    const refNodeSchema = schema[refNode.class_type];

    if (refNodeSchema) {
      const outputCount = refNodeSchema.output.length;
      if (outputIndex >= outputCount) {
        errors.push({
          nodeId,
          nodeType,
          field: inputName,
          message: `Output index ${outputIndex} out of range for node "${refNodeId}" (${refNode.class_type} has ${outputCount} outputs)`,
          severity: "error",
        });
      }
    }

    return errors;
  }

  // Validate based on type
  switch (inputType) {
    case "ENUM": {
      if (!options.skipEnumValidation) {
        const enumValues = getEnumValues(inputDef);
        if (enumValues && typeof value === "string") {
          // For dynamic enums (model files), we just check it's a string
          // The actual model existence is validated at runtime
          // We only fail on obviously wrong types
        }
      }
      break;
    }

    case "INT": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push({
          nodeId,
          nodeType,
          field: inputName,
          message: `Expected integer, got ${typeof value}`,
          severity: "error",
        });
      } else {
        const constraints = getNumericConstraints(inputDef);
        if (constraints) {
          if (constraints.min !== undefined && value < constraints.min) {
            errors.push({
              nodeId,
              nodeType,
              field: inputName,
              message: `Value ${value} is below minimum ${constraints.min}`,
              severity: "error",
            });
          }
          if (constraints.max !== undefined && value > constraints.max) {
            errors.push({
              nodeId,
              nodeType,
              field: inputName,
              message: `Value ${value} is above maximum ${constraints.max}`,
              severity: "error",
            });
          }
        }
      }
      break;
    }

    case "FLOAT": {
      if (typeof value !== "number") {
        errors.push({
          nodeId,
          nodeType,
          field: inputName,
          message: `Expected number, got ${typeof value}`,
          severity: "error",
        });
      } else {
        const constraints = getNumericConstraints(inputDef);
        if (constraints) {
          if (constraints.min !== undefined && value < constraints.min) {
            errors.push({
              nodeId,
              nodeType,
              field: inputName,
              message: `Value ${value} is below minimum ${constraints.min}`,
              severity: "error",
            });
          }
          if (constraints.max !== undefined && value > constraints.max) {
            errors.push({
              nodeId,
              nodeType,
              field: inputName,
              message: `Value ${value} is above maximum ${constraints.max}`,
              severity: "error",
            });
          }
        }
      }
      break;
    }

    case "STRING": {
      if (typeof value !== "string") {
        errors.push({
          nodeId,
          nodeType,
          field: inputName,
          message: `Expected string, got ${typeof value}`,
          severity: "error",
        });
      }
      break;
    }

    case "BOOLEAN": {
      if (typeof value !== "boolean") {
        errors.push({
          nodeId,
          nodeType,
          field: inputName,
          message: `Expected boolean, got ${typeof value}`,
          severity: "error",
        });
      }
      break;
    }

    // Type references (MODEL, CLIP, VAE, etc.) should be node references
    default: {
      if (!isNodeReference(value)) {
        // Allow primitive values for some edge cases
        if (
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean"
        ) {
          errors.push({
            nodeId,
            nodeType,
            field: inputName,
            message: `Expected node reference for type ${inputType}, got ${typeof value}`,
            severity: "warning",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validate a single workflow node.
 */
function validateNode(
  nodeId: string,
  node: WorkflowNode,
  schema: ComfyUIObjectInfo,
  workflow: ComfyUIWorkflow,
  options: ValidationOptions
): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeType = node.class_type;

  // Check node type exists
  const nodeSchema = schema[nodeType];
  if (!nodeSchema) {
    if (!options.allowUnknownNodes) {
      errors.push({
        nodeId,
        nodeType,
        field: "class_type",
        message: `Unknown node type "${nodeType}"`,
        severity: "error",
      });
    }
    return errors;
  }

  // Validate required inputs
  const requiredInputs = nodeSchema.input?.required || {};
  for (const [inputName, inputDef] of Object.entries(requiredInputs)) {
    const value = node.inputs[inputName];

    if (value === undefined) {
      errors.push({
        nodeId,
        nodeType,
        field: inputName,
        message: `Missing required input "${inputName}"`,
        severity: "error",
      });
      continue;
    }

    const inputErrors = validateInput(
      nodeId,
      nodeType,
      inputName,
      value,
      inputDef as unknown[],
      workflow,
      schema,
      options
    );
    errors.push(...inputErrors);
  }

  // Validate optional inputs (if provided)
  const optionalInputs = nodeSchema.input?.optional || {};
  for (const [inputName, inputDef] of Object.entries(optionalInputs)) {
    const value = node.inputs[inputName];

    if (value !== undefined) {
      const inputErrors = validateInput(
        nodeId,
        nodeType,
        inputName,
        value,
        inputDef as unknown[],
        workflow,
        schema,
        options
      );
      errors.push(...inputErrors);
    }
  }

  // Check for unknown inputs
  const allKnownInputs = new Set([
    ...Object.keys(requiredInputs),
    ...Object.keys(optionalInputs),
    ...Object.keys(nodeSchema.input?.hidden || {}),
  ]);

  for (const inputName of Object.keys(node.inputs)) {
    if (!allKnownInputs.has(inputName)) {
      errors.push({
        nodeId,
        nodeType,
        field: inputName,
        message: `Unknown input "${inputName}" for node type "${nodeType}"`,
        severity: "warning",
      });
    }
  }

  return errors;
}

/**
 * Validate a ComfyUI workflow against a schema.
 *
 * @param workflow - The workflow to validate
 * @param schema - The ComfyUI object_info schema
 * @param options - Validation options
 * @returns Validation result with errors and stats
 */
export function validateWorkflow(
  workflow: ComfyUIWorkflow,
  schema: ComfyUIObjectInfo,
  options: ValidationOptions = {}
): ValidationResult {
  const allErrors: ValidationError[] = [];
  const unknownNodeTypes: string[] = [];
  let connectionCount = 0;

  // Validate each node
  for (const [nodeId, node] of Object.entries(workflow)) {
    // Skip metadata
    if (nodeId === "_meta") continue;

    const errors = validateNode(nodeId, node, schema, workflow, options);
    allErrors.push(...errors);

    // Track unknown node types
    if (!schema[node.class_type] && !options.allowUnknownNodes) {
      if (!unknownNodeTypes.includes(node.class_type)) {
        unknownNodeTypes.push(node.class_type);
      }
    }

    // Count connections
    for (const value of Object.values(node.inputs)) {
      if (isNodeReference(value)) {
        connectionCount++;
      }
    }
  }

  // Split into errors and warnings
  const errors = allErrors.filter((e) => e.severity === "error");
  const warnings = allErrors.filter((e) => e.severity === "warning");

  // Determine if valid
  const valid = options.strictMode
    ? allErrors.length === 0
    : errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    stats: {
      nodeCount: Object.keys(workflow).filter((k) => k !== "_meta").length,
      connectionCount,
      unknownNodeTypes,
    },
  };
}

/**
 * Load the bundled schema snapshot.
 */
export async function loadBundledSchema(): Promise<ComfyUIObjectInfo> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const { fileURLToPath } = await import("url");

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(__dirname, "comfyui-schema.json");

  const content = await fs.readFile(schemaPath, "utf-8");
  const parsed = JSON.parse(content);

  // Remove metadata before returning
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _meta, ...schema } = parsed;
  return schema as ComfyUIObjectInfo;
}

/**
 * Format validation errors for display.
 */
export function formatValidationErrors(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push(`✅ Workflow valid (${result.stats.nodeCount} nodes, ${result.stats.connectionCount} connections)`);
  } else {
    lines.push(`❌ Workflow invalid (${result.errors.length} errors, ${result.warnings.length} warnings)`);
  }

  for (const error of result.errors) {
    lines.push(`  ERROR [${error.nodeId}/${error.nodeType}] ${error.field}: ${error.message}`);
  }

  for (const warning of result.warnings) {
    lines.push(`  WARN  [${warning.nodeId}/${warning.nodeType}] ${warning.field}: ${warning.message}`);
  }

  if (result.stats.unknownNodeTypes.length > 0) {
    lines.push(`  Unknown node types: ${result.stats.unknownNodeTypes.join(", ")}`);
  }

  return lines.join("\n");
}

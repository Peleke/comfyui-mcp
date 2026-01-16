/**
 * Contract Testing Types
 *
 * TypeScript interfaces for ComfyUI's /object_info schema and workflow validation.
 */

/**
 * A single input definition from ComfyUI's object_info.
 * Can be one of several formats:
 * - [string[]] - Enum/dropdown with allowed values
 * - [string, { default?: any, min?: number, max?: number, step?: number }] - Typed input with constraints
 * - ["*"] - Any type accepted
 */
export type ComfyUIInputDef =
  | [string[]] // Enum values
  | [string, { default?: unknown; min?: number; max?: number; step?: number; multiline?: boolean }]
  | [string] // Simple type reference
  | ["*"]; // Wildcard

/**
 * Node schema from ComfyUI's /object_info endpoint.
 */
export interface ComfyUINodeSchema {
  input: {
    required?: Record<string, ComfyUIInputDef>;
    optional?: Record<string, ComfyUIInputDef>;
    hidden?: Record<string, ComfyUIInputDef>;
  };
  input_order?: {
    required?: string[];
    optional?: string[];
  };
  output: string[];
  output_is_list: boolean[];
  output_name: string[];
  name: string;
  display_name: string;
  description: string;
  python_module: string;
  category: string;
  output_node: boolean;
  deprecated: boolean;
  experimental: boolean;
}

/**
 * Full object_info response from ComfyUI.
 */
export type ComfyUIObjectInfo = Record<string, ComfyUINodeSchema>;

/**
 * A node in a ComfyUI workflow.
 */
export interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: {
    title?: string;
  };
}

/**
 * A node input that references another node's output.
 * Format: [nodeId, outputIndex]
 */
export type NodeReference = [string, number];

/**
 * A ComfyUI workflow (prompt format).
 */
export type ComfyUIWorkflow = Record<string, WorkflowNode>;

/**
 * Single validation error.
 */
export interface ValidationError {
  nodeId: string;
  nodeType: string;
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Result of workflow validation.
 */
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

/**
 * Options for workflow validation.
 */
export interface ValidationOptions {
  /** Skip validation of node types not in schema (for custom nodes) */
  allowUnknownNodes?: boolean;
  /** Skip validation of enum values (for dynamic values) */
  skipEnumValidation?: boolean;
  /** Treat warnings as errors */
  strictMode?: boolean;
}

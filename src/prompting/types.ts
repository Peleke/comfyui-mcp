/**
 * Model families supported by the prompt engineering system
 */
export type ModelFamily =
  | "illustrious"  // Illustrious XL, NovelAI-style
  | "pony"         // Pony Diffusion, score tags
  | "sdxl"         // Standard SDXL
  | "flux"         // Flux models (natural language)
  | "sd15"         // SD 1.5 (tag-based)
  | "realistic";   // Realistic photo models

/**
 * Content rating for the generation
 */
export type ContentRating = "safe" | "suggestive" | "explicit";

/**
 * Style presets for quick generation
 */
export type StylePreset =
  | "anime"
  | "realistic_photo"
  | "digital_art"
  | "oil_painting"
  | "watercolor"
  | "sketch"
  | "3d_render"
  | "pixel_art"
  | "comic"
  | "cinematic"
  | "fantasy"
  | "sci_fi"
  | "portrait"
  | "landscape"
  | "concept_art";

/**
 * Camera/photography settings for realistic generations
 */
export interface CameraSettings {
  focalLength?: string;  // e.g., "85mm", "35mm", "200mm"
  aperture?: string;     // e.g., "f/1.4", "f/8"
  lighting?: string;     // e.g., "golden hour", "studio lighting"
  angle?: string;        // e.g., "low angle", "bird's eye", "dutch angle"
}

/**
 * Input for prompt generation
 */
export interface PromptRequest {
  /** Natural language description of what to generate */
  description: string;

  /** Target model family (will auto-detect from model name if not specified) */
  modelFamily?: ModelFamily;

  /** Actual model name for auto-detection */
  modelName?: string;

  /** Style preset to apply */
  style?: StylePreset;

  /** Content rating */
  rating?: ContentRating;

  /** Camera settings for realistic images */
  camera?: CameraSettings;

  /** Additional style keywords to include */
  styleKeywords?: string[];

  /** Things to emphasize (will be weighted) */
  emphasize?: string[];

  /** Aspect ratio hint */
  aspectRatio?: "portrait" | "landscape" | "square" | "wide" | "tall";
}

/**
 * LoRA recommendation
 */
export interface LoraRecommendation {
  /** LoRA name pattern to search for */
  namePattern: string;

  /** Why this LoRA is recommended */
  reason: string;

  /** Recommended model strength */
  strengthModel: number;

  /** Recommended clip strength */
  strengthClip: number;

  /** Whether this is essential or optional */
  priority: "essential" | "recommended" | "optional";
}

/**
 * Generated prompt output
 */
export interface GeneratedPrompt {
  /** The optimized positive prompt */
  positive: string;

  /** The recommended negative prompt */
  negative: string;

  /** Detected or specified model family */
  modelFamily: ModelFamily;

  /** Recommended generation settings */
  recommendedSettings: {
    steps?: number;
    cfgScale?: number;
    sampler?: string;
    scheduler?: string;
    width?: number;
    height?: number;
  };

  /** Recommended LoRAs based on style/content */
  recommendedLoras?: LoraRecommendation[];

  /** Trigger words that should be in prompt if using certain LoRAs */
  loraTriggerWords?: string[];

  /** Explanation of prompt construction */
  explanation: string;

  /** Alternative prompt variations */
  variations?: string[];

  /** Suggested workflow pipeline for best results */
  suggestedPipeline?: WorkflowPipeline;
}

/**
 * A pipeline of workflows to execute in sequence
 */
export interface WorkflowPipeline {
  /** Pipeline name */
  name: string;

  /** Description of what this pipeline does */
  description: string;

  /** Steps in the pipeline */
  steps: PipelineStep[];
}

/**
 * A single step in a workflow pipeline
 */
export interface PipelineStep {
  /** Step type */
  type: "txt2img" | "img2img" | "upscale" | "custom";

  /** Step name for display */
  name: string;

  /** Custom workflow template name (for type: "custom") */
  templateName?: string;

  /** Settings overrides for this step */
  settings?: {
    denoise?: number;
    steps?: number;
    cfgScale?: number;
    width?: number;
    height?: number;
    upscaleModel?: string;
  };
}

/**
 * Model detection result
 */
export interface ModelDetection {
  family: ModelFamily;
  confidence: number;
  reason: string;
}

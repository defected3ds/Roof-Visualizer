import type { ProviderConfig, ProviderType } from '../types';

/** The image-model APIs the app can call (see server/providers.ts). Shared with the admin. */
export const PROVIDER_TYPES: Record<ProviderType, { label: string; defaultModel: string; defaultKeyEnv: string; help: string }> = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-nano-banana-2.1',
    defaultKeyEnv: 'GEMINI_API_KEY',
    help: 'Model name from Google AI Studio, e.g. gemini-nano-banana-2.1.',
  },
  openai: {
    label: 'OpenAI Images',
    defaultModel: 'gpt-image-2.5-flare',
    defaultKeyEnv: 'OPENAI_API_KEY',
    help: 'An OpenAI image model that supports edits: gpt-image-2.5-flare (fast), gpt-image-2.5-sunburst (most precise) or gpt-image-1.',
  },
  bfl: {
    label: 'Black Forest Labs (bfl.ai)',
    defaultModel: 'flux-2-pro',
    defaultKeyEnv: 'BFL_API_KEY',
    help: 'The endpoint name after api.bfl.ai/v1/, e.g. flux-2-pro, flux-2-max or flux-kontext-pro.',
  },
  fal: {
    label: 'fal.ai',
    defaultModel: 'fal-ai/nano-banana-pro/edit',
    defaultKeyEnv: 'FAL_KEY',
    help: 'The model id from the fal.ai model page, e.g. krea/v3/edit, fal-ai/nano-banana-pro/edit or fal-ai/flux-pro/kontext.',
  },
  kie: {
    label: 'kie.ai',
    defaultModel: 'google/nano-banana-edit',
    defaultKeyEnv: 'KIE_API_KEY',
    help: 'The model name from the kie.ai docs, e.g. google/nano-banana-edit.',
  },
  replicate: {
    label: 'Replicate',
    defaultModel: 'black-forest-labs/flux-kontext-pro',
    defaultKeyEnv: 'REPLICATE_API_TOKEN',
    help: 'owner/model from replicate.com, e.g. black-forest-labs/flux-kontext-pro.',
  },
  demo: { label: 'Demo (no AI)', defaultModel: '', defaultKeyEnv: '', help: '' },
};

/** Models that accept several input images on the aggregator APIs (fal.ai, kie.ai). */
const MULTI_IMAGE = /nano-banana|gemini|seedream|flux-2|flux\.2|qwen|gpt-image|edit/i;

/**
 * How many images (house photo included) a model accepts. Extra inputs are dropped in priority
 * order: house photo, depth map, roof mask, product photos.
 */
export function imageLimit(cfg: Pick<ProviderConfig, 'type' | 'model'>): number {
  switch (cfg.type) {
    case 'gemini':
      return 8;
    case 'openai':
      return 8;
    case 'bfl':
      return /^flux-2/i.test(cfg.model) ? 8 : 1; // FLUX.2: input_image + input_image_2..8; Kontext: one image
    case 'fal':
      return MULTI_IMAGE.test(cfg.model) && !/kontext/i.test(cfg.model) ? 8 : 1;
    case 'kie':
      return MULTI_IMAGE.test(cfg.model) && !/kontext/i.test(cfg.model) ? 10 : 1;
    case 'replicate':
      return 1;
    case 'demo':
      return 8; // runs the whole pipeline so it can be tried without a key
  }
}

export type SwatchPattern = 'barrel' | 'flat-tile' | 'shingle' | 'slate' | 'shake' | 'seam';

export interface Category {
  id: string;
  name: string;
  /** Short hint for the AI about this kind of roofing, e.g. "Clay or concrete roof tiles." */
  description: string;
}

export interface Spec {
  label: string;
  value: string;
}

export interface Product {
  id: string;
  name: string;
  /** Category id. */
  category: string;
  /** Brand or product line, e.g. "Koramic" or "Tondach". */
  brand: string;
  /** What the AI is told about the product: shape, colour, finish, size, how it is laid. */
  description: string;
  /** Technical data, e.g. { label: "Tiles per m²", value: "10.9–11.8" }. Also sent to the AI. */
  specs: Spec[];
  /** Photo URLs (/product-images/<id>/<file>). The first one is the thumbnail. */
  images: string[];
  /** Drawn texture used when a product has no photos. */
  swatch?: { pattern: SwatchPattern; colors: [string, string, string] };
}

/** Body of POST /api/admin/products: images are existing URLs to keep or data URLs to add. */
export type ProductInput = Omit<Product, 'id' | 'swatch'> & { id?: string };

/** App texts that differ from the defaults in src/texts.ts. */
export type Texts = Record<string, string>;

export interface Catalog {
  categories: Category[];
  products: Product[];
}

export interface GenerateBody {
  /** The house photo as a data URL. */
  image: string;
  productId: string;
  /** Drawn texture of the product as a data URL, used when the product has no photos. */
  swatch?: string;
  /** Depth map of the house photo as a data URL (see src/lib/depth.ts). */
  depth?: string;
  /** Roof mask of the house photo as a data URL, white = roof (see src/lib/roofmask.ts). */
  mask?: string;
  count: number;
  /** Random id of the picked photo and of this Generate press, so the cost history can group the API calls. */
  photoId?: string;
  generationId?: string;
}

export interface GenerateResponse {
  images: string[];
  provider: string;
}

export type ProviderType = 'gemini' | 'openai' | 'bfl' | 'fal' | 'kie' | 'replicate' | 'demo';

/** One image-model API the admin can switch to. API keys never live here, only the name of the env variable. */
export interface ProviderConfig {
  id: string;
  label: string;
  type: ProviderType;
  /** Model name at the provider, e.g. "gemini-nano-banana-2.1" or "black-forest-labs/flux-kontext-pro". */
  model: string;
  /** Name of the server environment variable holding the API key, e.g. GEMINI_API_KEY. */
  keyEnv: string;
  /** Optional system prompt used instead of the general one, e.g. a shorter one for a model with a prompt limit. */
  systemPrompt?: string;
}

/** AI settings edited in /admin > AI settings (data/ai.json). */
export interface AiSettings {
  /** General instructions; {{product}} and {{images}} mark where product data and the image guide go. */
  systemPrompt: string;
  include: {
    /** Product description and category note. */
    productData: boolean;
    /** Technical data sheet. */
    specs: boolean;
    productPhotos: boolean;
    depthMap: boolean;
    roofMask: boolean;
  };
  /** Product photos sent per generation (1–3). */
  maxProductPhotos: number;
  /** Results per generation (1–4). */
  variants: number;
  /** Show line and edge maps of the photo while generating (display only, never sent to the AI). */
  showEdgeMaps: boolean;
  /** How the roof mask is made. */
  segmentation: SegmentationSettings;
  /** How the depth map is made. */
  depthEstimation: DepthSettings;
  activeProvider: string;
  providers: ProviderConfig[];
}

/** How the depth map is made. */
export interface DepthSettings {
  /** browser = Depth Anything V2 small on the visitor's device (free, coarse); marigold = Marigold and midas = MiDaS, both on fal.ai (server, paid). */
  tool: 'browser' | 'marigold' | 'midas';
  /** Env variable with the fal.ai key, e.g. FAL_API_KEY. */
  keyEnv: string;
  /** Marigold speed / quality preset. */
  quality: 'fast' | 'balanced' | 'best';
}

export interface SegmentationSettings {
  /** sam3 = Meta SAM 3 on fal.ai (sharp, about $0.005 per photo); clipseg = free, in the browser, rough. */
  tool: 'sam3' | 'clipseg';
  /** Env variable with the fal.ai key, e.g. FAL_API_KEY. */
  keyEnv: string;
  /** What SAM 3 looks for, e.g. "roof". */
  prompt: string;
}

/** What the admin receives: settings plus which providers have their API key set on the server. */
export interface AiSettingsView {
  settings: AiSettings;
  keyStatus: Record<string, boolean>;
  /** Whether the roof mask tool's key is set on the server. */
  segmentationKey: boolean;
  /** Whether the depth map tool's key is set on the server. */
  depthKey: boolean;
}

// ---- Cost history (Admin > Costs) ----------------------------------------------------------

/** One line of the price table used to estimate what an API call costs. */
export interface PriceItem {
  id: string;
  label: string;
  /** What the price is per, e.g. "result", "megapixel", "photo", "compute second". */
  unit: string;
  /** US dollars per unit. */
  price: number;
  note?: string;
}

export interface UsageSettings {
  /** Previews of visitors' photos are deleted after this many days; the costs stay. */
  retentionDays: number;
  prices: PriceItem[];
}

/** One API call (a generation, a depth map, a roof mask, or an admin test). */
export interface UsageEvent {
  id: number | string;
  created_at: string;
  /** image | depth | roof-mask, or test-image | test-depth | test-roof-mask for admin tests. */
  kind: string;
  photo_id?: string | null;
  generation_id?: string | null;
  product?: string | null;
  provider?: string | null;
  model?: string | null;
  results?: number | null;
  ms?: number | null;
  /** Estimated cost in US dollars. */
  cost: number;
  detail?: Record<string, unknown> | null;
  /** Small previews (data URLs); removed after the retention period. */
  previews?: { house?: string; results?: string[] } | null;
}

export interface UsageView {
  /** supabase = kept for good; memory = lost when the server restarts. */
  storage: 'supabase' | 'memory';
  lastError?: string;
  events: UsageEvent[];
  settings: UsageSettings;
}

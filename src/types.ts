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
  activeProvider: string;
  providers: ProviderConfig[];
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
}

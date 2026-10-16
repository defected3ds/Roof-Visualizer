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
  count: number;
}

export interface GenerateResponse {
  images: string[];
  provider: string;
}

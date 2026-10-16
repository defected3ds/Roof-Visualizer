export type Category = 'Tile' | 'Shingles' | 'Slate' | 'Shake' | 'Metal';

export type SwatchPattern = 'barrel' | 'flat-tile' | 'shingle' | 'slate' | 'shake' | 'seam';

export interface Product {
  id: string;
  name: string;
  category: Category;
  /** Brand or product line, e.g. "Koramic" or "Tondach". */
  brand: string;
  /** What the AI is told about the product: shape, colour, finish, size, how it is laid. */
  description: string;
  /** Photo URLs (/product-images/<id>/<file>). The first one is the thumbnail. */
  images: string[];
  /** Drawn texture used when a product has no photos. */
  swatch?: { pattern: SwatchPattern; colors: [string, string, string] };
}

/** Body of POST /api/admin/products: images are existing URLs to keep or data URLs to add. */
export type ProductInput = Omit<Product, 'id' | 'swatch'> & { id?: string };

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

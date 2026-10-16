export type Category = 'Tile' | 'Shingles' | 'Slate' | 'Shake' | 'Metal';

export type SwatchPattern = 'barrel' | 'flat-tile' | 'shingle' | 'slate' | 'shake' | 'seam';

export interface Material {
  id: string;
  name: string;
  category: Category;
  /** Natural-language description sent to the image model. */
  prompt: string;
  pattern: SwatchPattern;
  /** Base, shadow and highlight colours used to paint the swatch. */
  colors: [string, string, string];
}

export interface GenerateRequest {
  /** The house photo as a data URL. */
  image: string;
  /** Optional rendered swatch of the material as a data URL, used as a texture reference. */
  swatch?: string;
  material: Pick<Material, 'name' | 'category' | 'prompt'>;
  count: number;
}

export interface GenerateResponse {
  images: string[];
  provider: string;
}

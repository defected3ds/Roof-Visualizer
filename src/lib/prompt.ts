import type { AiSettings, Category, Product, ProviderConfig } from '../types';
import { promptLimit } from './models';

/**
 * Builds the final prompt sent to the image model: the admin's general system prompt plus the
 * selected product's data plus a guide to the attached images. Shared by the server (generation)
 * and the admin (live preview), so the preview is exactly what the model receives.
 */

export const DEFAULT_SYSTEM_PROMPT = `You are editing a real photograph of a house to show how it would look with a new roof.

Keep the house and its surroundings exactly as they are: the same camera angle, framing, walls, windows, doors, chimneys, gutters, trim, sky, trees, people and lighting.

Replace ONLY the roof covering with the selected product described below.

Preserve the exact roof geometry: ridges, hips, valleys, dormers, eaves, verges and pitch must not move or change shape.

Lay the new tiles in correct perspective on every roof plane, with realistic tile size and course spacing, straight courses, matching ridge and hip tiles, natural shadows and the same light, colour temperature and weather as the photo.

The result must look like a real, unedited photograph, not a render.

{{product}}

{{images}}`;

/** What the model receives besides the house photo, in this order. */
export interface ImageRoles {
  depth: boolean;
  mask: boolean;
  /** Number of product photos (0 when a drawn texture sample is sent instead). */
  productPhotos: number;
  /** A drawn texture sample is sent because the product has no photos. */
  swatch: boolean;
}

/** First number in a value such as "262 mm" or "10.5 tiles per m²". */
function firstNumber(value: string | undefined): number | null {
  const m = value?.replace(',', '.').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Tile size in terms the model can use against the photo: tiles per metre, courses per metre, and how many courses
 * a door, window or person spans. Built from the technical data (cover width, batten gauge or hanging length).
 */
export function scaleGuide(product: Product): string | null {
  const spec = (re: RegExp) => product.specs.find((s) => re.test(s.label))?.value;
  const cover = firstNumber(spec(/^cover width/i));
  const gaugeMin = firstNumber(spec(/minimum batten gauge/i));
  const gaugeMax = firstNumber(spec(/maximum batten gauge/i));
  const gauge = gaugeMin && gaugeMax ? (gaugeMin + gaugeMax) / 2 : gaugeMin ?? gaugeMax ?? firstNumber(spec(/^hanging length/i));
  if (!cover || !gauge || cover < 50 || gauge < 50 || cover > 1000 || gauge > 1000) return null;
  const courses = (metres: number) => Math.max(1, Math.round((metres * 1000) / gauge));
  return [
    `SCALE GUIDE: each tile covers about ${Math.round(cover)} mm of roof width and each course is about ${Math.round(gauge)} mm high up the slope (${(1000 / cover).toFixed(1)} tiles per metre across, ${(1000 / gauge).toFixed(1)} courses per metre up).`,
    `A door (2 m) is about ${courses(2)} courses high, a window (1.2 m) about ${courses(1.2)}, a person (1.75 m) about ${courses(1.75)}.`,
    'Judge the real roof size from doors, windows, gutters, chimneys, cars or people and draw the tiles at this physical size.',
  ].join(' ');
}

/**
 * What each technical-data field means for the image, so the model knows which numbers to draw and which to ignore.
 * Matched on the admin's label; the first match wins, so specific labels come before general ones.
 */
const SPEC_NOTES: [RegExp, string][] = [
  [/vertical wall|\bwall\b/i, 'applies to wall cladding, not to the roof; ignore it for the roof.'],
  [/^material/i, 'what the tile is made of; it sets the surface character (fired clay, concrete, slate and so on).'],
  [/length\s*[×x*]\s*width|overall dimensions/i, 'full size of one loose tile, including the parts hidden under neighbouring tiles; it is NOT the visible size on the roof.'],
  [/cover(ing)? width|effective cover/i, 'visible width of one installed tile across the roof (side overlap removed): the spacing of tiles along each course.'],
  [/hanging length|covering length/i, 'length of the tile as it hangs from the batten; the headlap hides part of it, so the visible course height is smaller.'],
  [/profile depth/i, 'height of the tile relief from its lowest to highest point: how deep the rolls, ribs or camber and their shadows look. A few millimetres means almost flat.'],
  [/covering capacity|tiles per m/i, 'tiles per square metre of roof: a higher number means smaller visible tiles.'],
  [/roof pitch/i, 'installation rule only; never change the pitch of the roof in the photo to match it.'],
  [/headlap/i, 'how far each course overlaps the course below; hidden on the finished roof, it shortens the visible course height.'],
  [/batten gauge/i, 'distance between battens = the visible height of each course up the slope; use it for the course spacing.'],
  [/weight/i, 'not visible; ignore it for the image.'],
  [/per pallet|quantity/i, 'logistics only; ignore it for the image.'],
  [/product id|article|\bsku\b|\bean\b/i, 'catalogue reference only; ignore it and never draw it.'],
  [/installation|laying|bond/i, 'how the tiles are laid; follow this pattern.'],
  [/colou?r/i, 'the colour name; the product photos remain the reference for the exact tone.'],
  [/finish|surface/i, 'the surface finish; show it only as far as the product photos support it.'],
];

const specNote = (label: string) => SPEC_NOTES.find(([re]) => re.test(label))?.[1];

/**
 * One line per technical-data field, with what it means for the image when that is known. A note is given once:
 * minimum and maximum of the same field (batten gauge, headlap) share it.
 */
function specLines(product: Product, explain: boolean): string[] {
  const given = new Set<string>();
  return product.specs
    .filter((s) => s.value.trim())
    .map((s) => {
      const label = s.label.trim();
      const value = s.value.trim().replace(/\.$/, '');
      let note = explain && label ? specNote(label) : undefined;
      if (note && given.has(note)) note = undefined;
      if (note) given.add(note);
      return `- ${label ? `${label}: ` : ''}${value}${note ? `. Meaning: ${note}` : ''}`;
    });
}

export function productBlock(settings: AiSettings, product: Product, category?: Category, explain = true): string {
  const label = [product.brand, product.name].filter(Boolean).join(' ');
  const kind = category ? ` (${category.name})` : '';
  const lines = [`SELECTED PRODUCT: ${label}${kind}.`];
  if (settings.include.productData) {
    if (category?.description) lines.push(`Product type: ${category.description}`);
    lines.push(`Appearance: ${product.description}`);
  }
  if (settings.include.specs && product.specs.length) {
    lines.push('Technical data (use it for the correct tile size, proportions and colour):', ...specLines(product, explain));
    const guide = scaleGuide(product);
    if (guide) lines.push(guide);
  }
  return lines.join('\n');
}

export function imageGuide(roles: ImageRoles): string {
  const lines = ['ATTACHED IMAGES:', 'Image 1 is the photo of the house to edit. Return an edited version of this photo only.'];
  let n = 2;
  if (roles.depth) {
    lines.push(
      `Image ${n} is a depth map of the house photo (brighter = closer to the camera). Use it only to understand the 3D shape: the orientation and pitch of each roof plane and where ridges, hips, valleys and eaves are, so the tile courses follow those planes in perspective. Never draw it into the result.`,
    );
    n += 1;
  }
  if (roles.mask) {
    lines.push(
      `Image ${n} is a roof mask of the house photo: white marks the roof area to re-cover, black must stay unchanged. It is approximate; follow the real roof edges in the photo. Never draw it into the result.`,
    );
    n += 1;
  }
  if (roles.productPhotos > 0) {
    const which = roles.productPhotos === 1 ? `Image ${n} is a reference photo` : `Images ${n} to ${n + roles.productPhotos - 1} are reference photos`;
    lines.push(
      `${which} of the selected product: reproduce its shape and profile, colour and colour variation, surface finish and size as faithfully as possible. Use them only as a material reference, never copy their background or composition.`,
    );
  } else if (roles.swatch) {
    lines.push(`Image ${n} is a texture sample of the material: match its colour, profile and pattern.`);
  }
  return lines.join('\n');
}

/** The final prompt. `{{product}}` and `{{images}}` in the system prompt are replaced; missing ones are appended. */
export function buildFinalPrompt(
  settings: AiSettings,
  product: Product,
  category: Category | undefined,
  roles: ImageRoles,
  variant = 0,
  measurements = '',
): string {
  let text = settings.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;
  const productText = [productBlock(settings, product, category), measurements].filter(Boolean).join('\n\n');
  const imagesText = imageGuide(roles);
  text = text.includes('{{product}}') ? text.replace('{{product}}', productText) : `${text}\n\n${productText}`;
  text = text.includes('{{images}}') ? text.replace('{{images}}', imagesText) : `${text}\n\n${imagesText}`;
  if (variant > 0) text += `\n\nVariation ${variant + 1}: allow natural, subtle differences in colour blend and weathering.`;
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The prompt for one model: its own system prompt if it has one, and shortened to the model's prompt limit
 * if needed. Product data and the image guide are always kept whole; the system prompt is cut at a paragraph.
 */
export function buildModelPrompt(
  settings: AiSettings,
  cfg: Pick<ProviderConfig, 'type' | 'model' | 'systemPrompt'>,
  product: Product,
  category: Category | undefined,
  roles: ImageRoles,
  variant = 0,
  measurements = '',
): { prompt: string; shortened: boolean } {
  const own = cfg.systemPrompt?.trim() ? { ...settings, systemPrompt: cfg.systemPrompt } : settings;
  const full = buildFinalPrompt(own, product, category, roles, variant, measurements);
  const limit = promptLimit(cfg);
  if (!limit || full.length <= limit) return { prompt: full, shortened: false };

  // Keep product data (without the field explanations, to save room) + image guide (+ variation note) whole, and fit as
  // much of the system prompt as possible.
  const tail = [
    productBlock(own, product, category, false),
    measurements,
    imageGuide(roles),
    variant > 0 ? `Variation ${variant + 1}: allow natural, subtle differences in colour blend and weathering.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const rules = (own.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT)
    .replace(/\{\{(product|images)\}\}/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const budget = limit - tail.length - 4;
  let head = '';
  for (const para of rules.split(/\n\n/)) {
    if (head.length + para.length + 2 > budget) break;
    head += (head ? '\n\n' : '') + para;
  }
  return { prompt: `${head}\n\n${tail}`.trim().slice(0, limit), shortened: true };
}

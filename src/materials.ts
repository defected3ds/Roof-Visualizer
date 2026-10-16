import type { Category, Material } from './types';

export const CATEGORIES: Category[] = ['Tile', 'Shingles', 'Slate', 'Shake', 'Metal'];

// Swatches are drawn procedurally (see lib/swatch.ts) so there are no image assets to license.
// To show a real product range, add entries here with the manufacturer's colour names and a
// precise prompt; the prompt matters far more to the result than the swatch.
export const MATERIALS: Material[] = [
  // Tile
  {
    id: 'barrel-terracotta',
    name: 'Barrel – Terracotta',
    category: 'Tile',
    pattern: 'barrel',
    colors: ['#b5532f', '#6e2a14', '#de8a5e'],
    prompt: 'classic orange-red terracotta Spanish barrel (S-profile) clay roof tiles',
  },
  {
    id: 'barrel-aged',
    name: 'Barrel – Aged Mission',
    category: 'Tile',
    pattern: 'barrel',
    colors: ['#8a4632', '#3e1d14', '#b9765a'],
    prompt: 'aged, weathered mission-style Spanish barrel clay roof tiles in dark red-brown with darker blended flashing',
  },
  {
    id: 'barrel-charcoal',
    name: 'Barrel – Charcoal',
    category: 'Tile',
    pattern: 'barrel',
    colors: ['#3b3b3d', '#161617', '#6a6a6e'],
    prompt: 'charcoal-black glazed Spanish barrel (S-profile) roof tiles with a subtle sheen',
  },
  {
    id: 'flat-red',
    name: 'Flat Tile – Brick Red',
    category: 'Tile',
    pattern: 'flat-tile',
    colors: ['#a2412c', '#5a1f12', '#cf6f55'],
    prompt: 'flat interlocking brick-red clay roof tiles in neat straight courses (European style)',
  },
  {
    id: 'flat-anthracite',
    name: 'Flat Tile – Anthracite',
    category: 'Tile',
    pattern: 'flat-tile',
    colors: ['#34383c', '#141618', '#5e656b'],
    prompt: 'modern matte anthracite-grey flat concrete roof tiles in clean straight courses',
  },
  // Shingles
  {
    id: 'shingle-charcoal',
    name: 'Architectural – Charcoal',
    category: 'Shingles',
    pattern: 'shingle',
    colors: ['#3d3f42', '#1c1d1f', '#6b6e72'],
    prompt: 'dimensional architectural asphalt shingles in blended charcoal grey',
  },
  {
    id: 'shingle-weathered',
    name: 'Architectural – Weathered Wood',
    category: 'Shingles',
    pattern: 'shingle',
    colors: ['#6e6457', '#3b342c', '#9b8f80'],
    prompt: 'dimensional architectural asphalt shingles in a weathered-wood brown-grey blend',
  },
  {
    id: 'shingle-brown',
    name: 'Architectural – Autumn Brown',
    category: 'Shingles',
    pattern: 'shingle',
    colors: ['#6b4a33', '#35231a', '#9a7255'],
    prompt: 'dimensional architectural asphalt shingles in warm autumn brown blend',
  },
  // Slate
  {
    id: 'slate-natural',
    name: 'Natural Slate – Grey',
    category: 'Slate',
    pattern: 'slate',
    colors: ['#4a5056', '#22262a', '#757d85'],
    prompt: 'natural split blue-grey slate roof tiles with slightly irregular edges and subtle colour variation',
  },
  {
    id: 'slate-black',
    name: 'Natural Slate – Black',
    category: 'Slate',
    pattern: 'slate',
    colors: ['#2a2c2f', '#0f1011', '#4d5156'],
    prompt: 'natural black slate roof tiles with a fine riven texture and soft sheen',
  },
  {
    id: 'slate-multi',
    name: 'Slate – Multi Blend',
    category: 'Slate',
    pattern: 'slate',
    colors: ['#5b5a5e', '#2b2a2d', '#8b7466'],
    prompt: 'mixed slate roof in a blend of grey, purple and rust-toned natural slates',
  },
  // Shake
  {
    id: 'shake-cedar',
    name: 'Cedar Shake – Natural',
    category: 'Shake',
    pattern: 'shake',
    colors: ['#9a6b43', '#55361f', '#c49468'],
    prompt: 'new natural red cedar wood shake roof with hand-split texture and varied plank widths',
  },
  {
    id: 'shake-aged',
    name: 'Cedar Shake – Silver Aged',
    category: 'Shake',
    pattern: 'shake',
    colors: ['#7d7a73', '#45423d', '#a9a59c'],
    prompt: 'weathered silver-grey aged cedar wood shake roof with hand-split texture',
  },
  // Metal
  {
    id: 'metal-black',
    name: 'Standing Seam – Matte Black',
    category: 'Metal',
    pattern: 'seam',
    colors: ['#26282a', '#0e0f10', '#4c5054'],
    prompt: 'matte black standing seam metal roof with vertical raised seams',
  },
  {
    id: 'metal-zinc',
    name: 'Standing Seam – Zinc Grey',
    category: 'Metal',
    pattern: 'seam',
    colors: ['#7f878e', '#4c5157', '#aab2b9'],
    prompt: 'pre-weathered zinc grey standing seam metal roof with vertical raised seams',
  },
  {
    id: 'metal-green',
    name: 'Standing Seam – Forest Green',
    category: 'Metal',
    pattern: 'seam',
    colors: ['#2f4a3a', '#15241b', '#527461'],
    prompt: 'forest green painted standing seam metal roof with vertical raised seams',
  },
];

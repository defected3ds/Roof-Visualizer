import type { Texts } from './types';

export interface TextField {
  key: string;
  label: string;
  value: string;
  /** Show a multi-line box in the admin. */
  long?: boolean;
  /** The value is a photo URL, uploaded in the admin. */
  image?: boolean;
}

/** Every text customers see, grouped by screen. Admins can override each one at /admin. */
export const TEXT_GROUPS: { title: string; fields: TextField[] }[] = [
  {
    title: 'Start screen',
    fields: [
      { key: 'start.image', label: 'Start screen photo', value: '/hero.jpg', image: true },
      { key: 'start.tag', label: 'Label above the title', value: 'Roof Visualizer' },
      { key: 'start.title', label: 'Title', value: 'See your house with a new roof' },
      {
        key: 'start.intro',
        label: 'Introduction',
        long: true,
        value:
          'Take a photo of your house, choose a roof from our range and see the result in seconds, while everything else stays as it is.',
      },
      { key: 'start.step1', label: 'Step 1', value: 'Photograph the house from the street, with the roof clearly visible, or upload a photo from your library.', long: true },
      { key: 'start.step2', label: 'Step 2', value: 'Choose a roofing product.', long: true },
      { key: 'start.step3', label: 'Step 3', value: 'Generate, swipe through the results and accept the one you like.', long: true },
      { key: 'start.camera', label: 'Camera button', value: 'Take a photo' },
      { key: 'start.gallery', label: 'Gallery button (phones and tablets)', value: 'Choose from gallery' },
      { key: 'start.upload', label: 'Upload button (computers)', value: 'Upload your photo' },
      {
        key: 'start.privacy',
        label: 'Privacy note under the buttons',
        value: 'Your photo is sent to our AI service. A small preview is kept for up to 30 days to improve the service, then deleted.',
        long: true,
      },
    ],
  },
  {
    title: 'Sign in',
    fields: [
      { key: 'login.title', label: 'Title', value: 'Sign in to continue' },
      { key: 'login.intro', label: 'Introduction', long: true, value: 'Enter the access code you received from wienerberger.' },
      { key: 'login.label', label: 'Field label', value: 'Access code' },
      { key: 'login.button', label: 'Button', value: 'Sign in' },
      { key: 'login.error', label: 'Wrong code message', value: 'That access code is not correct.' },
    ],
  },
  {
    title: 'Editor',
    fields: [
      { key: 'editor.heading', label: 'Label above the photo', value: 'New roof' },
      { key: 'editor.all', label: 'Filter showing all products', value: 'All' },
      { key: 'editor.generate', label: 'Generate button', value: 'Generate' },
      { key: 'editor.accept', label: 'Accept button', value: 'Accept' },
      { key: 'editor.generating', label: 'Text while generating', value: 'Generating images' },
      { key: 'editor.analysing', label: 'Text while the 3D depth map is calculated', value: 'Analysing 3D shape' },
      {
        key: 'editor.noAnalysis',
        label: 'Note when depth map and roof mask could not be made on this device',
        value: '3D analysis is not available on this device. The roof is generated from the photo only.',
      },
      { key: 'editor.history', label: 'Heading above the earlier results', value: 'Previous results' },
      { key: 'editor.before', label: 'Before label (compare)', value: 'Before' },
      { key: 'editor.after', label: 'After label (compare)', value: 'After' },
      { key: 'editor.details', label: 'Product details link', value: 'Technical data' },
    ],
  },
  {
    title: 'Messages',
    fields: [
      {
        key: 'message.swipe',
        label: 'Tip after the first results',
        long: true,
        value: 'Each generation gives several results. Swipe to see the others.',
      },
      { key: 'message.error', label: 'Generation failed', long: true, value: 'Something went wrong. Please try again.' },
      { key: 'message.limit', label: 'Too many generations', long: true, value: 'You have reached the limit for now. Please try again later.' },
      {
        key: 'message.unavailable',
        label: 'AI service not available',
        long: true,
        value: 'The roof generator is not available at the moment. Please try again later.',
      },
      { key: 'message.busy', label: 'AI service busy', long: true, value: 'The roof generator is very busy right now. Please try again in a minute.' },
    ],
  },
];

export const IMAGE_TEXT_KEYS = TEXT_GROUPS.flatMap((g) => g.fields.filter((f) => f.image).map((f) => f.key));

export const DEFAULT_TEXTS: Texts = Object.fromEntries(TEXT_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.value])));

export function textLookup(overrides: Texts) {
  return (key: string) => overrides[key]?.trim() || DEFAULT_TEXTS[key] || key;
}

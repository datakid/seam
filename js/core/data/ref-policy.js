const FRAMES = ['drawing', 'twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor', 'graphicFrame'];
const PICTURES = ['drawing', 'pict', 'twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor', 'pic'];

const image = { action: 'removeContainer', container: PICTURES, otherwise: 'dropAttribute', loss: 'image' };
const frame = (loss) => ({ action: 'removeContainer', container: FRAMES, otherwise: 'keep', loss });
const drop = (loss) => ({ action: 'remove', loss });

export const REF_POLICY = {
  'blip@embed': image,
  'blip@link': image,
  'imagedata@id': { action: 'removeContainer', container: ['pict'], otherwise: 'remove', loss: 'image' },
  'picture@id': drop('image'),

  'chart@id': frame('chart'),
  'userShapes@id': drop('chart'),
  'externalData@id': drop('data'),
  'relIds@dm': frame('diagram'),
  'relIds@lo': frame('diagram'),
  'relIds@qs': frame('diagram'),
  'relIds@cs': frame('diagram'),
  'oleObj@id': { action: 'removeContainer', container: ['pict', ...FRAMES], otherwise: 'keep', loss: 'object' },
  'OLEObject@id': { action: 'removeContainer', container: ['object'], otherwise: 'remove', loss: 'object' },

  'hyperlink@id': { action: 'unwrap', loss: 'link' },
  'hlinkClick@id': drop('link'),
  'hlinkHover@id': drop('link'),
  'hlinkMouseOver@id': drop('link'),

  'headerReference@id': drop('header'),
  'footerReference@id': drop('footer'),
  'altChunk@id': drop('embedded content'),
  'attachedTemplate@id': drop('template'),
  'embedRegular@id': drop('font'),
  'embedBold@id': drop('font'),
  'embedItalic@id': drop('font'),
  'embedBoldItalic@id': drop('font'),

  'sldLayoutId@id': drop('layout'),
  'sldMasterId@id': drop('master'),
  'sldId@id': drop('slide'),
  'notesMasterId@id': drop('notes master'),
  'handoutMasterId@id': drop('handout master'),

  'media@embed': drop('media'),
  'media@link': drop('media'),
  'audioFile@link': drop('media'),
  'videoFile@link': drop('media'),
  'wavAudioFile@embed': drop('media'),
  'quickTimeFile@link': drop('media'),

  'drawing@id': drop('drawing'),
  'legacyDrawing@id': drop('drawing'),
  'legacyDrawingHF@id': drop('drawing'),
  'tablePart@id': { action: 'remove', loss: 'table', parentCount: true, dropEmptyParent: true },

  '*': { action: 'keep', loss: 'unknown' }
};

export const REF_LOSS_NAMES = {
  image: ['image', 'images'],
  chart: ['chart', 'charts'],
  diagram: ['diagram', 'diagrams'],
  object: ['embedded object', 'embedded objects'],
  link: ['link', 'links'],
  header: ['header reference', 'header references'],
  footer: ['footer reference', 'footer references'],
  data: ['data link', 'data links'],
  layout: ['layout entry', 'layout entries'],
  master: ['master entry', 'master entries'],
  slide: ['slide entry', 'slide entries'],
  media: ['media item', 'media items'],
  drawing: ['drawing', 'drawings'],
  table: ['table', 'tables'],
  font: ['embedded font', 'embedded fonts'],
  template: ['template link', 'template links'],
  'embedded content': ['embedded content block', 'embedded content blocks'],
  'notes master': ['notes master entry', 'notes master entries'],
  'handout master': ['handout master entry', 'handout master entries']
};

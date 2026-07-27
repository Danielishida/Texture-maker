// Font registry. Ships broadly-available families and supports loading local
// font files (kept as buffers so the export worker can register them too).

export const BUILTIN_FONTS = [
  'Georgia',
  'Arial',
  'Verdana',
  'Impact',
  'Times New Roman',
  'Courier New',
  'Trebuchet MS',
];

export interface LoadedFont {
  family: string;
  data: ArrayBuffer;
}

const localFonts: LoadedFont[] = [];

export async function loadLocalFont(file: File): Promise<string> {
  const family = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[^\w -]/g, '');
  const data = await file.arrayBuffer();
  const face = new FontFace(family, data.slice(0));
  await face.load();
  (document.fonts as FontFaceSet & { add(f: FontFace): void }).add(face);
  localFonts.push({ family, data });
  return family;
}

export function getLocalFonts(): LoadedFont[] {
  return localFonts;
}

export function allFontFamilies(): string[] {
  return [...BUILTIN_FONTS, ...localFonts.map((f) => f.family)];
}

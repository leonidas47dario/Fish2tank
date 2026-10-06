/**
 * One fish's card, drawn as an image - spec 070, FR-R16.
 *
 * Beside crop.ts because it is the same kind of thing: bytes made from a
 * photograph on this device, by a canvas. The content (which lines exist at
 * all) is decided by `domain/catch-card.ts`; this only lays them out.
 *
 * Every colour and font arrives in `palette`, read from the live theme tokens
 * by the caller, so the card follows the keeper's territory and nothing here
 * names a colour (PRD 7.3). The numbers that remain are geometry in the
 * output image's own pixels - a fixed 1080 x 1350 export, not a layout that
 * flows.
 *
 * NFR-04 / spec 064: the output is re-encoded from a canvas, which writes no
 * EXIF, so the original's camera metadata - GPS included - cannot ride along.
 */
import { clampLines, wrapText } from '@/domain/catch-card';

export const CARD_WIDTH = 1080;
/** 4:5, the portrait shape photo apps display without cropping. */
export const CARD_HEIGHT = 1350;
const JPEG_QUALITY = 0.9;

export interface CardPalette {
  canvas: string;
  surface: string;
  text: string;
  muted: string;
  faint: string;
  legendary: string;
  onLegendary: string;
  edge: string;
  shadow: string;
  fontDisplay: string;
  fontBody: string;
  fontScientific: string;
}

export interface CardDrawing {
  title: string;
  kind?: string;
  scientific?: string;
  /** Finder, place and date, already worded. Each is one line. */
  meta: string[];
  golden: boolean;
  photo: CanvasImageSource & { width: number; height: number };
  palette: CardPalette;
}

const M = 72;                 // outer margin
const TOP = 96;               // room above the sticker for its tilt and shadow
const EDGE = 26;              // the paper edge around the photograph
const RADIUS_OUTER = 44;
const RADIUS_INNER = RADIUS_OUTER - EDGE / 2;
const TILT = (-1.2 * Math.PI) / 180;
const GAP = 64;               // sticker to text
const TEXT_W = CARD_WIDTH - 2 * M;

interface TextRun { font: string; color: string; lineHeight: number; lines: string[] }

function fonts(p: CardPalette) {
  return {
    title: `600 72px ${p.fontDisplay}`,
    kind: `500 40px ${p.fontBody}`,
    scientific: `italic 400 36px ${p.fontScientific}`,
    meta: `400 34px ${p.fontBody}`,
    mark: `700 30px ${p.fontBody}`,
    foot: `600 30px ${p.fontDisplay}`,
  };
}

/** Wait for every face the card uses, or it draws in a fallback and keeps it. */
export async function loadCardFonts(palette: CardPalette): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(Object.values(fonts(palette)).map((f) => document.fonts.load(f).catch(() => [])));
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCatchCard(d: CardDrawing): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the card (no 2D canvas).');
  const p = d.palette;
  const f = fonts(p);

  // --- The words first, because the photograph gets whatever they leave ---
  const measureWith = (font: string) => (s: string) => { ctx.font = font; return ctx.measureText(s).width; };
  const run = (font: string, color: string, lineHeight: number, text: string | undefined, max: number): TextRun[] => {
    if (!text) return [];
    const m = measureWith(font);
    return [{ font, color, lineHeight, lines: clampLines(wrapText(text, TEXT_W, m), max, TEXT_W, m) }];
  };
  const runs: TextRun[] = [
    ...run(f.title, p.text, 84, d.title, 2),
    ...run(f.kind, p.muted, 52, d.kind, 1),
    ...run(f.scientific, p.muted, 50, d.scientific, 1),
    ...d.meta.flatMap((line, i) => run(f.meta, p.muted, 48, line, 1).map((r) => (
      // A little air between the identity block and the facts under it.
      i === 0 ? { ...r, lineHeight: r.lineHeight + 16 } : r
    ))),
  ];
  const textH = runs.reduce((n, r) => n + r.lines.length * r.lineHeight, 0);
  // The wordmark, its margin, and clear air above it.
  const footH = M + 30 + 56;

  // --- Background: the surface ramping to the canvas, like the app --------
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  bg.addColorStop(0, p.surface);
  bg.addColorStop(0.6, p.canvas);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // --- The sticker: the whole photograph, never cropped -------------------
  const areaH = CARD_HEIGHT - TOP - GAP - textH - footH;
  const maxW = TEXT_W - 2 * EDGE;
  const maxH = Math.max(areaH - 2 * EDGE, 200);
  const scale = Math.min(maxW / d.photo.width, maxH / d.photo.height);
  const pw = Math.round(d.photo.width * scale);
  const ph = Math.round(d.photo.height * scale);
  const sw = pw + 2 * EDGE;
  const sh = ph + 2 * EDGE;
  // A wide photograph leaves height over. The sticker and its words move
  // together into the middle of it, rather than the words sinking to the foot.
  const top = TOP + Math.max(0, (areaH - sh) / 2);
  const cx = CARD_WIDTH / 2;
  const cy = top + sh / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(TILT);
  ctx.translate(-sw / 2, -sh / 2);

  ctx.shadowColor = p.shadow;
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  if (d.golden) {
    const foil = ctx.createLinearGradient(0, 0, sw, sh);
    foil.addColorStop(0, p.legendary);
    foil.addColorStop(0.5, p.edge);
    foil.addColorStop(1, p.legendary);
    ctx.fillStyle = foil;
  } else {
    ctx.fillStyle = p.edge;
  }
  roundedRect(ctx, 0, 0, sw, sh, RADIUS_OUTER);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.save();
  roundedRect(ctx, EDGE, EDGE, pw, ph, RADIUS_INNER);
  ctx.clip();
  ctx.drawImage(d.photo, EDGE, EDGE, pw, ph);
  ctx.restore();

  if (d.golden) {
    // A word, not only a colour (NFR-06).
    const label = '★ Golden';
    ctx.font = f.mark;
    const w = ctx.measureText(label).width + 40;
    roundedRect(ctx, EDGE + 22, EDGE + 22, w, 52, 26);
    ctx.fillStyle = p.legendary;
    ctx.fill();
    ctx.fillStyle = p.onLegendary;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, EDGE + 42, EDGE + 22 + 27);
  }
  ctx.restore();

  // --- The words ----------------------------------------------------------
  ctx.textBaseline = 'alphabetic';
  let y = top + sh + GAP;
  for (const r of runs) {
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    for (const line of r.lines) {
      y += r.lineHeight;
      ctx.fillText(line, M, y - r.lineHeight * 0.25);
    }
  }

  ctx.font = f.foot;
  ctx.fillStyle = p.faint;
  ctx.fillText('Fish2Tank', M, CARD_HEIGHT - M);

  return canvas;
}

export function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The card could not be encoded.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/**
 * Line-art fallback icons for email item rows that have no product photo.
 *
 * Drawn in a single mid-grey (#8a8a90) on transparent, deliberately: an email
 * tile is #f4f4f4 in light mode and #262626 in dark, and a midtone with enough
 * contrast against both means ONE asset works in either — no display:none image
 * swapping, which is unreliable in Outlook.
 *
 * 112px canvas = 2x the 56px slot. Stroke 4 = an effective 2px hairline.
 */
import sharp from 'sharp';
import path from 'path';

const C = '#8a8a90';
const S = 4;
const wrap = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112">
     <g fill="none" stroke="${C}" stroke-width="${S}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
   </svg>`;

const ICONS = {
  // Lyophilised vial: crimp cap, shoulder, body, and the fill line. The default
  // for anything we can't identify — every peptide we sell ships as one.
  vial: wrap(`
    <path d="M44 26h24"/>
    <path d="M46 26v8a4 4 0 0 1-1 3l-3 3a10 10 0 0 0-3 7v33a8 8 0 0 0 8 8h18a8 8 0 0 0 8-8V47a10 10 0 0 0-3-7l-3-3a4 4 0 0 1-1-3v-8"/>
    <path d="M39 62h34"/>`),

  // Syringe, drawn horizontally. A 45-degree version was tried first and is
  // illegible at 28px: the barrel, plunger and needle all cross the same
  // diagonal and read as a scribble. Flat, the silhouette survives the size.
  syringe: wrap(`
    <path d="M20 48v16"/>
    <path d="M20 56h14"/>
    <path d="M34 38v36"/>
    <rect x="34" y="45" width="36" height="22" rx="2"/>
    <path d="M46 50v12"/>
    <path d="M56 50v12"/>
    <path d="M70 56h10"/>
    <path d="M80 56h14"/>`),

  // Sealed sachet — a swab arrives as a foil packet, not a cotton bud.
  swab: wrap(`
    <rect x="30" y="30" width="52" height="52" rx="6"/>
    <path d="M30 44h52"/>
    <path d="M42 62h28"/>`),

  // Bacteriostatic water and any other liquid.
  droplet: wrap(`
    <path d="M56 26c0 0 20 22 20 34a20 20 0 0 1-40 0c0-12 20-34 20-34z"/>
    <path d="M46 62a10 10 0 0 0 10 10"/>`),
};

const outDir = process.argv[2];
for (const [name, svg] of Object.entries(ICONS)) {
  const file = path.join(outDir, `${name}.png`);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
  console.log(`${name.padEnd(9)} -> ${file}`);
}

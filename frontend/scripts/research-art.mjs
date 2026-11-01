// The /research hub illustration: a line drawing in Ascend's colours (Ink, one Cobalt detail), generated
// through OpenRouter (openai/gpt-5.4-image-2, about $0.16 an image, 2026-11-01) and turned into transparent
// responsive files. Its own subject: Teliti's hub art must not be reused here (Teliti DECISIONS #19).
//
//   OPENROUTER_API_KEY=… node scripts/research-art.mjs gen [n]   → scripts/.art-raw/hub-<i>.png (git-ignored)
//   node scripts/research-art.mjs process <raw.png>               → public/research/hub-<w>.webp + prints size
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(here, '.art-raw');
const OUT = path.resolve(here, '../public/research');
const WIDTHS = [480, 720, 960];

const STYLE =
  'Rendered as a precise technical line drawing in the manner of a scientific patent illustration or a lab-notebook ink drawing. Strict isometric three-quarter view. Thin uniform line weight in near-black ink (#0A0A0A), with exactly one small detail picked out in cobalt blue (#3155D9). Line art with at most a very light cool grey flat fill on some surfaces; no shading gradients, no hatching, no glow, no reflection, no cast shadow, no ground plane, no scenery, no vignette, no depth of field. The subject floats alone on a plain pure white (#FFFFFF) background with generous empty margin all round: no paper texture, no grid, no frame, no border. Absolutely no text, no letters, no numbers, no labels, no logos, no watermark, no people, no hands, no syringes, no needles.';
const SUBJECT =
  'A research desk arrangement: a clipboard holding a printed study page with two columns of abstract lines and a small dose-response curve, an open lab notebook beside it with ruled lines, a single small sealed glass vial with a flip-off cap standing next to them, and a magnifying glass resting across the corner of the clipboard; the vial cap is the cobalt detail.';

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'gen') {
  await fs.mkdir(RAW, { recursive: true });
  for (let i = 1; i <= Number(arg ?? 1); i++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-5.4-image-2',
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: `${SUBJECT} ${STYLE} Composition: wide, the subject in the middle of the frame.` }],
        image_config: { aspect_ratio: '3:2' },
      }),
    });
    const body = await res.json();
    const img = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!res.ok || !img) { console.error(res.status, JSON.stringify(body).slice(0, 300)); continue; }
    const file = path.join(RAW, `hub-${Date.now()}-${i}.png`);
    await fs.writeFile(file, Buffer.from(img.split(',')[1], 'base64'));
    console.log(file, 'cost', body.usage?.cost ?? '?');
  }
} else if (cmd === 'process') {
  // White becomes transparency by un-multiplying from white, so the ink keeps its colour on any background.
  const { data, info } = await sharp(arg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let p = 0; p < info.width * info.height; p++) {
    const r = data[p * 3], g = data[p * 3 + 1], b = data[p * 3 + 2];
    const a = 1 - Math.min(r, g, b) / 255;
    if (a < 0.05) continue;
    const un = (c) => Math.max(0, Math.min(255, Math.round(255 - (255 - c) / a)));
    out.set([un(r), un(g), un(b), Math.round(a * 255)], p * 4);
  }
  const master = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const m = await sharp(master).metadata();
  await fs.mkdir(OUT, { recursive: true });
  for (const w of WIDTHS) await sharp(master).resize({ width: w }).webp({ quality: 72, alphaQuality: 80, effort: 6 }).toFile(path.join(OUT, `hub-${w}.webp`));
  console.log(`master ${m.width}×${m.height}; at 960 wide: ${960}×${Math.round((m.height / m.width) * 960)}`);
} else {
  console.error('usage: research-art.mjs gen [n] | process <raw.png>');
  process.exit(1);
}

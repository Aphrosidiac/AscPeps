import { env } from '../../../config/env.js';
import { effortFor, supportsEffort } from './models.js';

// The assistant's eyes. The everyday model is text-only, so a picture an
// operator sends is turned into text here — once, before the turn — and the
// transcript is stored on their message. That is a deliberate choice over
// handing the image to the turn's model directly: it works whichever model
// the Assistant page has selected, the transcript is in the thread for every
// later turn ("the address in that screenshot"), it shows on the dashboard,
// and the grounding guard can treat the picture's numbers as things the
// operator gave, not things the model made up.
//
// Verbatim, not a summary: the reader of an order screenshot needs the
// phone number and the address exactly, and a vision model asked to
// "describe" will helpfully paraphrase both.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const VISION_PROMPT = `You are the eyes for an admin assistant that cannot see images. Transcribe this image so the assistant can work from your text alone.
Write out ALL text in the image verbatim — names, phone numbers, addresses, product names, quantities, prices, dates, order or reference numbers — keeping the original line breaks and order, and marking who said what if it is a chat. Then add one line starting with "Image:" saying what kind of image it is (chat screenshot, bank transfer receipt, product photo, shipping label, handwritten note...). Do not summarise, interpret, correct spelling, or leave anything out. Plain text only, no markdown.`;

export interface InboundImage {
  mimeType: string;
  // Raw base64, no data: prefix.
  base64: string;
}

export interface ImageReading {
  text: string;
  model: string;
  costUsd: number;
}

export async function readImage(image: InboundImage, opts: { signal?: AbortSignal; model?: string } = {}): Promise<ImageReading> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OpenRouter is not configured (OPENROUTER_API_KEY missing)');
  const model = opts.model ?? env.AGENT_VISION_MODEL;
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
        ],
      },
    ],
    max_tokens: 1500,
    usage: { include: true },
    // Low, not none: GLM refuses to switch reasoning off, and a moment of it
    // is what buys the speaker attribution.
    ...(supportsEffort(model) ? { reasoning: { effort: effortFor(model, 'low') } } : {}),
  };
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ascendpeptides.my',
      'X-Title': 'Ascend MY Admin Agent',
    },
    body: JSON.stringify(body),
    signal: opts.signal ?? AbortSignal.timeout(60_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json?.error?.message ?? `OpenRouter returned ${res.status}`).split(key).join('••••'));
  const text = String(json?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('the vision model returned nothing');
  return { text, model: String(json?.model ?? model), costUsd: Number(json?.usage?.cost ?? 0) };
}

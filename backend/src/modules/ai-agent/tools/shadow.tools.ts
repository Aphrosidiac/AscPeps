import type { AgentTool } from '../tool-kit.js';
import { clampLimit } from '../tool-kit.js';
import {
  assignMapping,
  listMapping,
  listShadowSkus,
  previewOrderSummary,
} from '../../admin/admin-shadow-skus.controller.js';
import { shadowCoverage } from '../../../utils/shadow-sku.js';

/**
 * Shadow SKUs, over WhatsApp.
 *
 * Two rules shape this file.
 *
 * First, THE AGENT NEVER PRODUCES THE SHEET. There is no tool here that
 * generates the internal summary PDF, because producing it is what freezes the
 * wording onto an order permanently, and that should be a thing a person does
 * having looked at it. `preview_internal_summary` reads and writes nothing.
 *
 * Second, and more important in practice: the agent talks to CUSTOMERS as well
 * as to the operator. Shadow names are internal vocabulary and mean nothing to
 * a buyer who ordered a named compound — so the note on every response says so.
 * Without it the model will happily answer "your order contains 1x Research
 * peptide, 5mg vial", which is both unhelpful and alarming to the person who
 * knows perfectly well what they bought.
 */

const INTERNAL_ONLY =
  'Internal vocabulary. Never use these names when talking to a customer — a customer ordered the real product and should always be told the real product name.';

export const shadowTools: AgentTool[] = [
  {
    name: 'list_shadow_skus',
    description:
      'The shadow codes themselves — the generalised names products can be listed under on internal paperwork. Says how many real SKUs use each one.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Matches the code or the name.' },
        limit: { type: 'number', description: 'Default 25, max 100.' },
      },
    },
    run: async ({ fastify }, args) => {
      const res = await listShadowSkus(fastify, {
        ...(args.search ? { search: String(args.search) } : {}),
        limit: String(clampLimit(args.limit, 25)),
      });
      return {
        shadowCodes: res.data.map((s) => ({
          code: s.code,
          name: s.name,
          active: s.active,
          mappedSkus: s.variantCount,
        })),
        total: res.pagination.total,
        note: INTERNAL_ONLY,
      };
    },
  },
  {
    name: 'shadow_coverage',
    description:
      'How much of the catalogue has a shadow code yet. The quick "what is still unmapped" — an order containing an unmapped SKU cannot produce an internal summary at all.',
    input_schema: { type: 'object', properties: {} },
    run: async ({ fastify }) => {
      const c = await shadowCoverage(fastify);
      return {
        sellableSkus: c.activeVariants,
        mapped: c.mapped,
        unmapped: c.unmapped,
        activeShadowCodes: c.activeShadowCount,
        note: INTERNAL_ONLY,
      };
    },
  },
  {
    name: 'list_shadow_mapping',
    description:
      'What each real SKU is listed as internally. Use unmappedOnly to get the gaps that need closing.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Matches the product name or the real SKU code.' },
        unmappedOnly: { type: 'boolean', description: 'Only SKUs with no shadow code yet.' },
        limit: { type: 'number', description: 'Default 25, max 100.' },
      },
    },
    run: async ({ fastify }, args) => {
      const res = await listMapping(fastify, {
        ...(args.search ? { search: String(args.search) } : {}),
        ...(args.unmappedOnly ? { unmapped: 'true' } : {}),
        limit: String(clampLimit(args.limit, 25)),
      });
      return {
        skus: res.data.map((r) => ({
          variantId: r.id,
          product: r.displayName,
          realCode: r.code,
          listedAs: r.shadowSku ? { code: r.shadowSku.code, name: r.shadowSku.name } : null,
        })),
        total: res.pagination.total,
        note: INTERNAL_ONLY,
      };
    },
  },
  {
    name: 'set_shadow_mapping',
    description:
      'Point one or more real SKUs at a shadow code, or clear it. Pass shadowCode null to unmap. Creating a NEW shadow code is done in the admin, not here.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        variantIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Real SKU (variant) ids, from list_shadow_mapping.',
        },
        shadowCode: {
          type: 'string',
          description: 'The shadow code to apply, e.g. LR-0042. Omit or pass null to unmap.',
        },
      },
      required: ['variantIds'],
    },
    run: async ({ fastify }, args) => {
      const variantIds = (args.variantIds as string[]) ?? [];
      let shadowSkuId: string | null = null;

      if (args.shadowCode) {
        const shadow = await fastify.prisma.shadowSku.findUnique({
          where: { code: String(args.shadowCode) },
        });
        if (!shadow) {
          return { error: `No shadow code "${args.shadowCode}". Use list_shadow_skus to see what exists.` };
        }
        shadowSkuId = shadow.id;
      }

      const res = await assignMapping(fastify, { variantIds, shadowSkuId });
      return {
        updated: res.updated,
        listedAs: args.shadowCode ?? null,
        note: INTERNAL_ONLY,
      };
    },
  },
  {
    name: 'preview_internal_summary',
    description:
      "An order's lines in generalised internal wording, with the real product beside each one, and whether a summary sheet could be produced for it at all. Read-only — the PDF itself is rendered in the admin.",
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string', description: 'Order number or id.' },
      },
      required: ['orderRef'],
    },
    run: async ({ fastify }, args) => {
      const s = await previewOrderSummary(fastify, String(args.orderRef));
      return {
        orderNumber: s.order.orderNumber,
        canProduceSheet: s.complete,
        lines: s.lines.map((l) => ({
          realProduct: l.realName,
          listedAs: l.name,
          code: l.code,
          quantity: l.quantity,
        })),
        // Real names, so the operator can act on the gap. This is an
        // operator-facing answer by definition — an unmapped SKU is a chore.
        blockedBy: s.unmapped.map((u) => ({ product: u.realName, realCode: u.realCode })),
        note: `${INTERNAL_ONLY} The customer receipt for this order is unchanged and lists the real products.`,
      };
    },
  },
];

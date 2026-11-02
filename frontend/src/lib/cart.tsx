'use client';

import { createContext, useContext, useReducer, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { CartItem } from '@/types';
import { lineIdOf, lineKey, lineMaxQuantity, lineUnitPrice } from '@/lib/cart-lines';
import { CartDrawer } from '@/components/cart/CartDrawer';

interface CartState {
  items: CartItem[];
  // True once LOAD has run — until then `items` is just the initial empty
  // array, not the customer's real cart. Consumers that redirect on an
  // empty cart (checkout) must wait for this.
  hydrated: boolean;
}

type CartAction =
  | { type: 'ADD_ITEM'; payload: CartItem }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'RESTORE_ITEM'; payload: { item: CartItem; index: number } }
  | { type: 'UPDATE_QUANTITY'; payload: { lineId: string; quantity: number } }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; payload: CartItem[] };

function clampToStock(quantity: number, max: number | undefined): number {
  return max != null ? Math.min(quantity, max) : quantity;
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      // Lines are keyed by the product size AND what it includes, so the same
      // vial with and without an optional extra are two lines. What a line
      // includes is per unit and follows its quantity — never a line of its own.
      const payload = { ...action.payload, lineId: action.payload.lineId ?? lineKey(action.payload.variantId, action.payload.includes) };
      const existing = state.items.find((i) => lineIdOf(i) === payload.lineId);
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            lineIdOf(i) === payload.lineId
              // Clamp to stock so repeated adds can't push the line past what
              // is actually available (missing on carts saved before stock was
              // tracked — no clamp then; the backend re-validates anyway).
              ? { ...i, includes: payload.includes ?? i.includes, quantity: clampToStock(i.quantity + payload.quantity, lineMaxQuantity({ ...i, stock: payload.stock ?? i.stock, includes: payload.includes ?? i.includes })) }
              : i
          ),
        };
      }
      return { ...state, items: [...state.items, { ...payload, quantity: clampToStock(payload.quantity, lineMaxQuantity(payload)) }] };
    }
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter((i) => lineIdOf(i) !== action.payload) };
    // Undo of a remove: the line goes back where it was.
    case 'RESTORE_ITEM': {
      const { item, index } = action.payload;
      const rest = state.items.filter((i) => lineIdOf(i) !== lineIdOf(item));
      rest.splice(Math.min(index, rest.length), 0, item);
      return { ...state, items: rest };
    }
    case 'UPDATE_QUANTITY':
      return {
        ...state,
        items: state.items.map((i) =>
          lineIdOf(i) === action.payload.lineId
            ? { ...i, quantity: clampToStock(action.payload.quantity, lineMaxQuantity(i)) }
            : i
        ),
      };
    case 'CLEAR':
      return { ...state, items: [] };
    case 'LOAD':
      return { items: action.payload, hydrated: true };
  }
}

interface CartContextType {
  items: CartItem[];
  // See CartState.hydrated.
  hydrated: boolean;
  addItem: (item: CartItem) => void;
  /** Add several lines as ONE action — a product plus the add-ons that came
   *  with it. Fires a single confirmation naming the product, not the last
   *  add-on. See the comment on the implementation. `quiet` skips the
   *  confirmation, for Buy now, which goes straight on to checkout. */
  addItems: (items: CartItem[], opts?: { quiet?: boolean }) => void;
  /** Puts a removed line back at `index` (the cart's Undo). */
  restoreItem: (item: CartItem, index: number) => void;
  /** The slide-in cart (components/cart/CartDrawer.tsx). `added` is the line
   *  just added, shown first under "Added to your cart". */
  drawer: { open: boolean; added: string | null };
  openCart: (added?: string) => void;
  closeCart: () => void;
  /** By line id (lib/cart-lines lineIdOf) — removes what the line includes with it. */
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [], hydrated: false });
  const [drawer, setDrawer] = useState<{ open: boolean; added: string | null }>({ open: false, added: null });
  const openCart = useCallback((added?: string) => setDrawer({ open: true, added: added ?? null }), []);
  const closeCart = useCallback(() => setDrawer((d) => ({ ...d, open: false })), []);

  useEffect(() => {
    // Always dispatch LOAD — even with nothing saved — so `hydrated` flips
    // and consumers know the (possibly empty) cart is now the real one.
    let items: CartItem[] = [];
    const saved = localStorage.getItem('ascend-cart');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Pre-rework carts were keyed by `productId` (a flat product row's
        // own id) — the parent/variant migration preserved every row's id
        // as-is when it became a ProductVariant, so an old saved id is still
        // a perfectly valid variantId. Silently upgrade the shape on load
        // rather than requiring a version bump or discarding the cart.
        items = parsed
          .map((item: CartItem & { productId?: string }) => ({
            ...item,
            variantId: item.variantId ?? item.productId,
          }))
          // Carts saved before bundles (no lineId) carried each free syringe,
          // swab and vial as a line of its own. Those are dropped: the server
          // adds what a product includes, and the cart now shows it under the
          // product. RM0 lines are only ever those supplies.
          .filter((item: CartItem) => item.lineId !== undefined || item.price > 0);
      } catch {}
    }
    dispatch({ type: 'LOAD', payload: items });
  }, []);

  useEffect(() => {
    localStorage.setItem('ascend-cart', JSON.stringify(state.items));
  }, [state.items]);

  const total = state.items.reduce((sum, i) => sum + lineUnitPrice(i) * i.quantity, 0);
  // Products, not syringes: what a line includes is not counted as items.
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  // Adding opens the cart with the line on top (the Teliti / Shopify pattern):
  // the customer sees it went in, the total, and the way to checkout or back.
  const addItem = useCallback((item: CartItem) => {
    dispatch({ type: 'ADD_ITEM', payload: item });
    setDrawer({ open: true, added: item.lineId ?? lineKey(item.variantId, item.includes) });
  }, []);

  /**
   * One action, one confirmation. The product page adds the product and each
   * ticked add-on in one go; the cart opens on the product the customer asked
   * for (the first), not whichever add-on happened to go in last.
   */
  const addItems = useCallback((items: CartItem[], opts?: { quiet?: boolean }) => {
    if (items.length === 0) return;
    for (const item of items) dispatch({ type: 'ADD_ITEM', payload: item });
    if (opts?.quiet) return;
    const [lead] = items;
    setDrawer({ open: true, added: lead.lineId ?? lineKey(lead.variantId, lead.includes) });
  }, []);

  return (
    <CartContext value={{
      items: state.items,
      hydrated: state.hydrated,
      addItem,
      addItems,
      removeItem: (id) => dispatch({ type: 'REMOVE_ITEM', payload: id }),
      restoreItem: (item, index) => dispatch({ type: 'RESTORE_ITEM', payload: { item, index } }),
      drawer,
      openCart,
      closeCart,
      updateQuantity: (id, qty) => dispatch({ type: 'UPDATE_QUANTITY', payload: { lineId: id, quantity: qty } }),
      clearCart: () => dispatch({ type: 'CLEAR' }),
      total,
      itemCount,
    }}>
      {children}
      <CartDrawer />
    </CartContext>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

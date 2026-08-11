'use client';

import { createContext, useContext, useReducer, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import type { CartItem } from '@/types';
import { CartToast } from '@/components/ui/CartToast';

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
  | { type: 'UPDATE_QUANTITY'; payload: { variantId: string; quantity: number } }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; payload: CartItem[] };

function clampToStock(quantity: number, stock: number | undefined): number {
  return stock != null ? Math.min(quantity, stock) : quantity;
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.items.find((i) => i.variantId === action.payload.variantId);
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i.variantId === action.payload.variantId
              // Clamp the merged quantity to the variant's stock so repeated
              // adds can't push the line past what's actually available.
              // (stock is missing on carts saved before it was tracked —
              // no clamp then; the backend re-validates at order time.)
              ? { ...i, quantity: clampToStock(i.quantity + action.payload.quantity, action.payload.stock ?? i.stock) }
              : i
          ),
        };
      }
      return { ...state, items: [...state.items, { ...action.payload, quantity: clampToStock(action.payload.quantity, action.payload.stock) }] };
    }
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter((i) => i.variantId !== action.payload) };
    case 'UPDATE_QUANTITY':
      return {
        ...state,
        items: state.items.map((i) =>
          i.variantId === action.payload.variantId
            ? { ...i, quantity: clampToStock(action.payload.quantity, i.stock) }
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
   *  add-on. See the comment on the implementation. */
  addItems: (items: CartItem[]) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

export interface ToastItem {
  code: string;
  name: string;
  /** Add-ons that rode along with it. Counted rather than listed — naming three
   *  consumables is noise next to the thing they bought. */
  extras: number;
  key: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [], hydrated: false });
  const [toastItem, setToastItem] = useState<ToastItem | null>(null);
  const toastKeyRef = useRef(0);

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
        items = parsed.map((item: CartItem & { productId?: string }) => ({
          ...item,
          variantId: item.variantId ?? item.productId,
        }));
      } catch {}
    }
    dispatch({ type: 'LOAD', payload: items });
  }, []);

  useEffect(() => {
    localStorage.setItem('ascend-cart', JSON.stringify(state.items));
  }, [state.items]);

  const total = state.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  const addItem = useCallback((item: CartItem) => {
    dispatch({ type: 'ADD_ITEM', payload: item });
    toastKeyRef.current += 1;
    setToastItem({ code: item.code, name: item.name, extras: 0, key: toastKeyRef.current });
  }, []);

  /**
   * One action, one confirmation.
   *
   * The product page adds the product and then each selected add-on. When every
   * one of those went through addItem, each fired its own toast and React
   * batched them — so the only one that ever rendered was the LAST add-on.
   * Tapping "Add to cart" on Retatrutide confirmed "Alcohol Swab": the customer
   * saw a thing they never chose and no sign of the thing they did.
   *
   * The first item is the one the customer actually asked for; anything after
   * it is counted, not named.
   */
  const addItems = useCallback((items: CartItem[]) => {
    if (items.length === 0) return;
    for (const item of items) dispatch({ type: 'ADD_ITEM', payload: item });
    toastKeyRef.current += 1;
    const [lead] = items;
    setToastItem({ code: lead.code, name: lead.name, extras: items.length - 1, key: toastKeyRef.current });
  }, []);

  const clearToast = useCallback(() => setToastItem(null), []);

  return (
    <CartContext value={{
      items: state.items,
      hydrated: state.hydrated,
      addItem,
      addItems,
      removeItem: (id) => dispatch({ type: 'REMOVE_ITEM', payload: id }),
      updateQuantity: (id, qty) => dispatch({ type: 'UPDATE_QUANTITY', payload: { variantId: id, quantity: qty } }),
      clearCart: () => dispatch({ type: 'CLEAR' }),
      total,
      itemCount,
    }}>
      {children}
      <CartToast item={toastItem} onDone={clearToast} />
    </CartContext>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

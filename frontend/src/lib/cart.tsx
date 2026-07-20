'use client';

import { createContext, useContext, useReducer, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import type { CartItem } from '@/types';
import { CartToast } from '@/components/ui/CartToast';

interface CartState {
  items: CartItem[];
}

type CartAction =
  | { type: 'ADD_ITEM'; payload: CartItem }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'UPDATE_QUANTITY'; payload: { variantId: string; quantity: number } }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; payload: CartItem[] };

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.items.find((i) => i.variantId === action.payload.variantId);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.variantId === action.payload.variantId
              ? { ...i, quantity: i.quantity + action.payload.quantity }
              : i
          ),
        };
      }
      return { items: [...state.items, action.payload] };
    }
    case 'REMOVE_ITEM':
      return { items: state.items.filter((i) => i.variantId !== action.payload) };
    case 'UPDATE_QUANTITY':
      return {
        items: state.items.map((i) =>
          i.variantId === action.payload.variantId
            ? { ...i, quantity: action.payload.quantity }
            : i
        ),
      };
    case 'CLEAR':
      return { items: [] };
    case 'LOAD':
      return { items: action.payload };
  }
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [] });
  const [toastItem, setToastItem] = useState<{ code: string; name: string; key: number } | null>(null);
  const toastKeyRef = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem('ascend-cart');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Pre-rework carts were keyed by `productId` (a flat product row's
        // own id) — the parent/variant migration preserved every row's id
        // as-is when it became a ProductVariant, so an old saved id is still
        // a perfectly valid variantId. Silently upgrade the shape on load
        // rather than requiring a version bump or discarding the cart.
        const normalized = parsed.map((item: CartItem & { productId?: string }) => ({
          ...item,
          variantId: item.variantId ?? item.productId,
        }));
        dispatch({ type: 'LOAD', payload: normalized });
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('ascend-cart', JSON.stringify(state.items));
  }, [state.items]);

  const total = state.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  const addItem = useCallback((item: CartItem) => {
    dispatch({ type: 'ADD_ITEM', payload: item });
    toastKeyRef.current += 1;
    setToastItem({ code: item.code, name: item.name, key: toastKeyRef.current });
  }, []);

  const clearToast = useCallback(() => setToastItem(null), []);

  return (
    <CartContext value={{
      items: state.items,
      addItem,
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

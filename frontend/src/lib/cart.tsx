'use client';

import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { CartItem } from '@/types';

interface CartState {
  items: CartItem[];
}

type CartAction =
  | { type: 'ADD_ITEM'; payload: CartItem }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'UPDATE_QUANTITY'; payload: { productId: string; quantity: number } }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; payload: CartItem[] };

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.items.find((i) => i.productId === action.payload.productId);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === action.payload.productId
              ? { ...i, quantity: i.quantity + action.payload.quantity }
              : i
          ),
        };
      }
      return { items: [...state.items, action.payload] };
    }
    case 'REMOVE_ITEM':
      return { items: state.items.filter((i) => i.productId !== action.payload) };
    case 'UPDATE_QUANTITY':
      return {
        items: state.items.map((i) =>
          i.productId === action.payload.productId
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
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [] });

  useEffect(() => {
    const saved = localStorage.getItem('ascend-cart');
    if (saved) {
      try {
        dispatch({ type: 'LOAD', payload: JSON.parse(saved) });
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('ascend-cart', JSON.stringify(state.items));
  }, [state.items]);

  const total = state.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext value={{
      items: state.items,
      addItem: (item) => dispatch({ type: 'ADD_ITEM', payload: item }),
      removeItem: (id) => dispatch({ type: 'REMOVE_ITEM', payload: id }),
      updateQuantity: (id, qty) => dispatch({ type: 'UPDATE_QUANTITY', payload: { productId: id, quantity: qty } }),
      clearCart: () => dispatch({ type: 'CLEAR' }),
      total,
      itemCount,
    }}>
      {children}
    </CartContext>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

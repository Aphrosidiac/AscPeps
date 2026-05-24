export const MALAYSIAN_STATES = [
  'Johor',
  'Kedah',
  'Kelantan',
  'Kuala Lumpur',
  'Labuan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Penang',
  'Perak',
  'Perlis',
  'Putrajaya',
  'Sabah',
  'Sarawak',
  'Selangor',
  'Terengganu',
] as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  SHIPPED: 'bg-purple-100 text-purple-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  UNPAID: 'bg-yellow-100 text-yellow-800',
  PAID: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-gray-100 text-gray-800',
};

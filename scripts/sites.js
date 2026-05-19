// Warranty tier metadata is sourced from the Revibe-supplied canonical pricing
// JSON. Each tier carries the Shopify product handle + id so a future iteration
// can fetch the live warranty SKU price via /products/<handle>.js instead of
// relying on the hardcoded `warranty` number.
export const SITES = [
  {
    id: 'za',
    name: 'revibe.co.za',
    baseUrl: 'https://revibe.co.za',
    plpPath: '/collections/all',
    region: 'South Africa',
    language: 'en',
    rtl: false,
    currency: { code: 'ZAR', symbols: ['R', 'ZAR'] },
    bnpl: ['FLOAT', 'PAYFLEX', 'HAPPYPAY'],
    warrantyTiers: [
      { maxPrice: 2892,  warranty: 210,  handle: '2-years-extended-warranty-plan-1', productId: 49083440562464 },
      { maxPrice: 4821,  warranty: 400,  handle: '2-years-extended-warranty-plan-2', productId: 49083439841568 },
      { maxPrice: 9642,  warranty: 445,  handle: '2-years-extended-warranty-plan',   productId: 49083451572512 },
      { maxPrice: 14463, warranty: 675,  handle: '2-years-extended-warranty-plan-3', productId: 49083439874336 },
      { maxPrice: Infinity, warranty: 1975, handle: '2-years-extended-warranty-plan-4', productId: 49083544895776 },
    ],
  },
  {
    id: 'ae',
    name: 'revibe.me',
    baseUrl: 'https://revibe.me',
    plpPath: '/collections/all',
    region: 'United Arab Emirates',
    language: 'en',
    rtl: false,
    currency: { code: 'AED', symbols: ['AED', 'د.إ'] },
    bnpl: ['Tabby', 'Tamara'],
    warrantyTiers: [
      { maxPrice: 600,  warranty: 45,  handle: '2-years-extended-warranty-plan-1', productId: 45577070281023 },
      { maxPrice: 1000, warranty: 85,  handle: '2-years-extended-warranty-plan-2', productId: 45577073656127 },
      { maxPrice: 2000, warranty: 95,  handle: '2-years-extended-warranty-plan',   productId: 44780777144639 },
      { maxPrice: 3000, warranty: 145, handle: '2-years-extended-warranty-plan-3', productId: 45577074704703 },
      { maxPrice: Infinity, warranty: 445, handle: '2-years-extended-warranty-plan-4', productId: 49624816582975 },
    ],
  },
  {
    id: 'sa',
    name: 'sa.revibe.me',
    baseUrl: 'https://sa.revibe.me',
    plpPath: '/collections/all',
    region: 'Saudi Arabia',
    language: 'en',
    rtl: false,
    currency: { code: 'SAR', symbols: ['SAR', 'ر.س'] },
    bnpl: ['Tabby', 'Tamara', 'Baseeta'],
    warrantyTiers: [
      { maxPrice: 600,  warranty: 45,  handle: '2-years-extended-warranty-plan-1', productId: 45539094659393 },
      { maxPrice: 1000, warranty: 85,  handle: '2-years-extended-warranty-plan-2', productId: 45539103506753 },
      { maxPrice: 2000, warranty: 95,  handle: '2-years-extended-warranty-plan',   productId: 45371583136065 },
      { maxPrice: 3000, warranty: 145, handle: '2-years-extended-warranty-plan-3', productId: 45539107733825 },
      { maxPrice: Infinity, warranty: 445, handle: '2-years-extended-warranty-plan-4', productId: 49223559151937 },
    ],
  },
];

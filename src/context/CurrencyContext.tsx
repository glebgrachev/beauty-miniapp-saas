// src/context/CurrencyContext.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'; // 👈 type ReactNode
import { getCurrentShopId, fetchShopCurrency } from '../lib/api';

type Currency = {
  id: number;
  code: string;
  symbol: string;
  name: string;
};

type CurrencyContextType = {
  currency: Currency | null;
  loading: boolean;
  formatPrice: (amount: number) => string;
};

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCurrency() {
      try {
        const shopId = await getCurrentShopId();
        if (shopId) {
          const cur = await fetchShopCurrency(Number(shopId)); // 👈 Number(shopId)
          if (cur) setCurrency(cur);
        }
      } catch (error) {
        console.error('Error loading currency:', error);
      } finally {
        setLoading(false);
      }
    }
    loadCurrency();
  }, []);

  const formatPrice = (amount: number) => {
    if (!currency) return `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
    return `${Math.round(amount).toLocaleString('ru-RU')} ${currency.symbol}`;
  };

  return (
    <CurrencyContext.Provider value={{ currency, loading, formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
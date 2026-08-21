// src/context/CurrencyContext.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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
        console.log('💰 Загрузка валюты...');
        const shopId = await getCurrentShopId();
        console.log('💰 shopId:', shopId);
        
        if (shopId) {
          const cur = await fetchShopCurrency(Number(shopId));
          console.log('💰 Валюта из БД:', cur);
          if (cur) {
            setCurrency(cur);
            console.log('✅ Валюта установлена:', cur.code, cur.symbol);
          }
        } else {
          console.log('⚠️ shopId не найден, используем RUB по умолчанию');
          // Дефолтная валюта
          setCurrency({
            id: 1,
            code: 'RUB',
            symbol: '₽',
            name: 'Российский рубль'
          });
        }
      } catch (error) {
        console.error('❌ Ошибка загрузки валюты:', error);
        // Дефолтная валюта при ошибке
        setCurrency({
          id: 1,
          code: 'RUB',
          symbol: '₽',
          name: 'Российский рубль'
        });
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
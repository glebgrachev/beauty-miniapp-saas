// src/hooks/useStockModule.ts
import { useEffect, useState } from "react";
import { getCurrentShopId } from "@/lib/supabase/api";
import { supabase } from "@/lib/supabase/client";

export function useStockModule() {
  const [hasStock, setHasStock] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function check() {
      const shopId = await getCurrentShopId();
      if (!shopId) {
        setHasStock(false);
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("shops")
        .select("modules")
        .eq("id", shopId)
        .single();

      const stockValue = data?.modules?.stock;
      const has = stockValue !== undefined && stockValue !== null && stockValue !== false;
      setHasStock(has);
      setLoading(false);
    }

    check();
  }, []);

  return { hasStock, loading };
}
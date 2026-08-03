import { supabase } from "./supabase";
import type {
  Category,
  Promo,
  SpecialistCard,
  Chip,
  ServiceCard,
  ServiceDetail,
  Master,
} from "../types";

/* ---------- лёгкий in-memory кэш справочников (на сессию, TTL) ---------- */
const CATALOG_TTL = 5 * 60 * 1000; // 5 минут
type CacheEntry = { at: number; val: unknown };
const _cache = new Map<string, CacheEntry>();

function cached<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.val as T);
  return loader().then((val) => {
    _cache.set(key, { at: Date.now(), val });
    return val;
  });
}

// сброс кэша каталога (напр. после действий, меняющих данные)
export function clearCatalogCache() {
  _cache.clear();
}

// ✅ ВСТАВЛЯЕМ СЮДА
async function ensureUserExists(shopId: string) {
  try {
    const initData = window.Telegram?.WebApp?.initData || "";
    const params = new URLSearchParams(initData);
    const userJson = params.get("user");
    if (!userJson) return;
    
    const user = JSON.parse(decodeURIComponent(userJson));
    const telegramId = user.id;
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    const username = user.username || '';
    
    const { data: existing } = await supabase
      .from("users")
      .select("telegram_id")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    
    if (existing) {
      await supabase
        .from("users")
        .update({ shop_id: Number(shopId) })
        .eq("telegram_id", telegramId);
      console.log('✅ Обновлён shop_id для пользователя:', telegramId);
    } else {
      const { error } = await supabase
        .from("users")
        .insert({
          telegram_id: telegramId,
          first_name: firstName,
          last_name: lastName,
          username: username,
          shop_id: Number(shopId),
        });
      if (!error) {
        console.log('✅ Пользователь создан:', telegramId);
      } else {
        console.error('❌ Ошибка создания пользователя:', error);
      }
    }
  } catch (e) {
    console.error('❌ Ошибка в ensureUserExists:', e);
  }
}

/* ---------- получение shop_id текущего пользователя ---------- */
let cachedShopId: string | null = null;

export async function getCurrentShopId(): Promise<string | null> {
  // 1. Проверяем кэш
  if (cachedShopId !== null) return cachedShopId;
  
  // 2. Пробуем получить shop_id из URL (параметр start от Telegram)
  try {
  const hash = window.location.hash;
  if (hash) {
    const params = new URLSearchParams(hash.split('?')[1] || '');
    const startParam = params.get('start');
    if (startParam && startParam.startsWith('shop_')) {
      const shopId = startParam.replace('shop_', '');
      cachedShopId = shopId;
      console.log('🔍 shop_id из хэша URL:', shopId);
      
      // ✅ СОЗДАЁМ ПОЛЬЗОВАТЕЛЯ
      await ensureUserExists(shopId);
      
      return shopId;
    }
  }
} catch (e) {
    // Игнорируем ошибки
  }
  
  // 3. Пробуем получить shop_id из initData (для старых пользователей)
  try {
    const initData = window.Telegram?.WebApp?.initData || "";
    const params = new URLSearchParams(initData);
    const userJson = params.get("user");
    if (userJson) {
      const user = JSON.parse(decodeURIComponent(userJson));
      const telegramId = user.id;
      
      if (telegramId) {
        const { data, error } = await supabase
          .from("users")
          .select("shop_id")
          .eq("telegram_id", telegramId)
          .maybeSingle();
          
        if (!error && data?.shop_id) {
          cachedShopId = data.shop_id?.toString() || null;
          console.log('🔍 shop_id из users:', cachedShopId);
          return cachedShopId;
        }
      }
    }
  } catch (e) {
    // Игнорируем ошибки
  }
  
  console.log('⚠️ shop_id не найден');
  return null;
}

export async function fetchCategories(): Promise<Category[]> {
  return cached("categories", CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return [];
    
    const { data } = await supabase
      .from("categories")
      .select("id, name, image_url")
      .is("parent_id", null)
      .eq("is_active", true)
      .eq("shop_id", shopId)
      .order("sort_order")
      .order("name");
    return (data as Category[]) ?? [];
  });
}

export async function fetchPromos(): Promise<Promo[]> {
  return cached("promos", CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return [];
    
    const { data } = await supabase
      .from("promotions")
      .select("id, title, banner_url, kind, discount_type, discount_value")
      .eq("is_active", true)
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false });
    return (data as Promo[]) ?? [];
  });
}

type SpecRow = {
  id: string;
  full_name: string;
  photo_url: string | null;
  rating: number;
  specialist_services: { price: number }[] | null;
};

export async function fetchSpecialists(): Promise<SpecialistCard[]> {
  return cached("specialists", CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return [];
    
    const { data } = await supabase
      .from("specialists")
      .select("id, full_name, photo_url, rating, specialist_services ( price )")
      .eq("is_active", true)
      .eq("shop_id", shopId)
      .order("sort_order")
      .order("created_at");

    return ((data as SpecRow[]) ?? []).map((s) => {
      const prices = (s.specialist_services ?? []).map((x) => x.price);
      return {
        id: s.id,
        full_name: s.full_name,
        photo_url: s.photo_url,
        rating: s.rating,
        price_from: prices.length ? Math.min(...prices) : null,
      };
    });
  });
}

type CatRow = { id: string; parent_id: string | null; name: string; image_url: string | null };
type SvcRow = {
  id: string;
  name: string;
  image_url: string | null;
  duration_min: number;
  category_id: string;
  specialist_services: { price: number }[] | null;
};

export async function fetchCategoryView(
  topId: string,
): Promise<{ chips: Chip[]; services: ServiceCard[] }> {
  return cached(`categoryView:${topId}`, CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return { chips: [], services: [] };
    
    const { data: catsData } = await supabase
      .from("categories")
      .select("id, parent_id, name, image_url")
      .eq("is_active", true)
      .eq("shop_id", shopId);
    const cats = (catsData as CatRow[]) ?? [];
    const byId = new Map(cats.map((c) => [c.id, c]));

    // потомки верхней категории
    const descendants = new Set<string>();
    const collect = (parent: string) => {
      for (const c of cats) {
        if (c.parent_id === parent && !descendants.has(c.id)) {
          descendants.add(c.id);
          collect(c.id);
        }
      }
    };
    collect(topId);

    const chips: Chip[] = cats
      .filter((c) => c.parent_id === topId)
      .map((c) => ({ id: c.id, name: c.name, image_url: c.image_url }));

    // ветка верхнего уровня (прямой потомок topId) для услуги
    const branchOf = (catId: string): string | null => {
      let cur: string | undefined = catId;
      let guard = 0;
      while (cur && guard++ < 10) {
        const node = byId.get(cur);
        if (!node) return null;
        if (node.parent_id === topId) return node.id;
        cur = node.parent_id ?? undefined;
      }
      return null;
    };

    const ids = [topId, ...descendants];
    if (ids.length === 0) return { chips, services: [] };

    const { data: svcData } = await supabase
      .from("services")
      .select("id, name, image_url, duration_min, category_id, specialist_services ( price )")
      .in("category_id", ids)
      .eq("is_active", true)
      .eq("shop_id", shopId)
      .order("name");

    const services: ServiceCard[] = ((svcData as SvcRow[]) ?? []).map((s) => {
      const prices = (s.specialist_services ?? []).map((x) => x.price);
      return {
        id: s.id,
        name: s.name,
        image_url: s.image_url,
        duration_min: s.duration_min,
        price_from: prices.length ? Math.min(...prices) : null,
        branch_id: branchOf(s.category_id),
      };
    });

    return { chips, services };
  });
}

type MasterRow = {
  price: number;
  specialist: {
    id: string;
    full_name: string;
    photo_url: string | null;
    rating: number;
    is_active: boolean;
  } | null;
};

export async function fetchServiceDetail(
  serviceId: string,
): Promise<{ service: ServiceDetail; masters: Master[] } | null> {
  return cached(`serviceDetail:${serviceId}`, CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return null;
    
    const { data: svc } = await supabase
      .from("services")
      .select("id, name, image_url, duration_min, description")
      .eq("id", serviceId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (!svc) return null;

    const { data: ms } = await supabase
      .from("specialist_services")
      .select("price, specialist:specialists ( id, full_name, photo_url, rating, is_active )")
      .eq("service_id", serviceId);

    const masters: Master[] = ((ms as unknown as MasterRow[]) ?? [])
      .filter((m) => m.specialist?.is_active)
      .map((m) => ({
        id: m.specialist!.id,
        full_name: m.specialist!.full_name,
        photo_url: m.specialist!.photo_url,
        rating: m.specialist!.rating,
        price: m.price,
      }))
      .sort((a, b) => a.price - b.price);

    return { service: svc as ServiceDetail, masters };
  });
}
/* ---------- запись ---------- */
const API = import.meta.env.VITE_API_URL as string;
const initData = () => window.Telegram?.WebApp?.initData ?? "";

export async function fetchBookingContext(serviceId: string, specialistId: string) {
  const shopId = await getCurrentShopId();
  
  const [svcRes, mRes, ssRes] = await Promise.all([
    supabase.from("services").select("name, duration_min").eq("id", serviceId).eq("shop_id", shopId).maybeSingle(),
    supabase.from("specialists").select("full_name, photo_url").eq("id", specialistId).eq("shop_id", shopId).maybeSingle(),
    supabase
      .from("specialist_services")
      .select("price")
      .eq("service_id", serviceId)
      .eq("specialist_id", specialistId)
      .maybeSingle(),
  ]);
  return {
    service: svcRes.data as { name: string; duration_min: number } | null,
    master: mRes.data as { full_name: string; photo_url: string | null } | null,
    basePrice: (ssRes.data as { price: number } | null)?.price ?? null,
  };
}

export async function fetchSlots(
  specialistId: string,
  serviceId: string,
  dateStr: string,
  busyRanges: { starts_at: string; ends_at: string }[] = [],
) {
  // формат tstzrange для Postgres: '[start,end)'
  const p_busy_ranges =
    busyRanges.length > 0 ? busyRanges.map((r) => `[${r.starts_at},${r.ends_at})`) : null;

  const { data, error } = await supabase.rpc("get_available_slots", {
    p_specialist_id: specialistId,
    p_service_id: serviceId,
    p_date: dateStr,
    p_busy_ranges,
  });
  if (error) return [];
  return (data as { slot_start: string; slot_end: string }[]) ?? [];
}

export type PriceResult = {
  full_price: number;
  discount_amount: number;
  final_price: number;
  promo_title: string | null;
};

export async function apiPrice(
  serviceId: string,
  specialistId: string,
): Promise<{ status: number; data: PriceResult | null }> {
  try {
    const res = await fetch(`${API}/api/price`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), service_id: serviceId, specialist_id: specialistId }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiBook(serviceId: string, specialistId: string, startsAt: string, points = 0, cert = 0, certId: string | null = null) {
  try {
    const res = await fetch(`${API}/api/book`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        initData: initData(),
        service_id: serviceId,
        specialist_id: specialistId,
        starts_at: startsAt,
        points,
        cert,
        cert_id: certId,
      }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiConfirm(bookingId: string) {
  try {
    const res = await fetch(`${API}/api/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), booking_id: bookingId }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ---------- экран мастера ---------- */
export type SpecialistFull = {
  id: string;
  full_name: string;
  photo_url: string | null;
  bio: string | null;
  experience_years: number;
  rating: number;
};
export type SpecServiceItem = { id: string; name: string; duration_min: number; price: number };
export type Work = { image_url: string; caption: string | null };
export type Review = {
  rating: number;
  comment: string | null;
  created_at: string;
  client_name: string;
  service_name: string | null;
};

type SSItem = {
  price: number;
  service: { id: string; name: string; duration_min: number; is_active: boolean } | null;
};
type RevRow = {
  specialist_rating: number;
  comment: string | null;
  created_at: string;
  client_name: string | null;
  service: { name: string } | null;
};

export async function fetchSpecialistDetail(id: string): Promise<{
  specialist: SpecialistFull | null;
  services: SpecServiceItem[];
  works: Work[];
  reviews: Review[];
  reviewCount: number;
}> {
  return cached(`specialistDetail:${id}`, CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    
    const [spRes, ssRes, wRes, rRes] = await Promise.all([
      supabase
        .from("specialists")
        .select("id, full_name, photo_url, bio, experience_years, rating")
        .eq("id", id)
        .eq("shop_id", shopId)
        .maybeSingle(),
      supabase
        .from("specialist_services")
        .select("price, service:services ( id, name, duration_min, is_active )")
        .eq("specialist_id", id),
      supabase
        .from("specialist_works")
        .select("image_url, caption")
        .eq("specialist_id", id)
        .order("sort_order"),
      supabase
        .from("reviews")
        .select("specialist_rating, comment, created_at, client_name, service:services ( name )")
        .eq("specialist_id", id)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const services: SpecServiceItem[] = ((ssRes.data as unknown as SSItem[]) ?? [])
      .filter((r) => r.service?.is_active)
      .map((r) => ({
        id: r.service!.id,
        name: r.service!.name,
        duration_min: r.service!.duration_min,
        price: r.price,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    const reviews: Review[] = ((rRes.data as unknown as RevRow[]) ?? []).map((r) => ({
      rating: r.specialist_rating,
      comment: r.comment,
      created_at: r.created_at,
      client_name: r.client_name?.trim() || "Клиент",
      service_name: r.service?.name ?? null,
    }));

    return {
      specialist: (spRes.data as SpecialistFull) ?? null,
      services,
      works: (wRes.data as Work[]) ?? [],
      reviews,
      reviewCount: reviews.length,
    };
  });
}

/* ---------- корзина: расчёт ---------- */
export type CartPriceItem = {
  service_id: string;
  specialist_id: string;
  full_price: number;
  discount_amount: number;
  final_price: number;
  promo_title: string | null;
  error?: string;
};
export type CartGift = {
  promo_id: string;
  promo_title: string;
  gift_service_id: string;
  gift_service_name: string;
  gift_discount_percent: number;
};
export type CartPrice = {
  items: CartPriceItem[];
  gifts: CartGift[];
  subtotal: number;
  discount_total: number;
  total: number;
};

export async function apiPriceCart(
  items: { service_id: string; specialist_id: string }[],
): Promise<{ status: number; data: CartPrice | null }> {
  try {
    const res = await fetch(`${API}/api/price-cart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), items }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ---------- отзыв ---------- */
export type ReviewContext = {
  service: string | null;
  specialist: string | null;
  existing: {
    specialist_rating: number;
    service_rating: number;
    comment: string | null;
    status: string;
  } | null;
};

export async function apiReviewContext(
  bookingId: string,
): Promise<{ status: number; data: (ReviewContext & { ok: boolean }) | null }> {
  try {
    const res = await fetch(
      `${API}/api/review?booking_id=${encodeURIComponent(bookingId)}&initData=${encodeURIComponent(initData())}`,
    );
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiSubmitReview(
  bookingId: string,
  specialistRating: number,
  serviceRating: number,
  comment: string,
) {
  try {
    const res = await fetch(`${API}/api/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        initData: initData(),
        booking_id: bookingId,
        specialist_rating: specialistRating,
        service_rating: serviceRating,
        comment,
      }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ---------- мои записи / отмена ---------- */
export type MyBooking = {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  service_id: string;
  specialist_id: string;
  service: string;
  specialist: string;
  can_cancel: boolean;
  can_reschedule: boolean;
  rescheduling: boolean;
  can_review: boolean;
  reviewed: boolean;
};

export type ActiveReschedule = {
  booking_id: string;
  service: string;
  service_id: string;
  specialist_id: string;
  starts_at: string;
};

export async function apiMyBookings(): Promise<{
  status: number;
  data: { ok: boolean; upcoming: MyBooking[]; past: MyBooking[]; active_reschedule: ActiveReschedule | null } | null;
}> {
  try {
    const res = await fetch(`${API}/api/my-bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData() }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiCancelBooking(bookingId: string) {
  try {
    const res = await fetch(`${API}/api/cancel-booking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), booking_id: bookingId }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ---------- избранное ---------- */
export type FavSpecialist = { id: string; full_name: string; photo_url: string | null; rating: number };
export type FavService = { id: string; name: string; duration_min: number; image_url: string | null };

export async function apiFavoritesList(): Promise<{
  status: number;
  data: { ok: boolean; keys: string[]; specialists: FavSpecialist[]; services: FavService[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/favorites?initData=${encodeURIComponent(initData())}`);
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiToggleFavorite(
  kind: "specialist" | "service",
  targetId: string,
): Promise<{ status: number; data: { ok: boolean; favorite: boolean } | null }> {
  try {
    const res = await fetch(`${API}/api/favorites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), kind, target_id: targetId }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ---------- мои отзывы ---------- */
export type MyReview = {
  id: string;
  booking_id: string;
  specialist_rating: number;
  service_rating: number;
  comment: string | null;
  status: string;
  created_at: string;
  service: string | null;
  specialist: string | null;
};

export async function apiMyReviews(): Promise<{
  status: number;
  data: { ok: boolean; reviews: MyReview[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/my-reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData() }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ---------- мастера для услуги (для подарка в корзине) ---------- */
export type ServiceMaster = { id: string; full_name: string; photo_url: string | null; rating: number; price: number };

export async function fetchServiceMasters(serviceId: string): Promise<ServiceMaster[]> {
  return cached(`serviceMasters:${serviceId}`, CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return [];
    
    const { data } = await supabase
      .from("specialist_services")
      .select("price, specialist:specialists ( id, full_name, photo_url, rating, is_active )")
      .eq("service_id", serviceId)
      .eq("shop_id", shopId);
    type Row = { price: number; specialist: { id: string; full_name: string; photo_url: string | null; rating: number; is_active: boolean } | null };
    return ((data as unknown as Row[]) ?? [])
      .filter((r) => r.specialist?.is_active)
      .map((r) => ({
        id: r.specialist!.id,
        full_name: r.specialist!.full_name,
        photo_url: r.specialist!.photo_url,
        rating: r.specialist!.rating,
        price: r.price,
      }))
      .sort((a, b) => b.rating - a.rating);
  });
}

/* ---------- оформление заказа (корзина) ---------- */
export type BookCartItem = {
  service_id: string;
  specialist_id: string;
  starts_at: string;
  is_gift: boolean;
  gift_discount_percent: number;
};

export async function apiBookCart(
  items: BookCartItem[],
  points = 0,
  cert = 0,
  certId: string | null = null,
  products: { product_id: string; qty: number }[] = [],
): Promise<{
  status: number;
  data: { ok: boolean; order_id?: string; busy?: number[]; error?: string } | null;
}> {
  try {
    const res = await fetch(`${API}/api/book-cart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), items, points, cert, cert_id: certId, products }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ---------- лояльность (баллы) ---------- */
export type LoyaltyTx = {
  kind: "accrual" | "redemption" | "adjustment";
  points: number;
  note: string | null;
  created_at: string;
};
export type LoyaltyData = {
  ok: boolean;
  balance: number;
  total_earned: number;
  total_spent: number;
  cashback_percent: number;
  redeem_max_percent: number;
  point_value: number;
  transactions: LoyaltyTx[];
};

export async function checkBonusAccess(): Promise<{
  canUse: boolean;
  message: string;
}> {
  try {
    const shopId = await getCurrentShopId();
    if (!shopId) {
      return { 
        canUse: false, 
        message: "Салон не найден" 
      };
    }
    
    const { data: shop, error } = await supabase
      .from("shops")
      .select("plan_id, subscription_expires_at")
      .eq("id", shopId)
      .single();
    
    if (error || !shop) {
      return { 
        canUse: false, 
        message: "Не удалось проверить доступ" 
      };
    }
    
    const isPaid = shop.plan_id !== 1;
    const isActive = shop.subscription_expires_at 
      ? new Date(shop.subscription_expires_at) > new Date()
      : false;
    
    if (isPaid && isActive) {
      return { 
        canUse: true, 
        message: "Бонусы доступны" 
      };
    }
    
    return { 
      canUse: false, 
      message: "Использование бонусов ограничено. Обратитесь в салон." 
    };
  } catch {
    return { 
      canUse: false, 
      message: "Произошла ошибка" 
    };
  }
}

export async function apiLoyalty(): Promise<{ status: number; data: LoyaltyData | null }> {
  try {
    const res = await fetch(`${API}/api/loyalty?initData=${encodeURIComponent(initData())}`);
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}


/* ---------- сертификаты ---------- */
export type CertItem = { id: string; code: string; balance: number; status: string; expires_at: string | null; usable: boolean };
export type CertData = { ok: boolean; balance: number; certificates: CertItem[] };

export async function apiCertificate(): Promise<{ status: number; data: CertData | null }> {
  try {
    const res = await fetch(`${API}/api/certificate?initData=${encodeURIComponent(initData())}`);
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiActivateCertificate(code: string): Promise<{
  status: number;
  data: { ok: boolean; added?: number; balance?: number; error?: string } | null;
}> {
  try {
    const res = await fetch(`${API}/api/certificate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), code }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ---------- отписка от промо-рассылок ---------- */
export async function apiUnsubscribe(broadcastId: string | null): Promise<{
  status: number;
  data: { ok: boolean; error?: string } | null;
}> {
  try {
    const res = await fetch(`${API}/api/unsubscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), broadcast_id: broadcastId }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}


/* ---------- перенос записи ---------- */
export async function apiRescheduleStart(bookingId: string): Promise<{
  status: number;
  data: { ok: boolean; error?: string; orig_starts_at?: string; max_forward_days?: number; expire_pending_minutes?: number } | null;
}> {
  try {
    const res = await fetch(`${API}/api/reschedule-start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), booking_id: bookingId }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiRescheduleCancel(bookingId: string): Promise<{
  status: number;
  data: { ok: boolean; error?: string } | null;
}> {
  try {
    const res = await fetch(`${API}/api/reschedule-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), booking_id: bookingId }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiRescheduleConfirm(
  bookingId: string,
  specialistId: string,
  startsAt: string,
): Promise<{
  status: number;
  data: { ok: boolean; error?: string; starts_at?: string; final_price?: number } | null;
}> {
  try {
    const res = await fetch(`${API}/api/reschedule-confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        initData: initData(),
        booking_id: bookingId,
        specialist_id: specialistId,
        starts_at: startsAt,
      }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ================= КАБИНЕТ МАСТЕРА ================= */

export type MasterMe = {
  ok: boolean;
  specialist_id?: string;
  full_name?: string;
  photo_url?: string | null;
};

export async function apiMasterWhoami(): Promise<{ status: number; data: MasterMe | null }> {
  try {
    const res = await fetch(`${API}/api/master/whoami`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData() }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiMasterLink(payload: { contact?: string; code?: string }): Promise<{
  status: number;
  data: { ok: boolean; error?: string; full_name?: string } | null;
}> {
  try {
    const res = await fetch(`${API}/api/master/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), ...payload }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export type MasterBooking = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  service_name: string;
  client_name: string;
  client_phone: string | null;
  price: number;
  can_mark: boolean;
};

export async function apiMasterBookings(from: string, to: string): Promise<{
  status: number;
  data: { ok: boolean; bookings: MasterBooking[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/master/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), from, to }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiMasterMark(bookingId: string, status: "completed" | "no_show"): Promise<{
  status: number;
  data: { ok: boolean; error?: string } | null;
}> {
  try {
    const res = await fetch(`${API}/api/master/mark`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), booking_id: bookingId, status }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export type MasterDay = {
  date: string;
  day_type: "work" | "off";
  start_time: string | null;
  end_time: string | null;
  break_start: string | null;
  break_end: string | null;
};

export async function apiMasterSchedule(from: string, to: string): Promise<{
  status: number;
  data: { ok: boolean; days: MasterDay[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/master/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), from, to }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export type MasterEarnings = {
  services_count: number;
  services_payout: number;
  shifts: number;
  shifts_payout: number;
  salary_payout: number;
  products_count: number;
  products_payout: number;
  total_payout: number;
};

export async function apiMasterEarnings(from: string, to: string): Promise<{
  status: number;
  data: { ok: boolean; earnings: MasterEarnings } | null;
}> {
  try {
    const res = await fetch(`${API}/api/master/earnings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), from, to }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export type MasterDoc = {
  id: string;
  doc_type: string;
  title: string;
  expires_at: string | null;
  expiry_status: "none" | "valid" | "expiring" | "expired";
  days_left: number | null;
  url: string | null;
};

export async function apiMasterDocuments(): Promise<{
  status: number;
  data: { ok: boolean; documents: MasterDoc[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/master/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData() }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* публичные документы мастера (дипломы, сертификаты) — для карточки в клиентской части */
export type PublicDoc = {
  id: string;
  doc_type: string;
  title: string;
  mime_type: string | null;
  url: string;
};

export async function fetchSpecialistDocs(specialistId: string): Promise<PublicDoc[]> {
  try {
    const res = await fetch(`${API}/api/specialist-docs?id=${encodeURIComponent(specialistId)}`);
    if (!res.ok) return [];
    const j = (await res.json()) as { ok?: boolean; documents?: PublicDoc[] };
    return j.ok ? (j.documents ?? []) : [];
  } catch {
    return [];
  }
}

/* ================= МАГАЗИН ================= */

export type ShopProduct = {
  id: string;
  kind: "sale" | "certificate";
  name: string;
  photo_url: string | null;
  description: string | null;
  price: number;
  face_value: number | null;      // номинал сертификата
  validity_days: number | null;   // сколько дней действует
};

export async function fetchShop(): Promise<ShopProduct[]> {
  try {
    const res = await fetch(`${API}/api/shop`);
    if (!res.ok) return [];
    const j = (await res.json()) as { ok?: boolean; products?: ShopProduct[] };
    return j.ok ? (j.products ?? []) : [];
  } catch {
    return [];
  }
}

export async function apiReserveProducts(
  items: { product_id: string; qty: number }[],
): Promise<{
  status: number;
  data: { ok: boolean; reserved?: number; failed?: { product_id: string; error: string }[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/shop-reserve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), items }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export type MyProduct = {
  id: string;
  name: string;
  photo_url: string | null;
  qty: number;
  price: number;
  total: number;
  status: string;
  created_at: string;
  paid_at: string | null;
};

export async function apiMyProducts(): Promise<{
  status: number;
  data: { ok: boolean; items: MyProduct[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/my-products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData() }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiCancelReservation(saleId: string): Promise<{
  status: number;
  data: { ok: boolean; error?: string } | null;
}> {
  try {
    const res = await fetch(`${API}/api/cancel-reservation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), sale_id: saleId }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/* ================= ЛИСТ ОЖИДАНИЯ ================= */

export type DaySlot = {
  slot_start: string;
  slot_end: string;
  is_free: boolean;
};

/** Все слоты дня — свободные и занятые (на занятые можно встать в очередь) */
export async function fetchDaySlots(
  specialistId: string,
  serviceId: string,
  date: string,
): Promise<DaySlot[]> {
  try {
    const res = await fetch(
      `${API}/api/day-slots?specialist=${specialistId}&service=${serviceId}&date=${date}`,
    );
    if (!res.ok) return [];
    const j = (await res.json()) as { ok?: boolean; slots?: DaySlot[] };
    return j.ok ? (j.slots ?? []) : [];
  } catch {
    return [];
  }
}

export async function apiWaitlistJoin(payload: {
  service_id: string;
  specialist_id: string;
  kind: "slot" | "day";
  date: string;
  slot?: string | null;
}): Promise<{
  status: number;
  data: { ok: boolean; id?: string; error?: string; limit?: number } | null;
}> {
  try {
    const res = await fetch(`${API}/api/waitlist-join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), ...payload }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export async function apiWaitlistLeave(id: string): Promise<{
  status: number;
  data: { ok: boolean; error?: string } | null;
}> {
  try {
    const res = await fetch(`${API}/api/waitlist-leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData(), id }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export type WaitItem = {
  id: string;
  kind: "slot" | "day";
  status: "waiting" | "offered";
  target_date: string;
  slot_start: string | null;
  offered_slot: string | null;
  offer_expires_at: string | null;
  service_id: string;
  service_name: string;
  specialist_id: string;
  specialist_name: string;
  created_at: string;
};

export async function apiMyWaitlist(): Promise<{
  status: number;
  data: { ok: boolean; items: WaitItem[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/my-waitlist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData() }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export type MyCertificate = {
  id: string;
  code: string;
  amount: number;
  balance: number;
  status: "issued" | "active" | "used" | "expired" | "disabled";
  expires_at: string | null;
  created_at: string;
};

export async function apiMyCertificates(): Promise<{
  status: number;
  data: { ok: boolean; items: MyCertificate[] } | null;
}> {
  try {
    const res = await fetch(`${API}/api/my-certificates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData() }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}
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

  // 🔥 ЛОГИРУЕМ ВСЁ
  console.log('🔍 window.location:', window.location);
  console.log('🔍 window.location.hash:', window.location.hash);
  console.log('🔍 window.location.search:', window.location.search);
  
  // 2. Пробуем получить shop_id из start_param (Telegram WebApp)
  try {
    const initData = window.Telegram?.WebApp?.initData || "";
    const params = new URLSearchParams(initData);
    const startParam = params.get('start_param');
    if (startParam && startParam.startsWith('shop_')) {
      const shopId = startParam.replace('shop_', '');
      cachedShopId = shopId;
      console.log('🔍 shop_id из start_param:', shopId);
      await ensureUserExists(shopId);
      return shopId;
    }
  } catch (e) {
    // Игнорируем ошибки
  }
  
  // 3. Пробуем получить shop_id из хэша (старый способ)
  try {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.split('?')[1] || '');
      const startParam = params.get('start');
      if (startParam && startParam.startsWith('shop_')) {
        const shopId = startParam.replace('shop_', '');
        cachedShopId = shopId;
        console.log('🔍 shop_id из хэша URL:', shopId);
        await ensureUserExists(shopId);
        return shopId;
      }
    }
  } catch (e) {
    // Игнорируем ошибки
  }
  
  // 4. Пробуем получить shop_id из initData (для старых пользователей)
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
    
    const res = await fetch(
      `${API}/api/categories?shop_id=${shopId}&initData=${encodeURIComponent(initData())}`
    );
    if (!res.ok) return [];
    const result = await res.json();
    return result.ok ? result.data : [];
  });
}

export async function fetchPromos(): Promise<Promo[]> {
  return cached("promos", CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return [];
    
    const res = await fetch(
      `${API}/api/promos?shop_id=${shopId}&initData=${encodeURIComponent(initData())}`
    );
    if (!res.ok) return [];
    const result = await res.json();
    return result.ok ? result.data : [];
  });
}

export async function fetchSpecialists(): Promise<SpecialistCard[]> {
  return cached("specialists", CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return [];
    
    const res = await fetch(
      `${API}/api/specialists?shop_id=${shopId}&initData=${encodeURIComponent(initData())}`
    );
    if (!res.ok) return [];
    const result = await res.json();
    return result.ok ? result.data : [];
  });
}

export async function fetchCategoryView(
  topId: string,
): Promise<{ chips: Chip[]; services: ServiceCard[] }> {
  return cached(`categoryView:${topId}`, CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return { chips: [], services: [] };
    
    const resCats = await fetch(
      `${API}/api/categories?shop_id=${shopId}&initData=${encodeURIComponent(initData())}`
    );
    if (!resCats.ok) return { chips: [], services: [] };
    const catsResult = await resCats.json();
    const cats = catsResult.ok ? catsResult.data : [];
    
    const resServices = await fetch(
      `${API}/api/services?shop_id=${shopId}&category_id=${topId}&initData=${encodeURIComponent(initData())}`
    );
    if (!resServices.ok) return { chips: [], services: [] };
    const servicesResult = await resServices.json();
    const allServices = servicesResult.ok ? servicesResult.data : [];
    
    const byId = new Map<string, any>();
    cats.forEach((c: any) => byId.set(c.id, c));
    
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
      .filter((c: any) => c.parent_id === topId)
      .map((c: any) => ({ id: c.id, name: c.name, image_url: c.image_url }));

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
    const services: ServiceCard[] = allServices
      .filter((s: any) => ids.includes(s.category_id))
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        image_url: s.image_url,
        duration_min: s.duration_min,
        price_from: s.price_from,
        branch_id: branchOf(s.category_id),
      }));

    return { chips, services };
  });
}

export async function fetchServiceDetail(
  serviceId: string,
): Promise<{ service: ServiceDetail; masters: Master[] } | null> {
  return cached(`serviceDetail:${serviceId}`, CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) return null;
    
    const res = await fetch(
      `${API}/api/services/detail?shop_id=${shopId}&service_id=${serviceId}&initData=${encodeURIComponent(initData())}`
    );
    if (!res.ok) return null;
    const result = await res.json();
    return result.ok ? result.data : null;
  });
}

/* ---------- запись ---------- */
const API = import.meta.env.VITE_API_URL as string;
const initData = () => window.Telegram?.WebApp?.initData ?? "";

export async function fetchBookingContext(serviceId: string, specialistId: string) {
  const shopId = await getCurrentShopId();
  if (!shopId) return { service: null, master: null, basePrice: null };
  
  const res = await fetch(
    `${API}/api/booking-context?shop_id=${shopId}&service_id=${serviceId}&specialist_id=${specialistId}&initData=${encodeURIComponent(initData())}`
  );
  if (!res.ok) return { service: null, master: null, basePrice: null };
  const result = await res.json();
  return result.ok ? result.data : { service: null, master: null, basePrice: null };
}

export async function fetchSlots(
  specialistId: string,
  serviceId: string,
  dateStr: string,
  _busyRanges: { starts_at: string; ends_at: string }[] = [],
) {
  const res = await fetch(
    `${API}/api/day-slots?specialist=${specialistId}&service=${serviceId}&date=${dateStr}`
  );
  if (!res.ok) return [];
  const result = await res.json();
  return result.ok ? result.slots : [];
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

export async function fetchSpecialistDetail(id: string): Promise<{
  specialist: SpecialistFull | null;
  services: SpecServiceItem[];
  works: Work[];
  reviews: Review[];
  reviewCount: number;
}> {
  return cached(`specialistDetail:${id}`, CATALOG_TTL, async () => {
    const shopId = await getCurrentShopId();
    if (!shopId) {
      return { specialist: null, services: [], works: [], reviews: [], reviewCount: 0 };
    }
    
    const res = await fetch(
      `${API}/api/specialist-detail?shop_id=${shopId}&specialist_id=${id}&initData=${encodeURIComponent(initData())}`
    );
    if (!res.ok) {
      return { specialist: null, services: [], works: [], reviews: [], reviewCount: 0 };
    }
    const result = await res.json();
    return result.ok ? result.data : { specialist: null, services: [], works: [], reviews: [], reviewCount: 0 };
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
    
    const res = await fetch(
      `${API}/api/service-masters?shop_id=${shopId}&service_id=${serviceId}&initData=${encodeURIComponent(initData())}`
    );
    if (!res.ok) return [];
    const result = await res.json();
    return result.ok ? result.data : [];
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
      return { canUse: false, message: "Салон не найден" };
    }
    
    const res = await fetch(`${API}/api/loyalty?initData=${encodeURIComponent(initData())}`);
    if (!res.ok) {
      return { canUse: false, message: "Не удалось проверить доступ" };
    }
    const result = await res.json();
    if (!result.ok) {
      return { canUse: false, message: "Бонусы недоступны" };
    }
    
    return { canUse: true, message: "Бонусы доступны" };
  } catch {
    return { canUse: false, message: "Произошла ошибка" };
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
  face_value: number | null;
  validity_days: number | null;
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
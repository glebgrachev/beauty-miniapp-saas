import { useEffect, useState, useMemo, useCallback, type ReactNode } from "react";
import {
  fetchCategories,
  fetchPromos,
  fetchSpecialists,
  fetchCategoryView,
  fetchServiceDetail,
  fetchBookingContext,
  fetchSlots,
  apiPrice,
  apiBook,
  apiConfirm,
  fetchSpecialistDetail,
  apiPriceCart,
  apiReviewContext,
  apiSubmitReview,
  apiMyBookings,
  apiCancelBooking,
  apiFavoritesList,
  apiToggleFavorite,
  apiMyReviews,
  fetchServiceMasters,
  apiBookCart,
  type ServiceMaster,
  type PriceResult,
  type SpecServiceItem,
  type Work,
  type Review,
  type CartPrice,
  type MyBooking,
  type MyReview,
  type FavSpecialist,
  type FavService,
  apiLoyalty,
  type LoyaltyData,
  type LoyaltyTx,
  apiCertificate,
  apiActivateCertificate,
  type CertItem,
  apiUnsubscribe,
  apiRescheduleStart,
  apiRescheduleCancel,
  apiRescheduleConfirm,
  apiMasterWhoami,
  apiReserveProducts,
  fetchDaySlots,
  apiWaitlistJoin,
  apiWaitlistLeave,
  apiMyWaitlist,
  fetchSpecialistDocs,
  type ActiveReschedule,
  type DaySlot,
  type WaitItem,
  type MasterMe,
  type PublicDoc,
} from "./lib/api";
import MasterCabinet from "./MasterCabinet";
import MasterLinkScreen from "./MasterLinkScreen";
import ShopScreen, { MyProductsScreen, MyCertificatesScreen } from "./ShopScreen";
import { cacheGet, cacheSet, cacheDrop, cacheDropPrefix } from "./lib/cache";
import type {
  Category,
  Promo,
  SpecialistCard,
  Chip,
  ServiceCard,
  ServiceDetail,
  Master,
  Screen,
  CartItem,
  CartProduct,
  CheckoutPosition,
} from "./types";
import {
  loadCart, saveCart, clearCart,
  loadCartProducts, saveCartProducts, clearCartProducts,
} from "./lib/cartStorage";

const tg = window.Telegram?.WebApp;

export default function App() {
  const [stack, setStack] = useState<Screen[]>(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = params.get("confirm");
    const rid = params.get("review");
    const xid = params.get("cancel");
    const uid = params.get("unsub");
    const wl = params.get("wl");
    if (wl) return [{ name: "home" }, { name: "my-waitlist" }];
    if (cid) return [{ name: "home" }, { name: "confirm", bookingId: cid }];
    if (rid) return [{ name: "home" }, { name: "review", bookingId: rid }];
    if (xid) return [{ name: "home" }, { name: "cancel", bookingId: xid }];
    if (uid !== null) return [{ name: "home" }, { name: "unsub", broadcastId: uid || null }];
    return [{ name: "home" }];
  });
  const screen = stack[stack.length - 1];
  const push = (s: Screen) => setStack((p) => [...p, s]);
  const back = () => setStack((p) => (p.length > 1 ? p.slice(0, -1) : p));

  // кабинет мастера: берём из кэша сразу, проверяем в фоне
  const cachedMe = cacheGet<MasterMe>("me", 7 * 24 * 3600_000, "local");
  const [me, setMe] = useState<MasterMe | null>(cachedMe?.value ?? null);
  const [meLoaded, setMeLoaded] = useState(cachedMe != null);

  const checkMe = useCallback(async (retry = 0) => {
    const r = await apiMasterWhoami();

    // initData может быть ещё не готов при первом рендере — пробуем ещё раз
    if (r.status === 401 && retry < 2) {
      setTimeout(() => checkMe(retry + 1), 350);
      return;
    }

    if (r.status === 200 && r.data?.ok) {
      setMe(r.data);
      cacheSet("me", r.data, "local");
    } else if (r.status === 200) {
      // сервер ответил: не мастер
      setMe(null);
      cacheDrop("me", "local");
      cacheDropPrefix("m:", "session");
    }
    // при сетевой ошибке оставляем кэш как есть
    setMeLoaded(true);
  }, []);

  useEffect(() => {
    checkMe();
  }, [checkMe]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);

  // товары в той же корзине
  const [cartProducts, setCartProducts] = useState<CartProduct[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);

  useEffect(() => {
    loadCartProducts().then((p) => {
      setCartProducts(p);
      setProductsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (productsLoaded) saveCartProducts(cartProducts);
  }, [cartProducts, productsLoaded]);

  const addProduct = useCallback((p: CartProduct) => {
    setCartProducts((prev) => {
      const i = prev.findIndex((x) => x.product_id === p.product_id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + p.qty };
        return next;
      }
      return [...prev, p];
    });
  }, []);

  const reserveOnly = useCallback(async () => {
    const r = await apiReserveProducts(
      cartProducts.map((p) => ({ product_id: p.product_id, qty: p.qty })),
    );
    if (r.status === 200 && r.data?.ok) {
      setCartProducts([]);
      clearCartProducts();
      cacheDrop("my-products");
      push({ name: "reserved-done" });
    } else {
      alert("Не удалось отложить. Возможно, товар закончился.");
    }
  }, [cartProducts]);

  const setProductQty = useCallback((productId: string, qty: number) => {
    setCartProducts((prev) =>
      qty <= 0
        ? prev.filter((x) => x.product_id !== productId)
        : prev.map((x) => (x.product_id === productId ? { ...x, qty } : x)),
    );
  }, []);

  // восстановление корзины при запуске (CloudStorage → localStorage)
  useEffect(() => {
    loadCart().then((c) => {
      setCart(c);
      setCartLoaded(true);
    });
  }, []);

  // сохранение корзины при любом изменении (после первичной загрузки)
  useEffect(() => {
    if (cartLoaded) saveCart(cart);
  }, [cart, cartLoaded]);

  const addToCart = (item: CartItem) =>
    setCart((p) =>
      p.some((x) => x.service_id === item.service_id && x.specialist_id === item.specialist_id)
        ? p
        : [...p, item],
    );
  const removeFromCart = (i: number) => setCart((p) => p.filter((_, idx) => idx !== i));

  // избранное
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    apiFavoritesList().then((r) => {
      if (r.status === 200 && r.data?.ok) setFavSet(new Set(r.data.keys));
    });
  }, []);
  const isFav = (kind: "specialist" | "service", id: string) => favSet.has(`${kind}:${id}`);
  const toggleFav = async (kind: "specialist" | "service", id: string) => {
    const key = `${kind}:${id}`;
    setFavSet((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
    const r = await apiToggleFavorite(kind, id);
    if (r.status !== 200 || !r.data) {
      // откат при ошибке
      setFavSet((prev) => {
        const n = new Set(prev);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      });
    }
  };

  useEffect(() => {
    tg?.ready();
    tg?.expand();
  }, []);

  // нативная кнопка «Назад» в Telegram
  useEffect(() => {
    const bb = tg?.BackButton;
    if (!bb) return;
    const handler = () => setStack((p) => (p.length > 1 ? p.slice(0, -1) : p));
    bb.onClick(handler);
    return () => bb.offClick(handler);
  }, []);
  useEffect(() => {
    const bb = tg?.BackButton;
    if (!bb) return;
    if (stack.length > 1) bb.show();
    else bb.hide();
  }, [stack.length]);

  const goTab = (name: "home" | "bookings" | "cart" | "profile") => setStack([{ name }]);

  // позиции для оформления (корзина → расписание)
  const [checkout, setCheckout] = useState<CheckoutPosition[]>([]);
  const startCheckout = (positions: CheckoutPosition[]) => {
    setCheckout(positions);
    push({ name: "schedule" });
  };

  let content: ReactNode;
  if (screen.name === "home") content = <Home onNavigate={push} />;
  else if (screen.name === "bookings")
    content = <BookingsScreen onOpenReview={(id) => push({ name: "review", bookingId: id })} onOpenCancel={(id) => push({ name: "cancel", bookingId: id })} onBrowse={() => goTab("home")} onOpenReschedule={(b) => push({ name: "reschedule", bookingId: b.id, serviceId: b.service_id, specialistId: b.specialist_id, origStartsAt: b.starts_at })} />;
  else if (screen.name === "profile")
    content = <ProfileScreen onNavigate={push} />;
  else if (screen.name === "favorites")
    content = <FavoritesScreen onNavigate={push} onToggleFav={toggleFav} onBack={back} />;
  else if (screen.name === "my-reviews")
    content = <MyReviewsScreen onBack={back} />;
  else if (screen.name === "loyalty")
    content = <LoyaltyScreen onBack={back} />;
  else if (screen.name === "category")
    content = <CategoryScreen id={screen.id} title={screen.title} onNavigate={push} onBack={back} />;
  else if (screen.name === "service")
    content = <ServiceScreen id={screen.id} onNavigate={push} onBack={back} onAddToCart={addToCart} isFav={isFav} onToggleFav={toggleFav} cartCount={cart.length} onOpenCart={() => push({ name: "cart" })} />;
  else if (screen.name === "specialist")
    content = <SpecialistScreen id={screen.id} onNavigate={push} onBack={back} isFav={isFav} onToggleFav={toggleFav} />;
  else if (screen.name === "confirm")
    content = <ConfirmScreen bookingId={screen.bookingId} onHome={() => goTab("home")} />;
  else if (screen.name === "review")
    content = <ReviewScreen bookingId={screen.bookingId} onHome={() => goTab("bookings")} />;
  else if (screen.name === "cancel")
    content = <CancelScreen bookingId={screen.bookingId} onDone={() => goTab("bookings")} onBack={back} />;
  else if (screen.name === "unsub")
    content = <UnsubScreen broadcastId={screen.broadcastId} onHome={() => goTab("home")} />;
  else if (screen.name === "shop")
    content = (
      <ShopScreen
        cartProducts={cartProducts}
        onAdd={addProduct}
        onSetQty={setProductQty}
        onBack={back}
        onCart={() => goTab("cart")}
      />
    );
  else if (screen.name === "my-waitlist")
    content = (
      <MyWaitlistScreen
        onBack={back}
        onBook={(w) =>
          push({
            name: "booking",
            serviceId: w.service_id,
            specialistId: w.specialist_id,
            presetSlot: w.offered_slot ?? undefined,
          })
        }
      />
    );
  else if (screen.name === "my-certificates")
    content = (
      <MyCertificatesScreen onBack={back} onShop={() => push({ name: "shop" })} />
    );
  else if (screen.name === "my-products")
    content = <MyProductsScreen onBack={back} onShop={() => push({ name: "shop" })} />;
  else if (screen.name === "master-link")
    content = (
      <MasterLinkScreen
        onLinked={() => {
          setStack([{ name: "home" }]);
          checkMe();
        }}
        onBack={back}
      />
    );
  else if (screen.name === "reschedule")
    content = (
      <RescheduleScreen
        bookingId={screen.bookingId}
        serviceId={screen.serviceId}
        specialistId={screen.specialistId}
        origStartsAt={screen.origStartsAt}
        onDone={() => goTab("bookings")}
        onBack={back}
      />
    );
  else if (screen.name === "cart")
    content = (
      <CartScreen
        cart={cart}
        products={cartProducts}
        onRemove={removeFromCart}
        onSetProductQty={setProductQty}
        onAdd={() => goTab("home")}
        onShop={() => push({ name: "shop" })}
        onCheckout={startCheckout}
        onReserveOnly={reserveOnly}
      />
    );
  else if (screen.name === "schedule")
    content = (
      <ScheduleScreen
        positions={checkout}
        products={cartProducts}
        onSetProductQty={setProductQty}
        onBack={back}
        onHome={() => {
          setCart([]);
          clearCart();
          setCartProducts([]);
          clearCartProducts();
          cacheDrop("my-products");
          goTab("home");
        }}
      />
    );
  else if (screen.name === "reserved-done")
    content = <ReservedDoneScreen onHome={() => goTab("home")} onMine={() => push({ name: "my-products" })} />;
  else
    content = (
      <BookingScreen
        serviceId={screen.serviceId}
        specialistId={screen.specialistId}
        presetSlot={screen.presetSlot}
        onBack={back}
        onHome={() => goTab("home")}
      />
    );

  const tabRoots = ["home", "bookings", "cart", "profile"];
  const showTabBar = stack.length === 1 && tabRoots.includes(screen.name);
  const activeTab = stack[0].name;

  // мастер: показываем кабинет вместо клиентского интерфейса
  if (meLoaded && me?.ok && screen.name !== "master-link") {
    return <MasterCabinet me={me} />;
  }

  return (
    <div className={showTabBar ? "app has-tabbar" : "app"}>
      {content}
      {showTabBar && (
        <TabBar
          active={activeTab}
          cartCount={cart.length + cartProducts.reduce((s2, p) => s2 + p.qty, 0)}
          onTab={goTab}
        />
      )}
    </div>
  );
}

/* ---------- TAB BAR ---------- */
function TabBar({
  active,
  cartCount,
  onTab,
}: {
  active: string;
  cartCount: number;
  onTab: (n: "home" | "bookings" | "cart" | "profile") => void;
}) {
  // Свежие версии Telegram (>= 6.0) хорошо показывают цветные эмодзи,
  // на старых вебвью — фолбэк на SVG.
  const ver = parseFloat(window.Telegram?.WebApp?.version ?? "0");
  const useEmoji = ver >= 6.0;

  const tabs = [
    { key: "home" as const, label: "Главная", icon: IconHome, emoji: "🏠" },
    { key: "bookings" as const, label: "Записи", icon: IconCalendar, emoji: "🗓" },
    { key: "cart" as const, label: "Корзина", icon: IconBag, emoji: "🛒" },
    { key: "profile" as const, label: "Профиль", icon: IconUser, emoji: "👨‍💼" },
  ];
  return (
    <nav className="tabbar">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = active === t.key;
        return (
          <button key={t.key} className={`tab ${on ? "on" : ""}`} onClick={() => onTab(t.key)}>
            <span className="tab-ic">
              {useEmoji ? <span className="tab-emoji">{t.emoji}</span> : <Icon />}
              {t.key === "cart" && cartCount > 0 && <span className="tab-badge">{cartCount}</span>}
            </span>
            <span className="tab-lb">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* SVG-иконки (inline, без зависимостей — работают и на старых вебвью) */
function IconHome() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  );
}
function IconBag() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    </svg>
  );
}

/* ---------- helpers ---------- */
function certDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(iso));
}

// 

function CertPicker({
  certs,
  maxMoney,
  certId,
  amount,
  onChange,
}: {
  certs: CertItem[];
  maxMoney: number;
  certId: string | null;
  amount: number;
  onChange: (certId: string | null, amount: number) => void;
}) {
  if (certs.length === 0) return null;
  const selected = certs.find((c) => c.id === certId) ?? null;
  const maxCert = selected ? Math.max(0, Math.min(selected.balance, maxMoney)) : 0;
  const clamped = Math.min(amount, maxCert);
  return (
    <div className="redeem-card">
      <div className="redeem-head">
        <span className="redeem-title">🎟 Оплатить сертификатом</span>
      </div>
      <div className="cert-list">
        {certs.map((c) => {
          const on = c.id === certId;
          return (
            <button
              key={c.id}
              className={`cert-opt ${on ? "on" : ""}`}
              onClick={() => (on ? onChange(null, 0) : onChange(c.id, Math.min(c.balance, maxMoney)))}
            >
              <span className="co-code">{c.code}</span>
              <span className="co-bal">{fmtRub(c.balance)}</span>
              <span className="co-exp">{c.expires_at ? `до ${certDate(c.expires_at)}` : "бессрочно"}</span>
            </button>
          );
        })}
      </div>
      {selected && maxCert > 0 && (
        <>
          <input
            type="range"
            min={0}
            max={maxCert}
            step={50}
            value={clamped}
            onChange={(e) => onChange(selected.id, Number(e.target.value))}
            className="redeem-slider"
          />
          <div className="redeem-foot">
            <span>{clamped > 0 ? `Оплата сертификатом: −${fmtRub(clamped)}` : "Двигайте, чтобы применить"}</span>
            <button className="redeem-max" onClick={() => onChange(selected.id, clamped >= maxCert ? 0 : maxCert)}>
              {clamped >= maxCert ? "Сбросить" : "Максимум"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function imgSrc(url: string | null | undefined, w: number, h?: number): string | undefined {
  if (!url) return undefined;
  const marker = "/storage/v1/object/public/";
  const i = url.indexOf(marker);
  if (i === -1) return url; // внешние ссылки (Telegram и т.п.) — без изменений
  const base = url.slice(0, i) + "/storage/v1/render/image/public/" + url.slice(i + marker.length);
  const sep = base.includes("?") ? "&" : "?";
  const size = h ? `width=${w}&height=${h}&resize=cover` : `width=${w}`;
  return `${base}${sep}${size}&quality=75`;
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function todayLabel() {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}
function fmtRub(n: number) {
  return n.toLocaleString("ru-RU") + " ₽";
}
function fmtDuration(min: number) {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
function promoBadge(p: Promo) {
  if (p.kind === "gift") return "Комплекс";
  if (p.discount_type === "percent" && p.discount_value) return `−${p.discount_value}%`;
  if (p.discount_type === "fixed" && p.discount_value) return `−${p.discount_value} ₽`;
  return "Акция";
}

/* ---------- HOME ---------- */
function Home({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistCard[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchCategories(), fetchPromos(), fetchSpecialists()]).then(
      ([c, p, s]) => {
        setCategories(c);
        setPromos(p);
        setSpecialists(s);
        setLoading(false);
      },
    );
  }, []);

  const name = tg?.initDataUnsafe?.user?.first_name ?? "гость";
  const query = q.trim().toLowerCase();
  const visibleSpecs = query
    ? specialists.filter((s) => s.full_name.toLowerCase().includes(query))
    : specialists;

  return (
    <div>
      <div className="hero">
        <div className="hero-top">
          <div className="hero-greet">
            <div className="hi">Привет, {name}! 👋</div>
            <div className="date">{todayLabel()}</div>
          </div>
        </div>
        <div className="search-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск мастера или услуги" />
          {q && <button className="search-clear" onClick={() => setQ("")}>×</button>}
        </div>
      </div>

      {categories.length > 0 && (
        <div className="cats">
          {categories.map((c) => (
            <div key={c.id} className="cat" onClick={() => onNavigate({ name: "category", id: c.id, title: c.name })}>
              <div className="circle">
                {c.image_url ? <img loading="lazy" decoding="async" src={imgSrc(c.image_url, 160, 160)} alt={c.name} /> : <span>✂️</span>}
              </div>
              <div className="lbl">{c.name}</div>
            </div>
          ))}
        </div>
      )}

      {promos.length > 0 && (
        <>
          <div className="sect-title">Акции</div>
          <div className="carousel">
            {promos.map((p) => (
              <div className="ann" key={p.id}>
                {p.banner_url && <img loading="lazy" decoding="async" src={imgSrc(p.banner_url, 800)} alt={p.title} />}
                <span className="tagline">{promoBadge(p)}</span>
                <div className={`cap ${p.banner_url ? "over-img" : ""}`}>{p.title}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="shop-banner" onClick={() => onNavigate({ name: "shop" })}>
        <div className="sb-left">
          <div className="sb-title">🛍 Магазин</div>
          <div className="sb-sub">Профессиональный уход — заберите при визите</div>
        </div>
        <span className="sb-go">›</span>
      </button>

      <div className="sect-title">Наши специалисты</div>
      {loading ? (
        <div className="spec-grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ paddingTop: "130%" }} />)}
        </div>
      ) : visibleSpecs.length === 0 ? (
        <div className="empty">{specialists.length === 0 ? "Мастера скоро появятся." : "Ничего не найдено."}</div>
      ) : (
        <div className="spec-grid">
          {visibleSpecs.map((s) => (
            <div key={s.id} className="spec-card" onClick={() => onNavigate({ name: "specialist", id: s.id })}>
              <div className="photo">
                {s.photo_url ? <img loading="lazy" decoding="async" src={imgSrc(s.photo_url, 240, 240)} alt={s.full_name} /> : <span className="initials">{initials(s.full_name)}</span>}
              </div>
              <div className="body">
                <div className="name">{s.full_name}</div>
                <div className="meta">
                  <span className="rating">★ {s.rating?.toFixed(1) ?? "0.0"}</span>
                  {s.price_from != null && <span className="from">от <b>{fmtRub(s.price_from)}</b></span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- CATEGORY ---------- */
function CategoryScreen({
  id, title, onNavigate, onBack,
}: { id: string; title: string; onNavigate: (s: Screen) => void; onBack: () => void }) {
  const [chips, setChips] = useState<Chip[]>([]);
  const [services, setServices] = useState<ServiceCard[]>([]);
  const [active, setActive] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCategoryView(id).then(({ chips, services }) => {
      setChips(chips);
      setServices(services);
      setLoading(false);
    });
  }, [id]);

  const visible = active ? services.filter((s) => s.branch_id === active) : services;

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>
      <div className="sect-title" style={{ marginTop: 0 }}>{title}</div>

      {chips.length > 0 && (
        <div className="cats">
          <div className={`cat ${active === "" ? "on" : ""}`} onClick={() => setActive("")}>
            <div className="circle all">Все</div>
            <div className="lbl">Все</div>
          </div>
          {chips.map((c) => (
            <div key={c.id} className={`cat ${active === c.id ? "on" : ""}`} onClick={() => setActive(c.id)}>
              <div className="circle">
                {c.image_url ? <img loading="lazy" decoding="async" src={imgSrc(c.image_url, 160, 160)} alt={c.name} /> : <span>✂️</span>}
              </div>
              <div className="lbl">{c.name}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="svc-list">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 80 }} />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">В этой категории пока нет услуг.</div>
      ) : (
        <div className="svc-list">
          {visible.map((s) => (
            <div key={s.id} className="svc-row" onClick={() => onNavigate({ name: "service", id: s.id })}>
              <div className="svc-thumb">{s.image_url && <img loading="lazy" decoding="async" src={imgSrc(s.image_url, 120, 120)} alt={s.name} />}</div>
              <div className="svc-info">
                <div className="svc-name">{s.name}</div>
                <div className="svc-sub">{fmtDuration(s.duration_min)}</div>
              </div>
              <div className="svc-price">
                {s.price_from != null ? <>от {fmtRub(s.price_from)}</> : "—"}
                <small>записаться</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- SERVICE ---------- */
function ServiceScreen({
  id, onNavigate, onBack, onAddToCart, isFav, onToggleFav, cartCount, onOpenCart,
}: {
  id: string;
  onNavigate: (s: Screen) => void;
  onBack: () => void;
  onAddToCart: (item: CartItem) => void;
  isFav: (kind: "specialist" | "service", id: string) => boolean;
  onToggleFav: (kind: "specialist" | "service", id: string) => void;
  cartCount: number;
  onOpenCart: () => void;
}) {
  const [addedId, setAddedId] = useState<string | null>(null);
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [masters, setMasters] = useState<Master[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchServiceDetail(id).then((res) => {
      if (res) { setService(res.service); setMasters(res.masters); }
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div>
        <button className="back-btn" onClick={onBack}>‹ Назад</button>
        <div className="skeleton detail-hero" />
        <div className="skeleton" style={{ height: 28, width: "60%", marginBottom: 10 }} />
      </div>
    );
  }
  if (!service) {
    return (
      <div>
        <button className="back-btn" onClick={onBack}>‹ Назад</button>
        <div className="empty">Услуга не найдена.</div>
      </div>
    );
  }

  const prices = masters.map((m) => m.price);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  const priceLabel =
    min == null || max == null ? "—" : min === max ? fmtRub(min) : `${fmtRub(min)} – ${fmtRub(max)}`;

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>

      <div className="detail-hero">{service.image_url && <img loading="lazy" decoding="async" src={imgSrc(service.image_url, 800)} alt={service.name} />}</div>
      <div className="title-row">
        <h2 className="detail-title">{service.name}</h2>
        <button
          className={`fav-btn ${isFav("service", service.id) ? "on" : ""}`}
          onClick={() => onToggleFav("service", service.id)}
          aria-label="В избранное"
        >
          {isFav("service", service.id) ? "♥" : "♡"}
        </button>
      </div>
      <div className="detail-meta">
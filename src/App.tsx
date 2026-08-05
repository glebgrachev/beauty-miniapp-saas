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
    { key: "profile" as const, label: "Профиль", icon: IconUser, emoji: "👤" },
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
        <span>⏱ {fmtDuration(service.duration_min)}</span>
        <span>💰 {priceLabel}</span>
      </div>
      {service.description && <p className="detail-desc">{service.description}</p>}

      <div className="sect-title">Выберите мастера</div>
      {masters.length === 0 ? (
        <div className="empty">Пока нет мастеров, выполняющих эту услугу.</div>
      ) : (
        masters.map((m) => (
          <div key={m.id} className="master-row">
            <div
              className="master-photo"
              onClick={() => onNavigate({ name: "booking", serviceId: service.id, specialistId: m.id })}
            >
              {m.photo_url ? <img loading="lazy" decoding="async" src={imgSrc(m.photo_url, 120, 120)} alt={m.full_name} /> : initials(m.full_name)}
            </div>
            <div
              className="master-info"
              onClick={() => onNavigate({ name: "booking", serviceId: service.id, specialistId: m.id })}
            >
              <div className="master-name">{m.full_name}</div>
              <div className="master-rating">★ {m.rating?.toFixed(1) ?? "0.0"}</div>
            </div>
            <div className="master-cta">
              <div className="p">{fmtRub(m.price)}</div>
              <div className="row-btns">
                <button
                  className="mini-btn"
                  onClick={() =>
                    onNavigate({ name: "booking", serviceId: service.id, specialistId: m.id })
                  }
                >
                  Записаться
                </button>
                <button
                  className={`mini-btn ghost ${addedId === m.id ? "added" : ""}`}
                  onClick={() => {
                    onAddToCart({
                      service_id: service.id,
                      service_name: service.name,
                      specialist_id: m.id,
                      specialist_name: m.full_name,
                      base_price: m.price,
                    });
                    setAddedId(m.id);
                    setTimeout(() => setAddedId((cur) => (cur === m.id ? null : cur)), 1500);
                  }}
                >
                  {addedId === m.id ? "✓ Добавлено" : "+ в корзину"}
                </button>
              </div>
            </div>
          </div>
        ))
      )}
      {cartCount > 0 && (
        <button className="cart-fab" onClick={onOpenCart}>
          🛒 В корзине: {cartCount} · Перейти
        </button>
      )}
    </div>
  );
}

/* ---------- BOOKING ---------- */
function nextDays(n = 21) {
  const out: { dateStr: string; dow: string; dom: number }[] = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push({
      dateStr: `${y}-${m}-${day}`,
      dow: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(d),
      dom: d.getDate(),
    });
  }
  return out;
}
function slotTime(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(iso));
}
function fullDateTime(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(iso));
}

function BookingScreen({
  serviceId,
  specialistId,
  presetSlot,
  onBack,
  onHome,
}: {
  serviceId: string;
  specialistId: string;
  onBack: () => void;
  onHome: () => void;
  presetSlot?: string;
}) {
  const [ctx, setCtx] = useState<{
    service: { name: string; duration_min: number } | null;
    master: { full_name: string; photo_url: string | null } | null;
    basePrice: number | null;
  } | null>(null);
  const [days] = useState(nextDays());
  const [date, setDate] = useState(days[0].dateStr);
  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slot, setSlot] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Set<string>>(new Set());   // слоты, где я уже в очереди
  const [dayWaiting, setDayWaiting] = useState(false);              // жду весь день
  const [wlBusy, setWlBusy] = useState<string | null>(null);
  const [wlMsg, setWlMsg] = useState<string | null>(null);
  const [price, setPrice] = useState<PriceResult | null>(null);
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState<{ startsAt: string; final: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [redeem, setRedeem] = useState(0);
  const [certs, setCerts] = useState<CertItem[]>([]);
  const [certId, setCertId] = useState<string | null>(null);
  const [certRedeem, setCertRedeem] = useState(0);

  useEffect(() => {
    apiLoyalty().then((r) => {
      if (r.status === 200 && r.data?.ok) setLoyalty(r.data);
    });
    apiCertificate().then((r) => {
      if (r.status === 200 && r.data?.ok) setCerts(r.data.certificates.filter((c) => c.usable));
    });
  }, []);

  useEffect(() => {
    fetchBookingContext(serviceId, specialistId).then(setCtx);
  }, [serviceId, specialistId]);
  useEffect(() => {
    apiPrice(serviceId, specialistId).then((r) => {
      if (r.status === 200 && r.data) setPrice(r.data);
    });
  }, [serviceId, specialistId]);
  useEffect(() => {
    setSlotsLoading(true);
    setSlot(null);
    setWlMsg(null);
    fetchDaySlots(specialistId, serviceId, date).then((s) => {
      setSlots(s);
      setSlotsLoading(false);
      // пришли по ссылке «освободилось время» — сразу подставляем слот
      if (presetSlot && s.some((x) => x.slot_start === presetSlot && x.is_free)) {
        setSlot(presetSlot);
      }
    });
  }, [date, specialistId, serviceId, presetSlot]);

  // дата из предложения
  useEffect(() => {
    if (!presetSlot) return;
    const d = presetSlot.slice(0, 10);
    if (days.some((x) => x.dateStr === d)) setDate(d);
  }, [presetSlot, days]);

  // что я уже жду — чтобы не предлагать встать в очередь дважды
  useEffect(() => {
    apiMyWaitlist().then((r) => {
      if (r.status !== 200 || !r.data?.ok) return;
      const mine = r.data.items.filter(
        (w) => w.specialist_id === specialistId && w.service_id === serviceId,
      );
      setWaiting(new Set(mine.filter((w) => w.kind === "slot" && w.slot_start).map((w) => w.slot_start!)));
      setDayWaiting(mine.some((w) => w.kind === "day" && w.target_date === date));
    });
  }, [specialistId, serviceId, date]);

  async function joinQueue(kind: "slot" | "day", slotIso?: string) {
    setWlBusy(slotIso ?? "day");
    setWlMsg(null);

    const r = await apiWaitlistJoin({
      service_id: serviceId,
      specialist_id: specialistId,
      kind,
      date,
      slot: slotIso ?? null,
    });
    setWlBusy(null);

    if (r.status === 200 && r.data?.ok) {
      if (kind === "slot" && slotIso) {
        setWaiting((prev) => new Set(prev).add(slotIso));
      } else {
        setDayWaiting(true);
      }
      setWlMsg("Вы в очереди. Освободится — пришлём уведомление первым.");
      return;
    }

    const e = r.data?.error;
    setWlMsg(
      e === "limit_reached"
        ? `Можно ждать не больше ${r.data?.limit ?? 3} записей одновременно. Отмените лишнее в профиле.`
        : e === "already_waiting"
        ? "Вы уже в этой очереди."
        : e === "slot_is_free"
        ? "Это время уже свободно — просто выберите его."
        : "Не удалось встать в очередь.",
    );
  }

  async function book() {
    if (!slot) return;
    setBooking(true);
    setErr(null);
    const r = await apiBook(serviceId, specialistId, slot, redeem, certRedeem, certId);
    setBooking(false);
    if (r.status === 200 && r.data?.ok) {
      setResult({ startsAt: r.data.starts_at, final: r.data.money_due ?? r.data.final_price });
    } else if (r.status === 401) {
      setErr("Запись доступна только из Telegram.");
    } else if (r.status === 409) {
      setErr("Этот слот только что заняли. Выберите другое время.");
      fetchDaySlots(specialistId, serviceId, date).then(setSlots);
      setSlot(null);
    } else {
      setErr(r.data?.error ? `Ошибка: ${r.data.error}` : "Не удалось записаться. Попробуйте ещё раз.");
    }
  }

  if (result) {
    return (
      <div className="success">
        <div className="ico">✓</div>
        <h2>Вы записаны!</h2>
        <p>{ctx?.service?.name} · {ctx?.master?.full_name}</p>
        <p style={{ textTransform: "capitalize" }}>{fullDateTime(result.startsAt)}</p>
        <p>К оплате: <b>{fmtRub(result.final)}</b></p>
        <div style={{ maxWidth: 280, margin: "24px auto 0" }}>
          <button className="btn btn-primary" onClick={onHome}>На главную</button>
        </div>
      </div>
    );
  }

  const full = price?.full_price ?? ctx?.basePrice ?? null;
  const discount = price?.discount_amount ?? 0;
  const finalP = price?.final_price ?? full;

  // лимит списания баллов
  const pv = Number(loyalty?.point_value ?? 1) || 1;
  const redeemMaxPct = Number(loyalty?.redeem_max_percent ?? 0) || 0;
  const balancePts = Number(loyalty?.balance ?? 0) || 0;
  const maxByPct = finalP != null ? Math.floor((finalP * redeemMaxPct) / 100 / pv) : 0;
  const maxRedeem = Math.max(0, Math.min(balancePts, maxByPct));
  const redeemClamped = Math.min(redeem, maxRedeem);
  const afterPoints = finalP != null ? Math.max(0, finalP - redeemClamped * pv) : 0;
  const selectedCert = certs.find((c) => c.id === certId) ?? null;
  const maxCert = selectedCert ? Math.max(0, Math.min(selectedCert.balance, afterPoints)) : 0;
  const certClamped = Math.min(certRedeem, maxCert);
  const moneyDue = finalP != null ? Math.max(0, afterPoints - certClamped) : finalP;

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>
      <div className="sect-title" style={{ marginTop: 0 }}>Запись</div>
      <div className="book-sub">
        {ctx?.service?.name ?? "…"}
        {ctx?.master && ` · ${ctx.master.full_name}`}
        {ctx?.service && ` · ${fmtDuration(ctx.service.duration_min)}`}
      </div>

      <div className="sect-title">Дата</div>
      <div className="date-strip">
        {days.map((d) => (
          <button
            key={d.dateStr}
            className={`date-chip ${date === d.dateStr ? "on" : ""}`}
            onClick={() => setDate(d.dateStr)}
          >
            <div className="dow">{d.dow}</div>
            <div className="dom">{d.dom}</div>
          </button>
        ))}
      </div>

      <div className="sect-title">Время</div>
      {slotsLoading ? (
        <div className="slots-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="skeleton" style={{ height: 42, borderRadius: 12 }} />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <div className="empty">В этот день мастер не работает. Выберите другую дату.</div>
      ) : (
        <>
          <div className="slots-grid">
            {slots.map((s) => {
              const inQueue = waiting.has(s.slot_start);
              if (s.is_free) {
                return (
                  <button
                    key={s.slot_start}
                    className={`slot ${slot === s.slot_start ? "on" : ""}`}
                    onClick={() => setSlot(s.slot_start)}
                  >
                    {slotTime(s.slot_start)}
                  </button>
                );
              }
              return (
                <button
                  key={s.slot_start}
                  className={`slot busy ${inQueue ? "queued" : ""}`}
                  disabled={wlBusy === s.slot_start || inQueue}
                  onClick={() => joinQueue("slot", s.slot_start)}
                  title={inQueue ? "Вы в очереди" : "Занято — встать в очередь"}
                >
                  {slotTime(s.slot_start)}
                  <span className="slot-mark">{inQueue ? "🔔" : "🔒"}</span>
                </button>
              );
            })}
          </div>

          {slots.some((s) => !s.is_free) && (
            <div className="book-note">
              Занятое время можно нажать — сообщим, если освободится.
            </div>
          )}

          {slots.every((s) => !s.is_free) && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 10 }}
              disabled={wlBusy === "day" || dayWaiting}
              onClick={() => joinQueue("day", undefined)}
            >
              {dayWaiting
                ? "🔔 Вы в очереди на этот день"
                : wlBusy === "day"
                ? "Встаём в очередь…"
                : "Сообщить о любом окне в этот день"}
            </button>
          )}

          {wlMsg && <div className="book-note wl-msg">{wlMsg}</div>}
        </>
      )}

      {full != null && (
        <div className="price-card">
          <div className="price-row muted">
            <span>Стоимость услуги</span>
            <span>{fmtRub(full)}</span>
          </div>
          {discount > 0 && (
            <div className="price-row discount">
              <span>Скидка{price?.promo_title ? ` · ${price.promo_title}` : ""}</span>
              <span>−{fmtRub(discount)}</span>
            </div>
          )}
          {redeemClamped > 0 && (
            <div className="price-row discount">
              <span>Оплата баллами ({redeemClamped})</span>
              <span>−{fmtRub(redeemClamped * pv)}</span>
            </div>
          )}
          {certClamped > 0 && (
            <div className="price-row discount">
              <span>Оплата сертификатом</span>
              <span>−{fmtRub(certClamped)}</span>
            </div>
          )}
          <div className="price-row total">
            <span>К оплате{redeemClamped > 0 || certClamped > 0 ? " деньгами" : ""}</span>
            <span>{fmtRub(moneyDue ?? full)}</span>
          </div>
        </div>
      )}

      {maxRedeem > 0 && (
        <div className="redeem-card">
          <div className="redeem-head">
            <span className="redeem-title">Списать баллы</span>
            <span className="redeem-bal">Доступно: {loyalty?.balance ?? 0}</span>
          </div>
          <input
            type="range"
            min={0}
            max={maxRedeem}
            step={1}
            value={redeemClamped}
            onChange={(e) => setRedeem(Number(e.target.value))}
            className="redeem-slider"
          />
          <div className="redeem-foot">
            <span>{redeemClamped > 0 ? `Списываем ${redeemClamped} б. · −${fmtRub(redeemClamped * pv)}` : "Двигайте, чтобы применить баллы"}</span>
            <button
              className="redeem-max"
              onClick={() => setRedeem(redeemClamped >= maxRedeem ? 0 : maxRedeem)}
            >
              {redeemClamped >= maxRedeem ? "Сбросить" : "Максимум"}
            </button>
          </div>
        </div>
      )}

      <CertPicker
        certs={certs}
        maxMoney={afterPoints}
        certId={certId}
        amount={certRedeem}
        onChange={(id, amt) => {
          setCertId(id);
          setCertRedeem(amt);
        }}
      />

      {err && <div className="book-note" style={{ color: "#e03945" }}>{err}</div>}

      <div className="book-bar">
        <button className="btn btn-primary" disabled={!slot || booking} onClick={book}>
          {booking ? "Записываем…" : slot ? `Записаться на ${slotTime(slot)}` : "Выберите время"}
        </button>
      </div>
    </div>
  );
}

/* ---------- SPECIALIST ---------- */
function ruYears(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  let w = "лет";
  if (m10 === 1 && m100 !== 11) w = "год";
  else if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) w = "года";
  return `${n} ${w}`;
}
function stars(n: number) {
  const r = Math.round(n);
  return "★★★★★".slice(0, r) + "☆☆☆☆☆".slice(0, 5 - r);
}
function reviewDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(iso));
}

function SpecialistScreen({
  id,
  onNavigate,
  onBack,
  isFav,
  onToggleFav,
}: {
  id: string;
  onNavigate: (s: Screen) => void;
  onBack: () => void;
  isFav: (kind: "specialist" | "service", id: string) => boolean;
  onToggleFav: (kind: "specialist" | "service", id: string) => void;
}) {
  const [data, setData] = useState<{
    specialist: { id: string; full_name: string; photo_url: string | null; bio: string | null; experience_years: number; rating: number } | null;
    services: SpecServiceItem[];
    works: Work[];
    reviews: Review[];
    reviewCount: number;
  } | null>(null);

  const [docs, setDocs] = useState<PublicDoc[]>([]);

  useEffect(() => {
    fetchSpecialistDetail(id).then(setData);
    fetchSpecialistDocs(id).then(setDocs);
  }, [id]);

  if (!data) {
    return (
      <div>
        <button className="back-btn" onClick={onBack}>‹ Назад</button>
        <div className="sp-head">
          <div className="skeleton sp-photo" />
          <div className="skeleton" style={{ height: 24, width: 160, margin: "0 auto" }} />
        </div>
      </div>
    );
  }

  const sp = data.specialist;
  if (!sp) {
    return (
      <div>
        <button className="back-btn" onClick={onBack}>‹ Назад</button>
        <div className="empty">Мастер не найден.</div>
      </div>
    );
  }

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>

      <div className="sp-head">
        <div className="sp-photo">
          {sp.photo_url ? <img loading="lazy" decoding="async" src={imgSrc(sp.photo_url, 240, 240)} alt={sp.full_name} /> : initials(sp.full_name)}
        </div>
        <div className="sp-name">
          {sp.full_name}
          <button
            className={`fav-btn inline ${isFav("specialist", sp.id) ? "on" : ""}`}
            onClick={() => onToggleFav("specialist", sp.id)}
            aria-label="В избранное"
          >
            {isFav("specialist", sp.id) ? "♥" : "♡"}
          </button>
        </div>
        <div className="sp-meta">
          <span className="rating">★ {sp.rating?.toFixed(1) ?? "0.0"}</span>
          {data.reviewCount > 0 && <span>{data.reviewCount} отзывов</span>}
          {sp.experience_years > 0 && <span>опыт {ruYears(sp.experience_years)}</span>}
        </div>
        {sp.bio && <p className="sp-bio">{sp.bio}</p>}
      </div>

      <div className="sect-title">Услуги</div>
      {data.services.length === 0 ? (
        <div className="empty">У мастера пока нет услуг.</div>
      ) : (
        data.services.map((s) => (
          <div
            key={s.id}
            className="msvc-row"
            onClick={() => onNavigate({ name: "booking", serviceId: s.id, specialistId: id })}
          >
            <div>
              <div className="nm">{s.name}</div>
              <div className="du">{fmtDuration(s.duration_min)}</div>
            </div>
            <div className="pr">
              {fmtRub(s.price)}
              <small>записаться ›</small>
            </div>
          </div>
        ))
      )}

      {data.works.length > 0 && (
        <>
          <div className="sect-title">Работы</div>
          <div className="works-strip">
            {data.works.map((w, i) => (
              <div className="work" key={i}>
                <img loading="lazy" decoding="async" src={imgSrc(w.image_url, 400)} alt={w.caption ?? ""} />
                {w.caption && <div className="cap">{w.caption}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {docs.length > 0 && (
        <>
          <div className="sect-title">Дипломы и сертификаты</div>
          <div className="docs-strip">
            {docs.map((d) => (
              <a
                key={d.id}
                className="doc-card"
                href={d.url}
                target="_blank"
                rel="noreferrer"
              >
                {d.mime_type?.startsWith("image/") ? (
                  <img loading="lazy" decoding="async" src={d.url} alt={d.title} />
                ) : (
                  <span className="doc-ic">📄</span>
                )}
                <span className="doc-title">{d.title}</span>
              </a>
            ))}
          </div>
        </>
      )}

      {data.reviews.length > 0 && (
        <>
          <div className="sect-title">Отзывы</div>
          {data.reviews.map((r, i) => (
            <div className="review-card" key={i}>
              <div className="review-top">
                <span className="review-stars">{stars(r.rating)}</span>
                <span className="review-date">{reviewDate(r.created_at)}</span>
              </div>
              {r.comment && <p className="review-text">{r.comment}</p>}
              <div className="review-who">
                {r.client_name}{r.service_name ? ` · ${r.service_name}` : ""}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------- BOOKINGS (мои записи) ---------- */
function statusLabel(s: string) {
  const map: Record<string, string> = {
    new: "Новая",
    confirmed: "Подтверждена",
    paid: "Оплачена",
    completed: "Завершена",
    cancelled: "Отменена",
    no_show: "Не пришёл",
  };
  return map[s] ?? s;
}

function BookingsScreen({
  onOpenReview,
  onOpenCancel,
  onBrowse,
  onOpenReschedule,
}: {
  onOpenReview: (id: string) => void;
  onOpenCancel: (id: string) => void;
  onBrowse: () => void;
  onOpenReschedule: (b: { id: string; service_id: string; specialist_id: string; starts_at: string }) => void;
}) {
  const [data, setData] = useState<{ upcoming: MyBooking[]; past: MyBooking[] } | null>(null);
  const [active, setActive] = useState<ActiveReschedule | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    apiMyBookings().then((r) => {
      if (r.status === 200 && r.data?.ok) {
        setData({ upcoming: r.data.upcoming, past: r.data.past });
        setActive(r.data.active_reschedule ?? null);
        setState("ok");
      } else if (r.status === 401) {
        setMsg("Записи доступны только из Telegram.");
        setState("error");
      } else {
        setMsg("Не удалось загрузить записи.");
        setState("error");
      }
    });
  }

  useEffect(() => { load(); }, []);

  async function startReschedule(b: MyBooking) {
    setBusy(true);
    const r = await apiRescheduleStart(b.id);
    setBusy(false);
    if (r.status === 200 && r.data?.ok) {
      onOpenReschedule({
        id: b.id,
        service_id: b.service_id,
        specialist_id: b.specialist_id,
        starts_at: r.data.orig_starts_at ?? b.starts_at,
      });
    } else {
      const e = r.data?.error;
      alert(
        e === "too_late" ? "Перенести можно не позже чем за 2 часа до визита. Позвоните в салон."
        : e === "wrong_status" ? "Эту запись перенести нельзя."
        : "Не удалось начать перенос.",
      );
    }
  }

  async function cancelReschedule(id: string) {
    setBusy(true);
    await apiRescheduleCancel(id);
    setBusy(false);
    load();
  }

  if (state === "loading") {
    return (
      <div>
        <div className="sect-title" style={{ marginTop: 0 }}>Мои записи</div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: 84, borderRadius: 16, marginBottom: 10 }} />
        ))}
      </div>
    );
  }
  if (state === "error") {
    return (
      <div>
        <div className="sect-title" style={{ marginTop: 0 }}>Мои записи</div>
        <div className="empty">{msg}</div>
      </div>
    );
  }

  const empty = !data || (data.upcoming.length === 0 && data.past.length === 0);
  if (empty) {
    return (
      <div>
        <div className="sect-title" style={{ marginTop: 0 }}>Мои записи</div>
        <div className="empty">У вас пока нет записей.</div>
        <div style={{ maxWidth: 320, margin: "16px auto 0" }}>
          <button className="btn btn-primary" onClick={onBrowse}>Выбрать услугу</button>
        </div>
      </div>
    );
  }

  const card = (b: MyBooking, upcoming: boolean) => (
    <div className={`bk-card ${b.status === "cancelled" || b.status === "no_show" ? "off" : ""}`} key={b.id}>
      <div className="bk-top">
        <div className="bk-svc">{b.service}</div>
        <span className={`bk-status s-${b.status}`}>{statusLabel(b.status)}</span>
      </div>
      <div className="bk-sub">{b.specialist}</div>
      <div className="bk-when" style={{ textTransform: "capitalize" }}>{formatLocalTime(b.starts_at)}</div>
      {upcoming && (b.can_cancel || b.can_reschedule) && (
        <div className="bk-actions">
          {b.can_reschedule && (
            <button className="mini-btn bk-act" disabled={busy} onClick={() => startReschedule(b)}>
              Перенести
            </button>
          )}
          {b.can_cancel && (
            <button className="mini-btn ghost bk-act" onClick={() => onOpenCancel(b.id)}>Отменить запись</button>
          )}
        </div>
      )}
      {upcoming && b.rescheduling && (
        <div className="bk-resched">
          <span>Идёт перенос — оформите новую запись</span>
          <button className="mini-btn ghost" disabled={busy} onClick={() => cancelReschedule(b.id)}>
            Отменить перенос
          </button>
        </div>
      )}
      {!upcoming && b.can_review && (
        b.reviewed ? (
          <div className="bk-note">Отзыв оставлен ✓</div>
        ) : (
          <button className="mini-btn bk-act" onClick={() => onOpenReview(b.id)}>Оставить отзыв</button>
        )
      )}
    </div>
  );

  return (
    <div>
      <div className="sect-title" style={{ marginTop: 0 }}>Мои записи</div>
      {active && (
        <div className="resched-banner">
          <div className="rb-title">🔄 Идёт перенос записи</div>
          <div className="rb-text">
            «{active.service}» — выберите новое время и оформите запись. Старая отменится автоматически.
          </div>
          <div className="rb-actions">
            <button
              className="mini-btn"
              onClick={() =>
                onOpenReschedule({
                  id: active.booking_id,
                  service_id: active.service_id,
                  specialist_id: active.specialist_id,
                  starts_at: active.starts_at,
                })
              }
            >
              Выбрать новое время
            </button>
            <button className="mini-btn ghost" disabled={busy} onClick={() => cancelReschedule(active.booking_id)}>
              Отменить перенос
            </button>
          </div>
        </div>
      )}
      {data!.upcoming.length > 0 && (
        <>
          <div className="bk-group">Предстоящие</div>
          {data!.upcoming.map((b) => card(b, true))}
        </>
      )}
      {data!.past.length > 0 && (
        <>
          <div className="bk-group">Прошедшие</div>
          {data!.past.map((b) => card(b, false))}
        </>
      )}
    </div>
  );
}


/* ---------- RESCHEDULE (перенос записи: мастер + дата + время) ---------- */
function RescheduleScreen({
  bookingId,
  serviceId,
  specialistId,
  origStartsAt,
  onDone,
  onBack,
}: {
  bookingId: string;
  serviceId: string;
  specialistId: string;
  origStartsAt: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const days = useMemo(() => nextDays(30), []);
  const [masters, setMasters] = useState<ServiceMaster[] | null>(null);
  const [specId, setSpecId] = useState(specialistId);
  const [date, setDate] = useState(days[0].dateStr);
  const [slots, setSlots] = useState<{ slot_start: string; slot_end: string }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slot, setSlot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [serviceName, setServiceName] = useState("");
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    fetchServiceDetail(serviceId).then((r) => {
      if (r) {
        setServiceName(r.service.name);
        setDuration(r.service.duration_min);
      }
    });
    fetchServiceMasters(serviceId).then(setMasters);
  }, [serviceId]);

  useEffect(() => {
    setSlotsLoading(true);
    setSlot(null);
    fetchSlots(specId, serviceId, date).then((s) => {
      setSlots(s);
      setSlotsLoading(false);
    });
  }, [specId, serviceId, date]);

  async function confirm() {
    if (!slot) return;
    setSaving(true);
    setErr(null);
    const r = await apiRescheduleConfirm(bookingId, specId, slot);
    setSaving(false);
    if (r.status === 200 && r.data?.ok) {
      onDone();
    } else if (r.status === 409) {
      setErr("Это время только что заняли. Выберите другое.");
      fetchSlots(specId, serviceId, date).then(setSlots);
      setSlot(null);
    } else {
      const e = r.data?.error;
      setErr(
        e === "reschedule_too_far" ? "Перенести можно не более чем на 30 дней вперёд."
        : e === "reschedule_expired" ? "Перенос истёк. Начните заново из «Моих записей»."
        : "Не удалось перенести. Попробуйте ещё раз.",
      );
    }
  }

  const selected = masters?.find((m) => m.id === specId) ?? null;

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>
      <div className="sect-title" style={{ marginTop: 0 }}>Перенос записи</div>
      <div className="book-sub">
        {serviceName || "…"}
        {duration != null && ` · ${fmtDuration(duration)}`}
      </div>
      <div className="book-note" style={{ marginTop: 6 }}>
        Сейчас: <b style={{ textTransform: "capitalize" }}>{fullDateTime(origStartsAt)}</b>
      </div>

      <div className="sect-title">Мастер</div>
      {!masters ? (
        <div className="skeleton" style={{ height: 64, borderRadius: 14 }} />
      ) : masters.length === 0 ? (
        <div className="empty">Нет мастеров для этой услуги.</div>
      ) : (
        masters.map((m) => (
          <div
            key={m.id}
            className={`master-row ${m.id === specId ? "on" : ""}`}
            onClick={() => setSpecId(m.id)}
          >
            <div className="master-photo">
              {m.photo_url ? (
                <img loading="lazy" decoding="async" src={imgSrc(m.photo_url, 120, 120)} alt={m.full_name} />
              ) : (
                initials(m.full_name)
              )}
            </div>
            <div className="master-info">
              <div className="master-name">{m.full_name}</div>
              <div className="master-rating">★ {m.rating?.toFixed(1) ?? "0.0"}</div>
            </div>
            <div className="master-cta">
              <div className="price">{fmtRub(m.price)}</div>
              {m.id === specId && <div className="go">Выбран ✓</div>}
            </div>
          </div>
        ))
      )}

      <div className="sect-title">Дата</div>
      <div className="date-strip">
        {days.map((d) => (
          <button
            key={d.dateStr}
            className={`date-chip ${date === d.dateStr ? "on" : ""}`}
            onClick={() => setDate(d.dateStr)}
          >
            <div className="dow">{d.dow}</div>
            <div className="dom">{d.dom}</div>
          </button>
        ))}
      </div>

      <div className="sect-title">Время</div>
      {slotsLoading ? (
        <div className="slots-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="skeleton" style={{ height: 42, borderRadius: 12 }} />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <div className="empty">На этот день свободных слотов нет. Выберите другую дату.</div>
      ) : (
        <div className="slots-grid">
          {slots.map((s) => (
            <button
              key={s.slot_start}
              className={`slot ${slot === s.slot_start ? "on" : ""}`}
              onClick={() => setSlot(s.slot_start)}
            >
              {slotTime(s.slot_start)}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="price-card">
          <div className="price-row total">
            <span>Стоимость</span>
            <span>{fmtRub(selected.price)}</span>
          </div>
        </div>
      )}

      {err && <div className="book-note" style={{ color: "#e03945" }}>{err}</div>}

      <div className="book-bar">
        <button className="btn btn-primary" disabled={!slot || saving} onClick={confirm}>
          {saving ? "Переносим…" : "Подтвердить перенос"}
        </button>
      </div>
    </div>
  );
}

/* ---------- UNSUBSCRIBE (отписка от промо-рассылок) ---------- */
function UnsubScreen({ broadcastId, onHome }: { broadcastId: string | null; onHome: () => void }) {
  const [status, setStatus] = useState<"loading" | "ok" | "err">("loading");
  useEffect(() => {
    apiUnsubscribe(broadcastId).then((r) => {
      setStatus(r.status === 200 && r.data?.ok ? "ok" : "err");
    });
  }, [broadcastId]);

  return (
    <div className="unsub-wrap">
      {status === "loading" && <div className="unsub-body">Отписываем…</div>}
      {status === "ok" && (
        <>
          <div className="unsub-emoji">💜</div>
          <div className="unsub-title">Вы отписаны от рассылок</div>
          <div className="unsub-body">
            Больше не будем присылать промо-сообщения. Уведомления по вашим записям продолжат приходить.
          </div>
          <button className="btn btn-primary" onClick={onHome}>На главную</button>
        </>
      )}
      {status === "err" && (
        <>
          <div className="unsub-title">Не получилось</div>
          <div className="unsub-body">Попробуйте ещё раз позже.</div>
          <button className="btn btn-primary" onClick={onHome}>На главную</button>
        </>
      )}
    </div>
  );
}

/* ---------- CANCEL (отмена записи с подтверждением) ---------- */
function CancelScreen({
  bookingId,
  onDone,
  onBack,
}: {
  bookingId: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<"ask" | "sending" | "done" | "error">("ask");
  const [msg, setMsg] = useState("");

  async function doCancel() {
    setState("sending");
    const r = await apiCancelBooking(bookingId);
    if (r.status === 200 && r.data?.ok) setState("done");
    else {
      if (r.status === 401) setMsg("Отмена доступна только из Telegram.");
      else if (r.data?.error === "too_late") setMsg("Отменить можно не позже чем за 3 часа до визита. Позвоните в салон.");
      else if (r.data?.error === "not_cancelable") setMsg("Эту запись уже нельзя отменить.");
      else if (r.status === 403) setMsg("Эта запись принадлежит другому пользователю.");
      else setMsg("Не удалось отменить. Попробуйте позже.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="success">
        <div className="ico">✓</div>
        <h2>Запись отменена</h2>
        <p>Слот освобождён. Будем рады видеть вас снова.</p>
        <div style={{ maxWidth: 280, margin: "24px auto 0" }}>
          <button className="btn btn-primary" onClick={onDone}>К моим записям</button>
        </div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="success">
        <div className="ico" style={{ background: "#fdeaea", color: "#e03945" }}>!</div>
        <h2>Не получилось</h2>
        <p>{msg}</p>
        <div style={{ maxWidth: 280, margin: "24px auto 0" }}>
          <button className="btn btn-primary" onClick={onDone}>К моим записям</button>
        </div>
      </div>
    );
  }

  return (
    <div className="success">
      <div className="ico" style={{ background: "#fff4e5", color: "#e08a00" }}>?</div>
      <h2>Отменить запись?</h2>
      <p>Это действие нельзя отменить. Слот станет свободным для других.</p>
      <div style={{ maxWidth: 320, margin: "24px auto 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <button className="btn btn-primary" disabled={state === "sending"} onClick={doCancel}>
          {state === "sending" ? "Отменяем…" : "Да, отменить"}
        </button>
        <button className="btn btn-ghost" onClick={onBack}>Нет, оставить</button>
      </div>
    </div>
  );
}

/* ---------- PROFILE (хаб) ---------- */
function ProfileScreen({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ") || "Гость";

  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [certs, setCerts] = useState<CertItem[]>([]);
  const [code, setCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [certMsg, setCertMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function loadCerts() {
    apiCertificate().then((r) => {
      if (r.status === 200 && r.data?.ok) setCerts(r.data.certificates);
    });
  }

  useEffect(() => {
    apiLoyalty().then((r) => {
      if (r.status === 200 && r.data?.ok) setLoyalty(r.data);
    });
    loadCerts();
  }, []);

  async function activate() {
    const c = code.trim();
    if (!c) return;
    setActivating(true);
    setCertMsg(null);
    const r = await apiActivateCertificate(c);
    setActivating(false);
    if (r.status === 200 && r.data?.ok) {
      setCode("");
      setCertMsg({ ok: true, text: `Сертификат активирован: +${r.data.added ?? 0} ₽` });
      loadCerts();
    } else {
      const err = r.data?.error;
      const text =
        err === "not_found" ? "Код не найден" :
        err === "already_used" ? "Этот сертификат уже активирован" :
        err === "already_yours" ? "Этот сертификат уже на вашем счету" :
        err === "disabled" ? "Сертификат отключён" :
        err === "expired" ? "Срок действия сертификата истёк" :
        err === "empty_code" ? "Введите код" :
        "Не удалось активировать";
      setCertMsg({ ok: false, text });
    }
  }

  return (
    <div>
      <div className="sect-title" style={{ marginTop: 0 }}>Профиль</div>
      <div className="sp-head">
        <div className="sp-photo">
          {u?.photo_url ? <img loading="lazy" decoding="async" src={imgSrc(u.photo_url, 140, 140)} alt={name} /> : initials(name)}
        </div>
        <div className="sp-name">{name}</div>
        {u?.username && <div className="sp-meta"><span>@{u.username}</span></div>}
      </div>

      {loyalty && (
        <button className="loyalty-card" onClick={() => onNavigate({ name: "loyalty" })}>
          <div className="lc-left">
            <div className="lc-label">Мои баллы</div>
            <div className="lc-balance">{fmtPoints(loyalty.balance)}</div>
            {loyalty.cashback_percent > 0 && (
              <div className="lc-hint">Кешбэк {loyalty.cashback_percent}% с каждого визита</div>
            )}
          </div>
          <span className="lc-go">›</span>
        </button>
      )}

      {certs.some((c) => c.usable) && (
        <button
          className="loyalty-card cert-sum"
          onClick={() => onNavigate({ name: "my-certificates" })}
        >
          <div className="lc-left">
            <div className="lc-label">Мои сертификаты</div>
            <div className="lc-balance">
              {fmtRub(certs.filter((c) => c.usable).reduce((s, c) => s + Number(c.balance), 0))}
            </div>
            <div className="lc-hint">
              {(() => {
                const n = certs.filter((c) => c.usable).length;
                return n === 1 ? "1 активный" : `${n} активных`;
              })()}
            </div>
          </div>
          <span className="lc-go">›</span>
        </button>
      )}

      <div className="cert-activate">
        <div className="ca-title">Активировать сертификат</div>
        <div className="ca-row">
          <input
            className="ca-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BS-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect="off"
          />
          <button className="ca-btn" disabled={activating || !code.trim()} onClick={activate}>
            {activating ? "…" : "Активировать"}
          </button>
        </div>
        {certMsg && (
          <div className={`ca-msg ${certMsg.ok ? "ok" : "err"}`}>{certMsg.text}</div>
        )}
      </div>

      <div className="menu-list">
        <button className="menu-row" onClick={() => onNavigate({ name: "favorites" })}>
          <span className="menu-ic">♥</span>
          <span className="menu-tx">Избранное</span>
          <span className="menu-go">›</span>
        </button>
        <button className="menu-row" onClick={() => onNavigate({ name: "my-reviews" })}>
          <span className="menu-ic">★</span>
          <span className="menu-tx">Мои отзывы</span>
          <span className="menu-go">›</span>
        </button>
        <button className="menu-row" onClick={() => onNavigate({ name: "my-waitlist" })}>
          <span className="menu-ic">🔔</span>
          <span className="menu-tx">Лист ожидания</span>
          <span className="menu-go">›</span>
        </button>
        <button className="menu-row" onClick={() => onNavigate({ name: "my-certificates" })}>
          <span className="menu-ic">🎁</span>
          <span className="menu-tx">Мои сертификаты</span>
          <span className="menu-go">›</span>
        </button>
        <button className="menu-row" onClick={() => onNavigate({ name: "my-products" })}>
          <span className="menu-ic">🛍</span>
          <span className="menu-tx">Мои товары</span>
          <span className="menu-go">›</span>
        </button>
        <button className="menu-row" onClick={() => onNavigate({ name: "master-link" })}>
          <span className="menu-ic">💼</span>
          <span className="menu-tx">Вход для сотрудников</span>
          <span className="menu-go">›</span>
        </button>
      </div>
    </div>
  );
}

/* ---------- LOYALTY (баллы: баланс + история) ---------- */
function pointsWord(n: number) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "баллов";
  if (b === 1) return "балл";
  if (b >= 2 && b <= 4) return "балла";
  return "баллов";
}
function fmtPoints(n: number) {
  return `${n} ${pointsWord(n)}`;
}
function loyaltyDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(new Date(iso));
}
function txLabel(t: LoyaltyTx) {
  if (t.note) return t.note;
  if (t.kind === "accrual") return "Начисление";
  if (t.kind === "redemption") return "Списание";
  return "Корректировка";
}

function LoyaltyScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    apiLoyalty().then((r) => {
      if (r.status === 200 && r.data?.ok) setData(r.data);
      setLoaded(true);
    });
  }, []);

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>
      <div className="sect-title" style={{ marginTop: 0 }}>Мои баллы</div>

      <div className="loyalty-hero">
        <div className="lh-balance">{fmtPoints(data?.balance ?? 0)}</div>
        {(data?.cashback_percent ?? 0) > 0 && (
          <div className="lh-hint">Кешбэк {data?.cashback_percent}% с каждого оплаченного визита</div>
        )}
        <div className="lh-totals">
          <span>Начислено: {data?.total_earned ?? 0}</span>
          <span>Потрачено: {data?.total_spent ?? 0}</span>
        </div>
      </div>

      <div className="sect-title">История</div>
      {!loaded ? (
        <div className="skeleton" style={{ height: 60, borderRadius: 14 }} />
      ) : !data || data.transactions.length === 0 ? (
        <div className="empty">Пока операций нет. Баллы начислим после первого визита.</div>
      ) : (
        data.transactions.map((t, i) => (
          <div className="ltx-row" key={i}>
            <div className="ltx-main">
              <div className="ltx-note">{txLabel(t)}</div>
              <div className="ltx-date">{loyaltyDate(t.created_at)}</div>
            </div>
            <div className={`ltx-points ${t.points >= 0 ? "plus" : "minus"}`}>
              {t.points >= 0 ? "+" : ""}{t.points}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- FAVORITES (экран с чипсами) ---------- */
function FavoritesScreen({
  onNavigate,
  onToggleFav,
  onBack,
}: {
  onNavigate: (s: Screen) => void;
  onToggleFav: (kind: "specialist" | "service", id: string) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"specialist" | "service">("specialist");
  const [favSpec, setFavSpec] = useState<FavSpecialist[]>([]);
  const [favSvc, setFavSvc] = useState<FavService[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiFavoritesList().then((r) => {
      if (r.status === 200 && r.data?.ok) {
        setFavSpec(r.data.specialists);
        setFavSvc(r.data.services);
      }
      setLoaded(true);
    });
  }, []);

  const removeFav = (kind: "specialist" | "service", id: string) => {
    onToggleFav(kind, id);
    if (kind === "specialist") setFavSpec((p) => p.filter((x) => x.id !== id));
    else setFavSvc((p) => p.filter((x) => x.id !== id));
  };

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>
      <div className="sect-title" style={{ marginTop: 0 }}>Избранное</div>

      <div className="pills">
        <button className={`pill ${tab === "specialist" ? "on" : ""}`} onClick={() => setTab("specialist")}>
          Мастера · {favSpec.length}
        </button>
        <button className={`pill ${tab === "service" ? "on" : ""}`} onClick={() => setTab("service")}>
          Услуги · {favSvc.length}
        </button>
      </div>

      {!loaded ? (
        <div className="skeleton" style={{ height: 64, borderRadius: 14, marginTop: 12 }} />
      ) : tab === "specialist" ? (
        favSpec.length === 0 ? (
          <div className="empty">Нет избранных мастеров. Добавьте сердечком ♥ на странице мастера.</div>
        ) : (
          favSpec.map((s) => (
            <div className="fav-row" key={s.id}>
              <div className="fav-photo round" onClick={() => onNavigate({ name: "specialist", id: s.id })}>
                {s.photo_url ? <img loading="lazy" decoding="async" src={imgSrc(s.photo_url, 120, 120)} alt={s.full_name} /> : initials(s.full_name)}
              </div>
              <div className="fav-main" onClick={() => onNavigate({ name: "specialist", id: s.id })}>
                <div className="nm">{s.full_name}</div>
                <div className="su">★ {s.rating?.toFixed(1) ?? "0.0"}</div>
              </div>
              <button className="fav-btn on" onClick={() => removeFav("specialist", s.id)} aria-label="Убрать">♥</button>
            </div>
          ))
        )
      ) : favSvc.length === 0 ? (
        <div className="empty">Нет избранных услуг. Добавьте сердечком ♥ на странице услуги.</div>
      ) : (
        favSvc.map((s) => (
          <div className="fav-row" key={s.id}>
            <div className="fav-photo" onClick={() => onNavigate({ name: "service", id: s.id })}>
              {s.image_url ? <img loading="lazy" decoding="async" src={imgSrc(s.image_url, 120, 120)} alt={s.name} /> : "✂️"}
            </div>
            <div className="fav-main" onClick={() => onNavigate({ name: "service", id: s.id })}>
              <div className="nm">{s.name}</div>
              <div className="su">{fmtDuration(s.duration_min)}</div>
            </div>
            <button className="fav-btn on" onClick={() => removeFav("service", s.id)} aria-label="Убрать">♥</button>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- MY REVIEWS (экран с чипсами по статусу) ---------- */
function MyReviewsScreen({ onBack }: { onBack: () => void }) {
  const [reviews, setReviews] = useState<MyReview[] | null>(null);
  const [filter, setFilter] = useState<"approved" | "pending" | "rejected">("approved");

  useEffect(() => {
    apiMyReviews().then((r) => {
      setReviews(r.status === 200 && r.data?.ok ? r.data.reviews : []);
    });
  }, []);

  const counts = {
    approved: (reviews ?? []).filter((r) => r.status === "approved").length,
    pending: (reviews ?? []).filter((r) => r.status === "pending").length,
    rejected: (reviews ?? []).filter((r) => r.status === "rejected").length,
  };
  const shown = (reviews ?? []).filter((r) => r.status === filter);

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>
      <div className="sect-title" style={{ marginTop: 0 }}>Мои отзывы</div>

      <div className="pills">
        <button className={`pill ${filter === "approved" ? "on" : ""}`} onClick={() => setFilter("approved")}>
          Опубликованные · {counts.approved}
        </button>
        <button className={`pill ${filter === "pending" ? "on" : ""}`} onClick={() => setFilter("pending")}>
          На модерации · {counts.pending}
        </button>
        <button className={`pill ${filter === "rejected" ? "on" : ""}`} onClick={() => setFilter("rejected")}>
          Отклонённые · {counts.rejected}
        </button>
      </div>

      {reviews === null ? (
        <div className="skeleton" style={{ height: 70, borderRadius: 14, marginTop: 12 }} />
      ) : shown.length === 0 ? (
        <div className="empty">Здесь пока пусто.</div>
      ) : (
        shown.map((r) => (
          <div className="review-card" key={r.id}>
            <div className="review-top">
              <span className="review-stars">{stars(r.specialist_rating)}</span>
              <span className="review-date">{reviewDate(r.created_at)}</span>
            </div>
            {r.comment && <p className="review-text">{r.comment}</p>}
            <div className="review-who">
              {r.specialist ?? ""}{r.service ? ` · ${r.service}` : ""}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- CART ---------- */
function CartScreen({
  cart,
  products,
  onRemove,
  onSetProductQty,
  onAdd,
  onShop,
  onCheckout,
  onReserveOnly,
}: {
  cart: CartItem[];
  products: CartProduct[];
  onRemove: (i: number) => void;
  onSetProductQty: (productId: string, qty: number) => void;
  onAdd: () => void;
  onShop: () => void;
  onCheckout: (positions: CheckoutPosition[]) => void;
  onReserveOnly: () => void;
}) {
  const [price, setPrice] = useState<CartPrice | null>(null);
  const [reserving, setReserving] = useState(false);

  const productsTotal = products.reduce((s, p) => s + p.price * p.qty, 0);
  const productsCount = products.reduce((s, p) => s + p.qty, 0);

  const goods = products.filter((p) => p.kind !== "certificate");
  const gifts = products.filter((p) => p.kind === "certificate");

  useEffect(() => {
    if (cart.length === 0) { setPrice(null); return; }
    apiPriceCart(cart.map((c) => ({ service_id: c.service_id, specialist_id: c.specialist_id }))).then(
      (r) => {
        if (r.status === 200 && r.data) setPrice(r.data);
      },
    );
  }, [cart]);

  if (cart.length === 0 && products.length === 0) {
    return (
      <div>
        <div className="sect-title" style={{ marginTop: 0 }}>Корзина</div>
        <div className="empty">
          В корзине пусто. Добавьте услуги, чтобы записаться на несколько процедур сразу,
          или загляните в магазин.
        </div>
        <div style={{ maxWidth: 320, margin: "16px auto 0", display: "grid", gap: 8 }}>
          <button className="btn btn-primary" onClick={onAdd}>К услугам</button>
          <button className="btn btn-ghost" onClick={onShop}>В магазин</button>
        </div>
      </div>
    );
  }

  const subtotal = price?.subtotal ?? cart.reduce((s, c) => s + c.base_price, 0);
  const discount = price?.discount_total ?? 0;
  const total = price?.total ?? subtotal;

  const goSchedule = () => {
    const positions: CheckoutPosition[] = cart.map((c, i) => {
      const p = price?.items[i];
      return {
        key: `c${i}`,
        service_id: c.service_id,
        service_name: c.service_name,
        specialist_id: c.specialist_id,
        specialist_name: c.specialist_name,
        base_price: p?.full_price ?? c.base_price,
        final_price: p?.final_price ?? c.base_price,
        discount: p?.discount_amount ?? 0,
        promo_title: p?.promo_title ?? null,
        is_gift: false,
        gift_discount_percent: 0,
      };
    });
    (price?.gifts ?? []).forEach((g, i) => {
      positions.push({
        key: `g${i}`,
        service_id: g.gift_service_id,
        service_name: g.gift_service_name,
        specialist_id: null,
        specialist_name: null,
        base_price: 0,
        final_price: 0,
        discount: 0,
        promo_title: g.promo_title,
        is_gift: true,
        gift_discount_percent: g.gift_discount_percent,
      });
    });
    onCheckout(positions);
  };

  return (
    <div>
      <div className="sect-title" style={{ marginTop: 0 }}>Корзина</div>

      {cart.map((c, i) => {
        const p = price?.items[i];
        const full = p?.full_price ?? c.base_price;
        const final = p?.final_price ?? c.base_price;
        const disc = p?.discount_amount ?? 0;
        return (
          <div className="cart-row" key={`${c.service_id}-${c.specialist_id}`}>
            <div className="cart-main">
              <div className="nm">{c.service_name}</div>
              <div className="su">{c.specialist_name}</div>
              {disc > 0 && p?.promo_title && <div className="promo">{p.promo_title}</div>}
            </div>
            <div className="cart-price">
              {disc > 0 ? (
                <>
                  <span className="old">{fmtRub(full)}</span>
                  <span className="now">{fmtRub(final)}</span>
                </>
              ) : (
                <span className="now">{fmtRub(full)}</span>
              )}
            </div>
            <button className="cart-del" onClick={() => onRemove(i)} aria-label="Удалить">×</button>
          </div>
        );
      })}

      {price && price.gifts.length > 0 && (
        <>
          <div className="sect-title">В подарок</div>
          {price.gifts.map((g) => (
            <div className="cart-row gift" key={g.promo_id}>
              <div className="cart-main">
                <div className="nm">🎁 {g.gift_service_name}</div>
                <div className="su">{g.promo_title}</div>
              </div>
              <div className="cart-price">
                <span className="now">
                  {g.gift_discount_percent >= 100 ? "бесплатно" : `−${g.gift_discount_percent}%`}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      {goods.length > 0 && (
        <>
          <div className="sect-title">Товары</div>
          {goods.map((p) => (
            <CartProductRow
              key={p.product_id}
              p={p}
              onSetQty={onSetProductQty}
            />
          ))}
          <div className="book-note" style={{ marginTop: 4 }}>
            Товары придержим в салоне — заберёте и оплатите на месте.
          </div>
        </>
      )}

      {gifts.length > 0 && (
        <>
          <div className="sect-title">Подарочные сертификаты</div>
          {gifts.map((p) => (
            <CartProductRow
              key={p.product_id}
              p={p}
              onSetQty={onSetProductQty}
            />
          ))}
          <div className="book-note" style={{ marginTop: 4 }}>
            Код придёт в этот чат, как только оплата будет подтверждена в салоне.
          </div>
        </>
      )}

      <div className="price-card">
        {cart.length > 0 && (
          <div className="price-row muted">
            <span>Услуги</span>
            <span>{fmtRub(subtotal)}</span>
          </div>
        )}
        {discount > 0 && (
          <div className="price-row discount">
            <span>Скидка</span>
            <span>−{fmtRub(discount)}</span>
          </div>
        )}
        {products.length > 0 && (
          <div className="price-row muted">
            <span>Товары ({productsCount} шт)</span>
            <span>{fmtRub(productsTotal)}</span>
          </div>
        )}
        <div className="price-row total">
          <span>К оплате</span>
          <span>{fmtRub(total + productsTotal)}</span>
        </div>
      </div>

      {price && price.gifts.length > 0 && (
        <div className="book-note">Подарок и время по каждой услуге выберете на следующем шаге.</div>
      )}

      <div className="book-bar">
        {cart.length > 0 ? (
          <>
            <button className="btn btn-primary" onClick={goSchedule}>
              Выбрать время
            </button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onAdd}>
              Добавить ещё услугу
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-primary"
              disabled={reserving}
              onClick={() => {
                setReserving(true);
                onReserveOnly();
              }}
            >
              {reserving ? "Откладываем…" : `Отложить · ${fmtRub(productsTotal)}`}
            </button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onAdd}>
              Записаться на услугу
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- ЛИСТ ОЖИДАНИЯ ---------- */
function MyWaitlistScreen({
  onBack,
  onBook,
}: {
  onBack: () => void;
  onBook: (w: WaitItem) => void;
}) {
  const [items, setItems] = useState<WaitItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  function load() {
    apiMyWaitlist().then((r) => {
      setItems(r.status === 200 && r.data?.ok ? r.data.items : []);
    });
  }

  useEffect(load, []);

  // тикаем, чтобы обратный отсчёт предложения шёл вживую
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function leave(id: string) {
    if (!confirm("Выйти из очереди?")) return;
    setBusy(id);
    const r = await apiWaitlistLeave(id);
    setBusy(null);
    if (r.status === 200 && r.data?.ok) load();
    else alert("Не удалось выйти из очереди.");
  }

  if (!items) {
    return (
      <div>
        <button className="back-btn" onClick={onBack}>‹ Назад</button>
        <div className="skeleton" style={{ height: 90, borderRadius: 14, marginTop: 12 }} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <button className="back-btn" onClick={onBack}>‹ Назад</button>
        <div className="sect-title" style={{ marginTop: 0 }}>Лист ожидания</div>
        <div className="empty">
          Вы никого не ждёте. Если нужное время занято — нажмите на него при записи,
          и мы сообщим, когда оно освободится.
        </div>
      </div>
    );
  }

  const offered = items.filter((w) => w.status === "offered");
  const waiting = items.filter((w) => w.status === "waiting");

  return (
    <div>
      <button className="back-btn" onClick={onBack}>‹ Назад</button>
      <div className="sect-title" style={{ marginTop: 0 }}>Лист ожидания</div>

      {offered.length > 0 && (
        <>
          <div className="sect-title">Освободилось — успейте записаться</div>
          {offered.map((w) => {
            const left = w.offer_expires_at
              ? Math.max(0, new Date(w.offer_expires_at).getTime() - now)
              : 0;
            const mm = Math.floor(left / 60000);
            const ss = Math.floor((left % 60000) / 1000);

            return (
              <div className="wl-card offer" key={w.id}>
                <div className="wl-top">
                  <div className="wl-svc">{w.service_name}</div>
                  <div className="wl-timer">
                    {left > 0 ? `⏳ ${mm}:${String(ss).padStart(2, "0")}` : "истекло"}
                  </div>
                </div>
                <div className="wl-meta">
                  {w.specialist_name}
                  {w.offered_slot && <> · {fullDateTime(w.offered_slot)}</>}
                </div>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 10 }}
                  disabled={left <= 0}
                  onClick={() => onBook(w)}
                >
                  {left > 0 ? "Записаться" : "Время вышло"}
                </button>
              </div>
            );
          })}
        </>
      )}

      {waiting.length > 0 && (
        <>
          <div className="sect-title">Ожидаю</div>
          {waiting.map((w) => (
            <div className="wl-card" key={w.id}>
              <div className="wl-svc">{w.service_name}</div>
              <div className="wl-meta">
                {w.specialist_name} ·{" "}
                {w.kind === "slot" && w.slot_start
                  ? fullDateTime(w.slot_start)
                  : `${dayLabelRu(w.target_date)}, любое время`}
              </div>
              <button
                className="wl-leave"
                disabled={busy === w.id}
                onClick={() => leave(w.id)}
              >
                {busy === w.id ? "Выходим…" : "Выйти из очереди"}
              </button>
            </div>
          ))}
          <div className="book-note">
            Как только время освободится, пришлём уведомление. Место придержим 30 минут.
          </div>
        </>
      )}
    </div>
  );
}

function dayLabelRu(dateStr: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "short",
  }).format(new Date(`${dateStr}T12:00:00`));
}

/* ---------- ТОВАРЫ ОТЛОЖЕНЫ ---------- */
function ReservedDoneScreen({ onHome, onMine }: { onHome: () => void; onMine: () => void }) {
  return (
    <div className="shop-done">
      <div className="shop-done-ic">🛍</div>
      <div className="shop-done-t">Товары отложены</div>
      <div className="shop-done-s">
        Придержим их в салоне. Заберёте и оплатите при визите.
      </div>
      <div style={{ maxWidth: 300, margin: "0 auto", display: "grid", gap: 8 }}>
        <button className="btn btn-primary" onClick={onMine}>Мои товары</button>
        <button className="btn btn-ghost" onClick={onHome}>На главную</button>
      </div>
    </div>
  );
}

/* ---------- REVIEW ---------- */
function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="stars-input">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star ${n <= value ? "on" : ""}`}
          onClick={() => onChange(n)}
          aria-label={`${n}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ReviewScreen({ bookingId, onHome }: { bookingId: string; onHome: () => void }) {
  const [state, setState] = useState<"loading" | "form" | "done" | "error">("loading");
  const [ctx, setCtx] = useState<{ service: string | null; specialist: string | null } | null>(null);
  const [spRating, setSpRating] = useState(0);
  const [svRating, setSvRating] = useState(0);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [alreadyApproved, setAlreadyApproved] = useState(false);

  useEffect(() => {
    apiReviewContext(bookingId).then((r) => {
      if (r.status === 200 && r.data?.ok) {
        setCtx({ service: r.data.service, specialist: r.data.specialist });
        if (r.data.existing) {
          setSpRating(r.data.existing.specialist_rating);
          setSvRating(r.data.existing.service_rating);
          setComment(r.data.existing.comment ?? "");
          if (r.data.existing.status === "approved") setAlreadyApproved(true);
        }
        setState("form");
      } else if (r.status === 401) {
        setMsg("Отзыв можно оставить только из Telegram.");
        setState("error");
      } else if (r.status === 403) {
        setMsg("Эта запись принадлежит другому пользователю.");
        setState("error");
      } else {
        setMsg("Запись не найдена.");
        setState("error");
      }
    });
  }, [bookingId]);

  async function submit() {
    if (spRating < 1 || svRating < 1) {
      setMsg("Поставьте оценку мастеру и услуге.");
      return;
    }
    setSending(true);
    setMsg("");
    const r = await apiSubmitReview(bookingId, spRating, svRating, comment);
    setSending(false);
    if (r.status === 200 && r.data?.ok) setState("done");
    else if (r.status === 400 && r.data?.error === "too_early") setMsg("Отзыв можно оставить после визита.");
    else setMsg("Не удалось отправить отзыв. Попробуйте позже.");
  }

  if (state === "loading") {
    return (
      <div className="success">
        <div className="skeleton ico" style={{ background: "var(--card)" }} />
        <p>Загружаем…</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="success">
        <div className="ico" style={{ background: "#fdeaea", color: "#e03945" }}>!</div>
        <h2>Не получилось</h2>
        <p>{msg}</p>
        <div style={{ maxWidth: 280, margin: "24px auto 0" }}>
          <button className="btn btn-primary" onClick={onHome}>На главную</button>
        </div>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="success">
        <div className="ico">✓</div>
        <h2>Спасибо за отзыв!</h2>
        <p>Он появится после проверки модератором.</p>
        <div style={{ maxWidth: 280, margin: "24px auto 0" }}>
          <button className="btn btn-primary" onClick={onHome}>На главную</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sect-title" style={{ marginTop: 0 }}>Ваш отзыв</div>
      <div className="book-sub">
        {ctx?.service}
        {ctx?.specialist && ` · ${ctx.specialist}`}
      </div>

      {alreadyApproved && (
        <div className="book-note" style={{ textAlign: "left" }}>
          Вы уже оставляли отзыв. Можно изменить — он снова уйдёт на проверку.
        </div>
      )}

      <div className="review-block">
        <div className="review-label">Мастер{ctx?.specialist ? ` · ${ctx.specialist}` : ""}</div>
        <StarInput value={spRating} onChange={setSpRating} />
      </div>
      <div className="review-block">
        <div className="review-label">Услуга{ctx?.service ? ` · ${ctx.service}` : ""}</div>
        <StarInput value={svRating} onChange={setSvRating} />
      </div>

      <div className="review-block">
        <div className="review-label">Комментарий (необязательно)</div>
        <textarea
          className="review-textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Поделитесь впечатлением…"
          maxLength={1000}
          rows={4}
        />
      </div>

      {msg && <div className="book-note" style={{ color: "#e03945" }}>{msg}</div>}

      <div className="book-bar">
        <button className="btn btn-primary" disabled={sending} onClick={submit}>
          {sending ? "Отправляем…" : "Отправить отзыв"}
        </button>
      </div>
    </div>
  );
}

/* ---------- SCHEDULE (A2: время по позициям) ---------- */
type ChosenSlot = {
  specialist_id: string;
  specialist_name: string;
  starts_at: string;
  ends_at: string;
  final_price: number;
};

function ScheduleScreen({
  positions,
  products,
  onSetProductQty,
  onBack,
  onHome,
}: {
  positions: CheckoutPosition[];
  products: CartProduct[];
  onSetProductQty: (productId: string, qty: number) => void;
  onBack: () => void;
  onHome: () => void;
}) {
  const N = positions.length;
  const [days] = useState(nextDays());
  const [idx, setIdx] = useState(0);
  const [chosen, setChosen] = useState<Record<string, ChosenSlot>>({});
  const [giftSpec, setGiftSpec] = useState<Record<string, ServiceMaster>>({});
  const [masters, setMasters] = useState<ServiceMaster[] | null>(null);
  const [date, setDate] = useState(days[0].dateStr);
  const [slots, setSlots] = useState<{ slot_start: string; slot_end: string; is_free: boolean }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slot, setSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [orderDone, setOrderDone] = useState(false);
  const [orderErr, setOrderErr] = useState("");
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [redeem, setRedeem] = useState(0);
  const [certs, setCerts] = useState<CertItem[]>([]);
  const [certId, setCertId] = useState<string | null>(null);
  const [certRedeem, setCertRedeem] = useState(0);

  useEffect(() => {
    apiLoyalty().then((r) => {
      if (r.status === 200 && r.data?.ok) setLoyalty(r.data);
    });
    apiCertificate().then((r) => {
      if (r.status === 200 && r.data?.ok) setCerts(r.data.certificates.filter((c) => c.usable));
    });
  }, []);

  const pos = idx < N ? positions[idx] : null;

  // лимит списания баллов на весь заказ
  const cartTotal = positions.reduce((s, p) => s + (chosen[p.key]?.final_price ?? 0), 0);
  const productsTotal = products.reduce((s2, p) => s2 + p.price * p.qty, 0);
  const productsCount = products.reduce((s2, p) => s2 + p.qty, 0);
  const pv = Number(loyalty?.point_value ?? 1) || 1;
  const redeemMaxPct = Number(loyalty?.redeem_max_percent ?? 0) || 0;
  const balancePts = Number(loyalty?.balance ?? 0) || 0;
  const maxByPct = Math.floor((cartTotal * redeemMaxPct) / 100 / pv);
  const maxRedeem = Math.max(0, Math.min(balancePts, maxByPct));
  const redeemClamped = Math.min(redeem, maxRedeem);
  const afterPoints = Math.max(0, cartTotal - redeemClamped * pv);
  const selectedCert = certs.find((c) => c.id === certId) ?? null;
  const maxCert = selectedCert ? Math.max(0, Math.min(selectedCert.balance, afterPoints)) : 0;
  const certClamped = Math.min(certRedeem, maxCert);
  const moneyDue = Math.max(0, afterPoints - certClamped);
  const resolvedSpec: ServiceMaster | null = pos
    ? pos.is_gift
      ? giftSpec[pos.key] ?? null
      : { id: pos.specialist_id!, full_name: pos.specialist_name!, photo_url: null, rating: 0, price: pos.base_price }
    : null;

  // загрузка мастеров для подарка
  useEffect(() => {
    if (pos && pos.is_gift && !giftSpec[pos.key]) {
      setMasters(null);
      fetchServiceMasters(pos.service_id).then(setMasters);
    }
  }, [idx]);

  // слоты для текущей позиции
  useEffect(() => {
    if (!pos || !resolvedSpec) return;
    setSlotsLoading(true);
    setSlot(null);
    // уже выбранные в корзине слоты (у любых мастеров) — клиент не может быть в двух местах сразу
    const busy = positions
      .filter((p) => p.key !== pos.key && chosen[p.key])
      .map((p) => ({ starts_at: chosen[p.key]!.starts_at, ends_at: chosen[p.key]!.ends_at }));
    fetchSlots(resolvedSpec.id, pos.service_id, date, busy).then((s) => {
      setSlots(s);
      setSlotsLoading(false);
    });
  }, [idx, resolvedSpec?.id, date]);

  function pickMaster(m: ServiceMaster) {
    if (!pos) return;
    setGiftSpec((p) => ({ ...p, [pos.key]: m }));
    setDate(days[0].dateStr);
  }

  function next() {
    if (!pos || !resolvedSpec || !slot) return;
    const sl = slots.find((x) => x.slot_start === slot)!;
    const finalP = pos.is_gift
      ? pos.gift_discount_percent >= 100
        ? 0
        : Math.round((resolvedSpec.price * (100 - pos.gift_discount_percent)) / 100)
      : pos.final_price;
    const updated = {
      ...chosen,
      [pos.key]: {
        specialist_id: resolvedSpec.id,
        specialist_name: resolvedSpec.full_name,
        starts_at: slot,
        ends_at: sl.slot_end,
        final_price: finalP,
      },
    };
    setChosen(updated);
    setDate(days[0].dateStr);
    const nextMissing = positions.findIndex((p) => !updated[p.key]);
    setIdx(nextMissing === -1 ? N : nextMissing);
  }

  function back() {
    if (idx > 0) {
      setDate(days[0].dateStr);
      setIdx(idx - 1);
    } else onBack();
  }

  async function placeOrder() {
    setSubmitting(true);
    setOrderErr("");
    const items = positions.map((p) => {
      const c = chosen[p.key];
      return {
        service_id: p.service_id,
        specialist_id: c.specialist_id,
        starts_at: c.starts_at,
        is_gift: p.is_gift,
        gift_discount_percent: p.gift_discount_percent,
      };
    });
    const r = await apiBookCart(
      items,
      redeemClamped,
      certClamped,
      certId,
      products.map((p) => ({ product_id: p.product_id, qty: p.qty })),
    );
    setSubmitting(false);
    if (r.status === 200 && r.data?.ok) {
      setOrderDone(true);
    } else if (r.status === 409 && r.data?.busy) {
      // освобождаем выбор только для занятых позиций и ведём к первой из них
      const busy = r.data.busy;
      setChosen((prev) => {
        const n = { ...prev };
        busy.forEach((bi) => {
          const p = positions[bi];
          if (p) delete n[p.key];
        });
        return n;
      });
      const first = busy[0] ?? 0;
      setDate(days[0].dateStr);
      setIdx(first);
      setOrderErr("Эти слоты только что заняли — выберите другое время для отмеченных услуг.");
    } else if (r.status === 401) {
      setOrderErr("Оформление доступно только из Telegram.");
    } else {
      setOrderErr("Не удалось оформить заказ. Попробуйте ещё раз.");
    }
  }

  const busy = resolvedSpec
  ? Object.entries(chosen)
      .filter(([k, c]) => c.specialist_id === resolvedSpec.id && k !== pos?.key)
      .map((e) => [Date.parse(e[1].starts_at), Date.parse(e[1].ends_at)] as [number, number])
  : [];
const availSlots = slots.filter((sl) => {
  // ✅ Если слот занят в БД — не показываем
  if (!sl.is_free) return false;
  
  // ✅ Если слот занят в корзине — не показываем
  const s = Date.parse(sl.slot_start);
  const e = Date.parse(sl.slot_end);
  return !busy.some(([bs, be]) => s < be && e > bs);
});

  if (N === 0) {
    return (
      <div>
        <button className="back-btn" onClick={onBack}>‹ Назад</button>
        <div className="empty">Корзина пуста.</div>
      </div>
    );
  }

  // ---- УСПЕХ ----
  if (orderDone) {
    const total = positions.reduce((s, p) => s + (chosen[p.key]?.final_price ?? 0), 0);
    return (
      <div className="success">
        <div className="ico">✓</div>
        <h2>Заказ оформлен!</h2>
        <p>{positions.length} {positions.length === 1 ? "услуга" : "услуг"} · к оплате {fmtRub(total)}</p>
        <p>Подтверждение отправлено в чат с ботом.</p>
        <div style={{ maxWidth: 280, margin: "24px auto 0" }}>
          <button className="btn btn-primary" onClick={onHome}>На главную</button>
        </div>
      </div>
    );
  }

  // ---- СВОДКА ----
  if (idx >= N) {
    return (
      <div>
        <button className="back-btn" onClick={() => setIdx(N - 1)}>‹ Назад</button>
        <div className="sect-title" style={{ marginTop: 0 }}>Проверьте заказ</div>
        {positions.map((p) => {
          const c = chosen[p.key];
          return (
            <div className="cart-row" key={p.key}>
              <div className="cart-main">
                <div className="nm">{p.is_gift ? `🎁 ${p.service_name}` : p.service_name}</div>
                <div className="su">{c?.specialist_name}</div>
                <div className="su" style={{ textTransform: "capitalize" }}>{c ? fullDateTime(c.starts_at) : ""}</div>
              </div>
              <div className="cart-price">
                <span className="now">{p.is_gift && p.gift_discount_percent >= 100 ? "бесплатно" : fmtRub(c?.final_price ?? 0)}</span>
              </div>
            </div>
          );
        })}
        {products.length > 0 && (
          <>
            <div className="sect-title">
              {products.some((p) => p.kind !== "certificate") ? "Товары к выдаче" : "Сертификаты"}
            </div>
            {products.map((p) => (
              <div className="cart-row" key={p.product_id}>
                <div className="cp-img">
                  {p.photo_url ? (
                    <img loading="lazy" decoding="async" src={imgSrc(p.photo_url, 120, 120)} alt={p.name} />
                  ) : (
                    <span>{p.kind === "certificate" ? "🎁" : "🧴"}</span>
                  )}
                </div>
                <div className="cart-main">
                  <div className="nm">{p.name}</div>
                  <div className="su">
                    {p.kind === "certificate" && p.face_value
                      ? `Номинал ${fmtRub(Number(p.face_value))}`
                      : `${fmtRub(p.price)} за шт`}
                  </div>
                  <div className="shop-qty" style={{ marginTop: 6, width: "fit-content" }}>
                    <button onClick={() => onSetProductQty(p.product_id, p.qty - 1)}>−</button>
                    <span>{p.qty}</span>
                    <button onClick={() => onSetProductQty(p.product_id, p.qty + 1)}>+</button>
                  </div>
                </div>
                <div className="cart-price">
                  <span className="now">{fmtRub(p.price * p.qty)}</span>
                </div>
                <button
                  className="cart-del"
                  onClick={() => onSetProductQty(p.product_id, 0)}
                  aria-label="Убрать"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="book-note" style={{ marginTop: 4 }}>
              Придержим до визита. Передумали? Уберите крестиком.
            </div>
          </>
        )}

        <div className="price-card">
          <div className="price-row muted">
            <span>{products.length > 0 ? "Услуги" : "Сумма"}</span>
            <span>{fmtRub(cartTotal)}</span>
          </div>
          {redeemClamped > 0 && (
            <div className="price-row discount">
              <span>Оплата баллами ({redeemClamped})</span>
              <span>−{fmtRub(redeemClamped * pv)}</span>
            </div>
          )}
          {certClamped > 0 && (
            <div className="price-row discount">
              <span>Оплата сертификатом</span>
              <span>−{fmtRub(certClamped)}</span>
            </div>
          )}
          {productsTotal > 0 && (
            <div className="price-row muted">
              <span>Товары ({productsCount} шт)</span>
              <span>{fmtRub(productsTotal)}</span>
            </div>
          )}
          <div className="price-row total">
            <span>К оплате{redeemClamped > 0 || certClamped > 0 ? " деньгами" : ""}</span>
            <span>{fmtRub(moneyDue + productsTotal)}</span>
          </div>
        </div>

        {maxRedeem > 0 && (
          <div className="redeem-card">
            <div className="redeem-head">
              <span className="redeem-title">Списать баллы</span>
              <span className="redeem-bal">Доступно: {loyalty?.balance ?? 0}</span>
            </div>
            <input
              type="range"
              min={0}
              max={maxRedeem}
              step={1}
              value={redeemClamped}
              onChange={(e) => setRedeem(Number(e.target.value))}
              className="redeem-slider"
            />
            <div className="redeem-foot">
              <span>{redeemClamped > 0 ? `Списываем ${redeemClamped} б. · −${fmtRub(redeemClamped * pv)}` : "Двигайте, чтобы применить баллы"}</span>
              <button
                className="redeem-max"
                onClick={() => setRedeem(redeemClamped >= maxRedeem ? 0 : maxRedeem)}
              >
                {redeemClamped >= maxRedeem ? "Сбросить" : "Максимум"}
              </button>
            </div>
          </div>
        )}

        <CertPicker
          certs={certs}
          maxMoney={afterPoints}
          certId={certId}
          amount={certRedeem}
          onChange={(id, amt) => {
            setCertId(id);
            setCertRedeem(amt);
          }}
        />

        {orderErr && <div className="book-note" style={{ color: "#e03945" }}>{orderErr}</div>}
        <div className="book-bar">
          <button className="btn btn-primary" disabled={submitting} onClick={placeOrder}>
            {submitting ? "Оформляем…" : "Подтвердить заказ"}
          </button>
        </div>
      </div>
    );
  }

  // ---- ВЫБОР МАСТЕРА ДЛЯ ПОДАРКА ----
  if (pos && pos.is_gift && !resolvedSpec) {
    return (
      <div>
        <button className="back-btn" onClick={back}>‹ Назад</button>
        <div className="book-sub">Шаг {idx + 1} из {N}</div>
        <div className="sect-title" style={{ marginTop: 4 }}>🎁 {pos.service_name}</div>
        <div className="book-sub">Подарок — выберите мастера</div>
        {masters === null ? (
          <div className="skeleton" style={{ height: 64, borderRadius: 14, marginTop: 8 }} />
        ) : masters.length === 0 ? (
          <div className="empty">Нет мастеров для этой услуги.</div>
        ) : (
          masters.map((m) => (
            <div key={m.id} className="master-row" onClick={() => pickMaster(m)}>
              <div className="master-photo">
                {m.photo_url ? <img loading="lazy" decoding="async" src={imgSrc(m.photo_url, 120, 120)} alt={m.full_name} /> : initials(m.full_name)}
              </div>
              <div className="master-info">
                <div className="master-name">{m.full_name}</div>
                <div className="master-rating">★ {m.rating?.toFixed(1) ?? "0.0"}</div>
              </div>
              <div className="master-cta">
                <div className="go">Выбрать ›</div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  // ---- ВЫБОР ДАТЫ/ВРЕМЕНИ ----
  return (
    <div>
      <button className="back-btn" onClick={back}>‹ Назад</button>
      <div className="book-sub">Шаг {idx + 1} из {N}</div>
      <div className="sect-title" style={{ marginTop: 4 }}>
        {pos!.is_gift ? `🎁 ${pos!.service_name}` : pos!.service_name}
      </div>
      <div className="book-sub">{resolvedSpec!.full_name}</div>

      <div className="sect-title">Дата</div>
      <div className="date-strip">
        {days.map((d) => (
          <button key={d.dateStr} className={`date-chip ${date === d.dateStr ? "on" : ""}`} onClick={() => setDate(d.dateStr)}>
            <div className="dow">{d.dow}</div>
            <div className="dom">{d.dom}</div>
          </button>
        ))}
      </div>

      <div className="sect-title">Время</div>
      {slotsLoading ? (
        <div className="slots-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="skeleton" style={{ height: 42, borderRadius: 12 }} />
          ))}
        </div>
      ) : availSlots.length === 0 ? (
        <div className="empty">На этот день свободных слотов нет. Выберите другую дату.</div>
      ) : (
        <div className="slots-grid">
          {availSlots.map((s) => (
            <button key={s.slot_start} className={`slot ${slot === s.slot_start ? "on" : ""}`} onClick={() => setSlot(s.slot_start)}>
              {slotTime(s.slot_start)}
            </button>
          ))}
        </div>
      )}

      <div className="book-bar">
        <button className="btn btn-primary" disabled={!slot} onClick={next}>
          {idx === N - 1 ? "К проверке заказа" : "Далее"}
        </button>
      </div>
    </div>
  );
}

/* ---------- CONFIRM (Приду) ---------- */
function ConfirmScreen({ bookingId, onHome }: { bookingId: string; onHome: () => void }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [info, setInfo] = useState<{ service: string | null; specialist: string | null; starts_at: string } | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    apiConfirm(bookingId).then((r) => {
      if (r.status === 200 && r.data?.ok) {
        setInfo({ service: r.data.service, specialist: r.data.specialist, starts_at: r.data.starts_at });
        setState("ok");
      } else if (r.status === 401) {
        setMsg("Подтверждение доступно только из Telegram.");
        setState("error");
      } else if (r.status === 403) {
        setMsg("Эта запись принадлежит другому пользователю.");
        setState("error");
      } else if (r.status === 404) {
        setMsg("Запись не найдена.");
        setState("error");
      } else {
        setMsg("Не удалось подтвердить. Попробуйте позже.");
        setState("error");
      }
    });
  }, [bookingId]);

  if (state === "loading") {
    return (
      <div className="success">
        <div className="skeleton ico" style={{ background: "var(--card)" }} />
        <p>Подтверждаем визит…</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="success">
        <div className="ico" style={{ background: "#fdeaea", color: "#e03945" }}>!</div>
        <h2>Не получилось</h2>
        <p>{msg}</p>
        <div style={{ maxWidth: 280, margin: "24px auto 0" }}>
          <button className="btn btn-primary" onClick={onHome}>На главную</button>
        </div>
      </div>
    );
  }
  return (
    <div className="success">
      <div className="ico">✓</div>
      <h2>Спасибо, ждём вас!</h2>
      {info && (
        <>
          <p>{info.service} · {info.specialist}</p>
          <p style={{ textTransform: "capitalize" }}>{fullDateTime(info.starts_at)}</p>
        </>
      )}
      <div style={{ maxWidth: 280, margin: "24px auto 0" }}>
        <button className="btn btn-primary" onClick={onHome}>На главную</button>
      </div>
    </div>
  );
}


/* строка товара/сертификата в корзине */
function CartProductRow({
  p,
  onSetQty,
}: {
  p: CartProduct;
  onSetQty: (productId: string, qty: number) => void;
}) {
  const isCert = p.kind === "certificate";

  return (
    <div className="cart-row">
      <div className="cp-img">
        {p.photo_url ? (
          <img loading="lazy" decoding="async" src={imgSrc(p.photo_url, 120, 120)} alt={p.name} />
        ) : (
          <span>{isCert ? "🎁" : "🧴"}</span>
        )}
      </div>
      <div className="cart-main">
        <div className="nm">{p.name}</div>
        <div className="su">
          {isCert && p.face_value
            ? `Номинал ${fmtRub(Number(p.face_value))}`
            : `${fmtRub(p.price)} за шт`}
        </div>
        <div className="shop-qty" style={{ marginTop: 6, width: "fit-content" }}>
          <button onClick={() => onSetQty(p.product_id, p.qty - 1)}>−</button>
          <span>{p.qty}</span>
          <button onClick={() => onSetQty(p.product_id, p.qty + 1)}>+</button>
        </div>
      </div>
      <div className="cart-price">
        <span className="now">{fmtRub(p.price * p.qty)}</span>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type AccountView, type Game, type Level, type Locale, type Round } from "@/shared/domain";
import { initialProgress, learn, type Progress } from "@/shared/adaptive";
import { Account } from "./account";
import { Care } from "./care";
import { copy, gameCopy } from "./copy";
import { ActivityArt, Exercise, type Score } from "./games";
import { api, RequestError } from "./http";
import { Icon } from "./icons";
import { enqueueOffline, purgeOffline, syncOffline } from "./offline";
import { Reminders } from "./reminders";

type View = "home" | "activities" | "today" | "care" | "account" | "game" | "complete";
type MainView = Extract<View, "home" | "activities" | "today" | "care">;
const navigation: { view: MainView; icon: string }[] = [
  { view: "home", icon: "home" },
  { view: "activities", icon: "games" },
  { view: "today", icon: "today" },
  { view: "care", icon: "care" },
];
const voices = { en: "en-US", es: "es-US" };

function ActivityList({ locale, items, choose }: { locale: Locale; items: readonly Game[]; choose: (game: Game) => void }) {
  return <div className="activity-grid">{items.map((game) => {
    const detail = gameCopy[locale][game];
    return <button key={game} className="activity-card" onClick={() => choose(game)}>
      <ActivityArt game={game} />
      <span className="activity-body">
        <span className="domain">{detail.domain}</span>
        <strong>{detail.title}</strong>
        <span className="card-description">{detail.description}</span>
        <span className="card-action" aria-hidden="true">{copy[locale].playNow}<Icon name="arrow" size={20} /></span>
      </span>
    </button>;
  })}</div>;
}

export function App({ preview }: { preview: boolean }) {
  const [locale, setLocale] = useState<Locale>("en");
  const t = copy[locale];
  const [larger, setLarger] = useState(false);
  const [view, setView] = useState<View>("home");
  const [game, setGame] = useState<Game>("MATCH");
  const [roundNo, setRoundNo] = useState(0);
  const items: readonly Game[] = ["MATCH", "FOCUS", "ROUTINE", "PATTERN"];
  const [online, setOnline] = useState(true);
  const [dueOwner, setDueOwner] = useState<string | null>(null);
  const [deviceQueue, setDeviceQueue] = useState(false);
  const [account, setAccount] = useState<AccountView | null>(null);
  const [saveState, setSaveState] = useState<keyof typeof copy.en | null>(null);
  const [notice, setNotice] = useState<keyof typeof copy.en | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [date, setDate] = useState<Date | null>(null);
  const [completed, setCompleted] = useState<{ round: Round; key: string } | null>(null);
  const [localProgress, setLocalProgress] = useState<Partial<Record<Game, Progress>>>({});
  const main = useRef<HTMLElement>(null);
  const initialized = useRef(false);
  const owner = useRef<string | null>(null);
  const activeRound = useRef<string | null>(null);
  const ready = account?.state === "ready" ? account : null;

  function navigate(destination: View) {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setNotice(null);
    setView(destination);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => main.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }));
  }

  function choose(game: Game) {
    setGame(game);
    setRoundNo((value) => value + 1);
    activeRound.current = null;
    setSaveState(null);
    setCompleted(null);
    navigate("game");
  }

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await api<AccountView>("/api/account", undefined, signal);
    if (!signal?.aborted) {
      owner.current = result.state === "ready" ? result.id : null;
      setAccount(result);
    }
    return result;
  }, []);

  useEffect(() => {
    const init = window.setTimeout(() => {
      setDate(new Date());
      const query = new URLSearchParams(window.location.search);
      if (query.get("account")) {
        setView("account");
        if (query.has("error")) setNotice("accountUnavailable");
        window.history.replaceState({}, "", "/");
      }
      try {
        if (localStorage.getItem("cognicare-language") === "es") setLocale("es");
        setLarger(localStorage.getItem("cognicare-large") === "yes");
        setDeviceQueue(localStorage.getItem("cognicare-offline") === "yes");
      } catch { }
      initialized.current = true;
      setOnline(navigator.onLine);
      void purgeOffline(null).catch(() => undefined);
      if ("serviceWorker" in navigator && !window.location.pathname.startsWith("/api")) {
        void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      }
    }, 0);

    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      clearTimeout(init);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (initialized.current) try { localStorage.setItem("cognicare-language", locale); } catch {}
  }, [locale]);

  useEffect(() => {
    document.documentElement.classList.toggle("large-print", larger);
    if (initialized.current) try { localStorage.setItem("cognicare-large", larger ? "yes" : "no"); } catch {}
  }, [larger]);

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal)).catch(() => undefined);
    return () => controller.abort();
  }, [online, refresh]);

  useEffect(() => {
    if (!ready || !online || !deviceQueue) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function flush() {
      if (!ready || controller.signal.aborted) return;
      try {
        const count = await syncOffline(ready.id, controller.signal);
        if (count && !controller.signal.aborted) {
          setNotice("synced");
          setSaveState((prior) => prior === "queued" ? "synced" : prior);
        }
      } catch { }
      if (!controller.signal.aborted) timer = setTimeout(flush, 15_000);
    }
    void flush();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [ready, online, deviceQueue]);

  useEffect(() => {
    if (!ready || !online || view === "today") return;
    const controller = new AbortController();
    const id = ready.id;
    function check() {
      api<{ due: boolean }>("/api/reminders?due=1", undefined, controller.signal)
        .then(({ due }) => { if (!controller.signal.aborted) setDueOwner(due ? id : null); })
        .catch(() => undefined);
    }
    check();
    const interval = setInterval(check, 60_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [ready, online, view]);

  function speak(content: string) {
    if (!("speechSynthesis" in window)) { setNotice("voiceMissing"); return; }
    const synthesis = window.speechSynthesis;
    if (speaking) { synthesis.cancel(); setSpeaking(false); return; }
    const candidates = synthesis.getVoices().filter((voice) => voice.localService);
    const voice = candidates.find((voice) => voice.lang === voices[locale]) ??
      candidates.find((voice) => voice.lang.startsWith(locale));
    if (!voice) { setNotice("voiceMissing"); return; }
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.voice = voice;
    utterance.lang = locale;
    utterance.rate = 0.86;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setNotice(null);
    setSpeaking(true);
    synthesis.speak(utterance);
  }

  async function offlineToggle() {
    if (deviceQueue) await purgeOffline(null, true);
    else await purgeOffline(null);
    localStorage.setItem("cognicare-offline", deviceQueue ? "no" : "yes");
    setDeviceQueue(!deviceQueue);
    setNotice(deviceQueue ? "offlineOff" : "offlineOn");
  }

  async function signOut() {
    const previous = owner.current;
    if (previous) await purgeOffline(previous, true);
    await api("/api/auth/sign-out", {});
    owner.current = null;
    setAccount(null);
    activeRound.current = null;
    setLocalProgress({});
    setCompleted(null);
    await refresh().catch(() => undefined);
    navigate("home");
    setNotice("signedOut");
  }

  async function save(round: Round, key: string) {
    const current = owner.current;
    const updateStatus = (state: keyof typeof copy.en) => {
      if (activeRound.current === key) setSaveState(state);
    };
    if (!current) { updateStatus("noSave"); return; }
    updateStatus("saving");
    try {
      if (!navigator.onLine) throw new TypeError("Offline");
      const result = await api<{ difficulty: Level }>("/api/rounds", { data: round, key, owner: current });
      if (owner.current !== current) return;
      setAccount((value) => value?.state === "ready" && value.id === current
        ? { ...value, levels: { ...value.levels, [round.game]: result.difficulty } } : value);
      updateStatus("saved");
    } catch (error) {
      if (owner.current !== current) return;
      const retryable = error instanceof TypeError || (error instanceof RequestError && (error.status >= 500 || error.status === 429));
      if (retryable && deviceQueue) {
        try { await enqueueOffline(current, key, round); updateStatus("queued"); return; }
        catch { }
      }
      updateStatus(error instanceof RequestError && [401, 403].includes(error.status) ? "connect" : "saveAgain");
    }
  }

  function complete(score: Score, difficulty: Level) {
    const round: Round = { ...score, difficulty, game, playedAt: new Date().toISOString() };
    const key = crypto.randomUUID();
    activeRound.current = key;
    setLocalProgress((value) => ({ ...value, [game]: learn(value[game] ?? { ...initialProgress, difficulty }, round) }));
    setCompleted({ round, key });
    navigate("complete");
    void save(round, key);
  }

  const today = date && new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(date);
  const activeNav = view === "game" || view === "complete" ? "activities" : view;
  const gameName = gameCopy[locale][game].title;

  const speechText = view === "home" ? t.pageTitle + " " + t.welcome :
    view === "activities" ? t.activities + ". " + items.map((item) => gameCopy[locale][item].title).join(". ") :
    view === "game" ? gameCopy[locale][game].instructions :
    view === "complete" ? t.wellDone + " " + t.giveTime :
    view === "today" ? t.todayTitle + ". " + t.todayIntro :
    view === "care" ? t.careTitle :
    t.myAccount;

  return (
    <>
      <a className="skip-link" href="#content">{t.skip}</a>
      <header className="header">
        <div className="header-inner">
          <button className="brand" onClick={() => navigate("home")} aria-label={"CogniCare · " + t.home}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-32.png" width={35} height={35} alt="" /> <span>Cogni<em>Care</em></span>
          </button>
          <nav className="nav" aria-label={locale === "en" ? "Main navigation" : "Navegación principal"}>
            {navigation.map(({ view, icon }) => <button key={view} className="nav-item"
              aria-current={activeNav === view ? "page" : undefined} onClick={() => navigate(view)}>
              <Icon name={icon} size={19} /><span>{t[view]}</span>
            </button>)}
          </nav>
          <div className="header-tools">
            <button className="text-switch" title={larger ? t.resetText : t.bigger} aria-label={larger ? t.resetText : t.bigger}
              aria-pressed={larger} onClick={() => setLarger(!larger)}>Aa</button>
            <label className="sr-only" htmlFor="locale">{t.language}</label>
            <select id="locale" className="locale" value={locale} onChange={(event) => {
              if ("speechSynthesis" in window) window.speechSynthesis.cancel();
              setSpeaking(false); setLocale(event.target.value as Locale);
            }}>
              <option value="en" lang="en">English</option><option value="es" lang="es">Español</option>
            </select>
            <button className="button quiet sign-in" onClick={() => navigate("account")}>
              {ready || account?.state === "enroll" || account?.state === "verify" ? t.myAccount : t.signIn}
            </button>
          </div>
        </div>
      </header>

      <main id="content" ref={main} className="layout" tabIndex={-1}>
        <div className="notices" aria-live="polite">
          {!online && <p>{t.offline}</p>}
          {notice && <p>{t[notice]}</p>}
          {online && ready && ready.id === dueOwner && view === "home" &&
            <div className="due-notice"><p>{t.reminderDue}</p><button className="button quiet" onClick={() => navigate("today")}>{t.seeToday}</button></div>}
        </div>
        {view === "home" && <>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              {today && <p className="hero-date"><Icon name="today" size={18} /><time dateTime={date?.toISOString()}>{today}</time></p>}
              <h1 id="hero-title" tabIndex={-1}>{t.pageTitle}</h1>
              <p>{t.welcome}</p>
              <div className="hero-actions">
                <button className="button primary" onClick={() => navigate("activities")}>{t.play}<Icon name="arrow" /></button>
                <button className="button voice" onClick={() => speak(speechText)}><Icon name="audio" />{speaking ? t.stop : t.read}</button>
              </div>
            </div>
            <div className="hero-picture">
              <picture>
                <source media="(max-width: 650px)" srcSet="/lakeside-small.webp" />
                <img src="/lakeside.webp" width={1200} height={800} alt="" fetchPriority="high" />
              </picture>
            </div>
          </section>
          <section className="home-activities" aria-labelledby="home-activities">
            <div className="section-heading">
              <h2 id="home-activities">{t.activities}</h2>
              <button className="button quiet today-link" onClick={() => navigate("today")}><Icon name="today" />{t.seeToday}<Icon name="arrow" size={18} /></button>
            </div>
            <ActivityList locale={locale} items={items} choose={choose} />
          </section>
        </>}
        {view === "activities" && <section className="workbench activities-view">
          <div className="screen-top"><div><h1 tabIndex={-1}>{t.activities}</h1><p className="view-intro">{t.welcome}</p></div>
            <button className="button voice" onClick={() => speak(speechText)}><Icon name="audio" />{speaking ? t.stop : t.read}</button></div>
          <ActivityList locale={locale} items={items} choose={choose} />
        </section>}
        {view === "game" && <Exercise key={roundNo} game={game} locale={locale} read={speak} finish={complete} back={() => navigate("activities")}
          startingLevel={ready?.levels[game] ?? localProgress[game]?.difficulty ?? 1} />}
        {view === "complete" && completed && <section className="workbench completion">
          <ActivityArt game={game} />
          <h1 tabIndex={-1}>{t.wellDone}</h1>
          <p className="view-intro">{t.giveTime}</p>
          <p><strong>{gameName}</strong> · {t.roundScore} {completed.round.correct} / {completed.round.attempts}</p>
          <p className="status" role="status">{saveState ? t[saveState] : ""}</p>
          {saveState === "saveAgain" && <button className="button quiet" onClick={() => save(completed.round, completed.key)}>{t.saveAgain}</button>}
          {saveState === "connect" && <button className="button quiet" onClick={() => navigate("account")}>{t.signIn}</button>}
          <div className="actions"><button className="button primary" onClick={() => choose(game)}>{t.again}</button>
            <button className="button quiet" onClick={() => navigate("activities")}>{t.viewActivities}</button>
            <button className="button quiet" onClick={() => navigate("home")}>{t.stopHere}</button></div>
        </section>}
        {view === "today" && <Reminders key={ready?.id ?? "guest"} locale={locale} ready={!!ready} online={online} signIn={() => navigate("account")} />}
        {view === "care" && <Care key={ready?.id ?? "guest"} locale={locale} current={ready} online={online} signIn={() => navigate("account")} />}
        {view === "account" && <Account account={account} locale={locale} online={online} refresh={refresh} signOut={signOut} offline={deviceQueue}
          toggleOffline={offlineToggle} close={() => navigate("home")} />}

        <footer className="footer">
          <span className="footer-brand">CogniCare</span>
          {preview && <span>{t.preview}</span>}
          <details><summary>{t.howToInstall}</summary><p>{t.installHelp}</p></details>
        </footer>
      </main>
    </>
  );
}

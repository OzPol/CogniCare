"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type AccountView, type Game, type Level, type Locale, type Round } from "@/shared/domain";
import { Account } from "./account";
import { copy, gameCopy } from "./copy";
import { ActivityArt, Exercise, type Score } from "./games";
import { api } from "./http";
import { Icon } from "./icons";

type View = "home" | "activities" | "account" | "game" | "complete";
type MainView = Extract<View, "home" | "activities" | "today" | "care">;
const navigation: { view: MainView; icon: string }[] = [
  { view: "home", icon: "home" },
  { view: "activities", icon: "games" },
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
  const [account, setAccount] = useState<AccountView | null>(null);
  const [notice, setNotice] = useState<keyof typeof copy.en | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [date, setDate] = useState<Date | null>(null);
  const [completed, setCompleted] = useState<{ round: Round } | null>(null);
  const main = useRef<HTMLElement>(null);
  const initialized = useRef(false);
  const owner = useRef<string | null>(null);
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
      } catch { }
      initialized.current = true;
      setOnline(navigator.onLine);
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

  async function signOut() {
    await api("/api/auth/sign-out", {});
    owner.current = null;
    setAccount(null);
    setCompleted(null);
    await refresh().catch(() => undefined);
    navigate("home");
    setNotice("signedOut");
  }

  function complete(score: Score, difficulty: Level) {
    const round: Round = { ...score, difficulty, game, playedAt: new Date().toISOString() };
    setCompleted({ round });
    navigate("complete");
  }

  const today = date && new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(date);
  const activeNav = view === "game" || view === "complete" ? "activities" : view;
  const gameName = gameCopy[locale][game].title;

  const speechText = view === "home" ? t.pageTitle + " " + t.welcome :
    view === "activities" ? t.activities + ". " + items.map((item) => gameCopy[locale][item].title).join(". ") :
    view === "game" ? gameCopy[locale][game].instructions :
    view === "complete" ? t.wellDone + " " + t.giveTime :
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
          startingLevel={1} />}
        {view === "complete" && completed && <section className="workbench completion">
          <ActivityArt game={game} />
          <h1 tabIndex={-1}>{t.wellDone}</h1>
          <p className="view-intro">{t.giveTime}</p>
          <p><strong>{gameName}</strong> · {t.roundScore} {completed.round.correct} / {completed.round.attempts}</p>
          <div className="actions"><button className="button primary" onClick={() => choose(game)}>{t.again}</button>
            <button className="button quiet" onClick={() => navigate("activities")}>{t.viewActivities}</button>
            <button className="button quiet" onClick={() => navigate("home")}>{t.stopHere}</button></div>
        </section>}
        {view === "account" && <Account account={account} locale={locale} online={online} refresh={refresh} signOut={signOut} close={() => navigate("home")} />}

        <footer className="footer">
          <span className="footer-brand">CogniCare</span>
          {preview && <span>{t.preview}</span>}
        </footer>
      </main>
    </>
  );
}

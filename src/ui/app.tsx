"use client";

import { useEffect, useRef, useState } from "react";
import { type Locale } from "@/shared/domain";
import { copy } from "./copy";
import { Icon } from "./icons";

type View = "home";
type MainView = Extract<View, "home" | "activities" | "today" | "care">;
const navigation: { view: MainView; icon: string }[] = [
  { view: "home", icon: "home" },
];
const voices = { en: "en-US", es: "es-US" };

export function App({ preview }: { preview: boolean }) {
  const [locale, setLocale] = useState<Locale>("en");
  const t = copy[locale];
  const [larger, setLarger] = useState(false);
  const [view, setView] = useState<View>("home");
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<keyof typeof copy.en | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [date, setDate] = useState<Date | null>(null);
  const main = useRef<HTMLElement>(null);
  const initialized = useRef(false);

  function navigate(destination: View) {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setNotice(null);
    setView(destination);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => main.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    const init = window.setTimeout(() => {
      setDate(new Date());
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

  const today = date && new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(date);
  const activeNav = view;

  const speechText = t.pageTitle + " " + t.welcome;

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
        </>}
        <footer className="footer">
          <span className="footer-brand">CogniCare</span>
          {preview && <span>{t.preview}</span>}
        </footer>
      </main>
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Game, Level, Locale } from "@/shared/domain";
import { copy, gameCopy } from "./copy";

const symbols = ["leaf", "cup", "moon", "sun", "kite", "acorn", "bell", "star"] as const;
type Symbol = typeof symbols[number];
const names: Record<Locale, Record<Symbol, string>> = {
  en: { leaf: "Leaf", cup: "Cup", moon: "Moon", sun: "Sun", kite: "Kite", acorn: "Acorn", bell: "Bell", star: "Star" },
  es: { leaf: "Hoja", cup: "Taza", moon: "Luna", sun: "Sol", kite: "Cometa", acorn: "Bellota", bell: "Campana", star: "Estrella" },
};

export function Mark({ symbol }: { symbol: Symbol }) {
  return <span className={"mark mark-" + symbol} aria-hidden="true" />;
}

const artwork: Record<Game, Symbol[]> = {
  MATCH: ["leaf", "leaf"], FOCUS: ["sun", "moon", "sun"], ROUTINE: ["cup", "leaf"], PATTERN: ["kite", "acorn", "kite"],
};
export function ActivityArt({ game }: { game: Game }) {
  return (
    <span className={"activity-art art-" + game.toLowerCase()} aria-hidden="true">
      {artwork[game].map((symbol, index) => <span className="art-tile" key={index}><Mark symbol={symbol} /></span>)}
      {game === "PATTERN" && <span className="art-missing">?</span>}
      {game === "ROUTINE" && <span className="art-line" />}
    </span>
  );
}

function shuffle<T>(items: readonly T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [next[index], next[other]] = [next[other], next[index]];
  }
  return next;
}

export type Score = { correct: number; attempts: number };
type PlayProps = { level: Level; locale: Locale; finish: (score: Score) => void };

function Memory({ level, locale, finish }: PlayProps) {
  const t = copy[locale];
  const pairs = 2 + level;
  const [deck] = useState(() => shuffle(shuffle(symbols).slice(0, pairs).flatMap((symbol) => [symbol, symbol])));
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<Symbol[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [preview, setPreview] = useState(false);
  const [note, setNote] = useState("");
  const held = useRef<HTMLButtonElement | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function flip(index: number) {
    if (preview || open.length >= 2 || open.includes(index) || matched.includes(deck[index])) return;
    if (open.length === 0) {
      setOpen([index]);
      setNote("");
      return;
    }
    const total = attempts + 1;
    setAttempts(total);
    if (deck[open[0]] === deck[index]) {
      const found = [...matched, deck[index]];
      setMatched(found);
      setOpen([]);
      setNote(t.pair);
      if (found.length === pairs || total === 120) finish({ correct: found.length, attempts: total });
    } else if (total === 120) {
      finish({ correct: matched.length, attempts: total });
    } else {
      setOpen([open[0], index]);
      setNote(t.anotherPair);
      requestAnimationFrame(() => held.current?.focus());
    }
  }

  return (
    <>
      <div className="game-tools">
        <p className="counter">{matched.length} / {pairs} {locale === "en" ? "pairs" : "pares"}</p>
        <button className="button quiet" disabled={open.length > 0} onClick={() => setPreview(!preview)}>{preview ? t.hide : t.hint}</button>
      </div>
      <div className="memory-board">
        {deck.map((symbol, index) => {
          const found = matched.includes(symbol);
          const visible = preview || found || open.includes(index);
          return (
            <button
              key={index}
              ref={(node) => { buttons.current[index] = node; }}
              className={"memory-card" + (visible ? " face-up" : "") + (found ? " matched" : "")}
              aria-label={t.card + " " + (index + 1) + ", " + (visible ? names[locale][symbol] : t.hidden)}
              aria-disabled={found || preview || open.includes(index) || open.length >= 2}
              onClick={() => flip(index)}
            >
              {visible ? <><Mark symbol={symbol} /><span>{names[locale][symbol]}</span></> : <span aria-hidden="true" className="card-back">?</span>}
            </button>
          );
        })}
      </div>
      <div className="feedback">
        <p role="status">{note}</p>
        {open.length === 2 && <button ref={held} className="button primary" onClick={() => {
          const index = open[0];
          setOpen([]);
          setNote("");
          requestAnimationFrame(() => buttons.current[index]?.focus());
        }}>{t.turnBack}</button>}
      </div>
    </>
  );
}

export function Exercise({
  game, locale, startingLevel, finish, back, read,
}: { game: Game; locale: Locale; startingLevel: Level; finish: (score: Score, level: Level) => void;
  back: () => void; read: (text: string) => void }) {
  const t = copy[locale];
  const text = gameCopy[locale][game];
  const [level, setLevel] = useState(startingLevel);
  const [started, setStarted] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => { if (started) title.current?.focus(); }, [started]);

  return (
    <section className="workbench" aria-labelledby="exercise-title">
      <button className="button quiet back-button" onClick={back}><span aria-hidden="true">←</span> {t.back}</button>
      <h1 id="exercise-title" ref={title} tabIndex={-1}>{text.title}</h1>
      <p className="view-intro">{text.instructions}</p>
      {!started ? (
        <div className="exercise-setup">
          <ActivityArt game={game} />
          <div className="setup-controls">
            <label htmlFor="game-level">{t.chooseLevel}</label>
            <select id="game-level" value={level} onChange={(event) => setLevel(Number(event.target.value) as Level)}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? "1 · " + t.easier : String(n)}</option>)}
            </select>
            <button className="button primary" onClick={() => setStarted(true)}>{t.ready}<span aria-hidden="true"> →</span></button>
            <button className="button quiet" onClick={() => read(text.instructions)}>{t.read}</button>
          </div>
        </div>
      ) : (
        <Memory level={level} locale={locale} finish={(score) => finish(score, level)} />
      )}
    </section>
  );
}

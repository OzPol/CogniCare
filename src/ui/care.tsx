"use client";

import { useCallback, useEffect, useState } from "react";
import { type AccountView, type CareSummary, type Locale, type Person } from "@/shared/domain";
import { errorCopy } from "./account";
import { copy, gameCopy } from "./copy";
import { api } from "./http";

type Ready = Extract<AccountView, { state: "ready" }>;

export function Care({ locale, current, online, signIn }: {
  locale: Locale; current: Ready | null; online: boolean; signIn: () => void;
}) {
  const t = copy[locale];
  const [people, setPeople] = useState<Person[]>([]);
  const [invite, setInvite] = useState("");
  const [invalidate, setInvalidate] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [summary, setSummary] = useState<CareSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const isPlayer = current?.role === "PLAYER";

  const loadPeople = useCallback(async (signal?: AbortSignal) => {
    const result = await api<{ people: Person[] }>("/api/care", undefined, signal);
    setPeople(result.people);
  }, []);
  const loadSummary = useCallback(async (id: string, signal?: AbortSignal) => {
    const result = await api<CareSummary>("/api/care?patient=" + encodeURIComponent(id), undefined, signal);
    setSummary(result);
  }, []);

  useEffect(() => {
    if (!current || !online) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadPeople(controller.signal)).catch((error) => {
      if (!controller.signal.aborted) setNote(errorCopy(locale, error));
    });
    return () => controller.abort();
  }, [current, online, isPlayer, locale, loadPeople]);

  useEffect(() => {
    if (!person || !online || !current || isPlayer) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadSummary(person, controller.signal)).catch((error) => {
      if (!controller.signal.aborted) setNote(errorCopy(locale, error));
    });
    return () => controller.abort();
  }, [person, current, isPlayer, locale, online, loadSummary]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setNote(t.loading);
    try { await work(); setNote(""); }
    catch (error) { setNote(errorCopy(locale, error)); }
    finally { setBusy(false); }
  }

  return (
    <section className="workbench" aria-labelledby="care-title">
      <h1 id="care-title" tabIndex={-1}>{t.careTitle}</h1>
      <p className="view-intro">{isPlayer ? t.careIntro : t.careMemberIntro}</p>
      {!current ? <div className="subpanel"><p>{t.careLogin}</p><button className="button primary" onClick={signIn}>{t.signIn}</button></div>
        : !online ? <p>{t.offline}</p>
        : isPlayer ? (
          <div className="subpanel">
            <button className="button primary" disabled={busy} onClick={() => run(async () => {
              setInvite((await api<{ code: string }>("/api/care/invite", {})).code);
            })}>{t.makeInvite}</button>
            {invite && <div className="invite"><p>{t.inviteHelp}</p><label htmlFor="sharing-code">{t.inviteCode}</label>
              <input id="sharing-code" readOnly value={invite} onFocus={(event) => event.target.select()} />
              <button className="button quiet" onClick={async () => {
                try { await navigator.clipboard.writeText(invite); setNote(t.copied); }
                catch (error) { setNote(errorCopy(locale, error)); }
              }}>{t.copy}</button></div>}
            {people.length ? <ul className="care-people">{people.map(({ id, name }) => <li key={id}>
              <strong>{name}</strong>
              {invalidate === id ? <div className="actions">
                <button className="button quiet" disabled={busy} onClick={() => run(async () => {
                  await api("/api/care/revoke", { data: { caregiver: id } });
                  setInvalidate(null); setInvite(""); await loadPeople();
                })}>{t.revoke}</button>
                <button className="button quiet" onClick={() => setInvalidate(null)}>{t.cancel}</button>
              </div> : <button className="button quiet" onClick={() => setInvalidate(id)}>{t.revoke}</button>}
            </li>)}</ul> : <p>{t.noCare}</p>}
          </div>
        ) : <>
          <div className="subpanel">
            <form className="inline-form" onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const code = new FormData(form).get("invitation");
              run(async () => {
                await api("/api/care/accept", { data: { code } });
                form.reset(); await loadPeople();
              });
            }}>
              <div><label htmlFor="accept-code">{t.inviteCode}</label>
                <input id="accept-code" name="invitation" minLength={24} maxLength={24} required spellCheck={false} autoCapitalize="none" /></div>
              <button disabled={busy} className="button primary">{t.join}</button>
            </form>
            {people.length ? <div className="inline-form">
              <div><label htmlFor="linked-person">{t.selectPerson}</label><select id="linked-person" value={person} onChange={(event) => {
                setSummary(null); setPerson(event.target.value);
              }}>
                <option value="">{t.selectPerson}</option>{people.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select></div>
              {person && <button className="button quiet" onClick={() => run(async () => {
                setSummary(null); await loadSummary(person);
              })}>{t.refreshing}</button>}
            </div> : <p>{t.noPeople}</p>}
          </div>
          {summary && person && <section className="subpanel dashboard" aria-label={t.activityBreakdown}>
            <div className="stats">
              <div><span>{t.rounds}</span><strong>{summary.rounds}</strong></div>
              <div><span>{t.lastPlayed}</span><strong>{summary.lastPlayedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(summary.lastPlayedAt)) : "—"}</strong></div>
              <div><span>{t.overdue}</span><strong>{summary.overdueCount}</strong></div>
            </div>
            <div className="dashboard-columns">
              <div><h2>{t.recentDays}</h2>
                <ul className="daily-list">{summary.days.map(({ day, rounds }) => <li key={day}><time dateTime={day}>
                  {new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(day))}
                </time><strong>{rounds}</strong></li>)}</ul>
              </div>
              <div><h2>{t.activityBreakdown}</h2>
                {summary.activities.length ? <ul className="daily-list">{summary.activities.map(({ game, rounds, correct, attempts }) =>
                  <li key={game}><span>{gameCopy[locale][game].title}<small className="care-accuracy">{t.roundScore} {correct} / {attempts}</small></span><strong>{rounds}</strong></li>)}</ul> : <p>{t.noRounds}</p>}
              </div>
            </div>
            <h2>{t.overdue}</h2>
            {summary.overdue.length ? <ul className="daily-list">{summary.overdue.map((item) =>
              <li key={item.id}><span>{item.title}</span><time dateTime={item.dueAt}>
                {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(item.dueAt))}
              </time></li>)}</ul> : <p>{t.noAlerts}</p>}
          </section>}
        </>}
      <p className="status" role="status">{note}</p>
    </section>
  );
}

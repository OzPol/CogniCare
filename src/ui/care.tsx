"use client";

import { useCallback, useEffect, useState } from "react";
import { practiceInput, type AccountView, type CareSummary, type Game, type Locale, type Person, type PracticeView } from "@/shared/domain";
import { errorCopy } from "./account";
import { copy, gameCopy } from "./copy";
import { api } from "./http";

type Ready = Extract<AccountView, { state: "ready" }>;

export function Care({ locale, current, online, signIn, chooseGame }: {
  locale: Locale; current: Ready | null; online: boolean; signIn: () => void; chooseGame: (game: Game) => void;
}) {
  const t = copy[locale];
  const [people, setPeople] = useState<Person[]>([]);
  const [invite, setInvite] = useState("");
  const [invalidate, setInvalidate] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [summary, setSummary] = useState<CareSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [allowPlans, setAllowPlans] = useState(false);
  const [jobId, setJobId] = useState("");
  const [plan, setPlan] = useState<PracticeView | null>(null);
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
    if (!isPlayer) api<{ enabled: boolean }>("/api/practice", undefined, controller.signal)
      .then(({ enabled }) => setAllowPlans(enabled)).catch(() => undefined);
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

  useEffect(() => {
    if (!jobId || !online || !current || isPlayer) return;
    const events = new EventSource("/api/practice/" + jobId + "?stream=1");
    events.addEventListener("plan", (event: MessageEvent<string>) => {
      const frame = JSON.parse(event.data) as PracticeView;
      setPlan(frame);
      setNote("");
      if (frame.state === "DONE" || frame.state === "FAILED") events.close();
    });
    events.onerror = () => { events.close(); setNote(t.planLater); };
    return () => events.close();
  }, [jobId, online, current, isPlayer, t.planLater]);

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
          {allowPlans && <div className="subpanel">
            <h2>{t.plan}</h2><p>{t.planHelp}</p>
            <form className="inline-form" onSubmit={(event) => {
              event.preventDefault();
              const input = new FormData(event.currentTarget).get("template");
              run(async () => {
                const result = await api<{ id: string }>("/api/practice", { data: { template: input } });
                setPlan(null); setJobId(result.id);
              });
            }}>
              <div><label htmlFor="plan-template">{locale === "en" ? "Style" : "Estilo"}</label>
                <select id="plan-template" name="template">
                  {practiceInput.shape.template.options.map((value) => <option key={value} value={value}>{t[value]}</option>)}
                </select></div>
              <button disabled={busy} className="button primary">{t.plan}</button>
            </form>
            {jobId && plan?.state !== "DONE" && plan?.state !== "FAILED" && <div className="actions">
              <span role="status">{t.planLoading}</span><button className="button quiet" onClick={() => run(async () => {
                setPlan(await api<PracticeView>("/api/practice/" + jobId));
              })}>{t.refreshing}</button></div>}
            {plan?.state === "FAILED" && <p role="status">{t.noPractice}</p>}
            {plan?.result && <div><h3>{t.planFinished}</h3><div className="actions">{plan.result.games.map((game) =>
              <button key={game} className="button quiet" onClick={() => chooseGame(game)}>{gameCopy[locale][game].title}</button>)}</div></div>}
          </div>}
        </>}
      <p className="status" role="status">{note}</p>
    </section>
  );
}

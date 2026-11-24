"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reminderKinds, type Locale, type ReminderView } from "@/shared/domain";
import { errorCopy } from "./account";
import { copy, kindCopy } from "./copy";
import { api, RequestError } from "./http";
import { Icon } from "./icons";

type Page = { items: ReminderView[]; next: string | null };
const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const format = (locale: Locale, value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const icon = { WATER: "water", MEDICINE: "med", ACTIVITY: "activity", APPOINTMENT: "today" };

export function Reminders({ locale, ready, online, signIn }: { locale: Locale; ready: boolean; online: boolean; signIn: () => void }) {
  const t = copy[locale];
  const [page, setPage] = useState<Page>({ items: [], next: null });
  const [form, setForm] = useState<ReminderView | "new" | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [newDue, setNewDue] = useState("");
  const retry = useRef<{ identity: string; key: string } | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 30_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);

  const load = useCallback(async (signal?: AbortSignal, cursor?: string) => {
    const result = await api<Page>("/api/reminders" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), undefined, signal);
    setPage((current) => cursor ? { next: result.next, items: [...current.items, ...result.items] } : result);
  }, []);

  useEffect(() => {
    if (!ready || !online) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal)).catch((error) => { if (!controller.signal.aborted) setNote(errorCopy(locale, error)); });
    return () => controller.abort();
  }, [ready, online, locale, load]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setNote(t.saving);
    try {
      await task();
      setNote(t.saved);
    } catch (error) {
      if (error instanceof RequestError && error.code === "stale_version") {
        setForm(null);
        setRemove(null);
        await load().catch(() => undefined);
      }
      setNote(errorCopy(locale, error));
    } finally {
      setBusy(false);
    }
  }

  async function send(path: string, method: "POST" | "PATCH", data: object) {
    const identity = path + ":" + method + ":" + JSON.stringify(data);
    if (retry.current?.identity !== identity) retry.current = { identity, key: crypto.randomUUID() };
    try {
      const result = await api<ReminderView>(path, { method, data, key: retry.current.key });
      retry.current = null;
      return result;
    } catch (error) {
      if (error instanceof RequestError && error.status < 500 && error.status !== 429) retry.current = null;
      throw error;
    }
  }

  function change(item: ReminderView, action: "done" | "reopen" | "remove") {
    return run(async () => {
      const prior = page;
      const next = action === "remove" ? page.items.filter((row) => row.id !== item.id) : page.items.map((row) =>
        row.id === item.id ? { ...row, doneAt: action === "done" ? new Date().toISOString() : null } : row);
      setPage({ ...page, items: next });
      try {
        const saved = await send("/api/reminders/" + item.id, "PATCH", { version: item.version, action });
        if (action !== "remove") setPage((current) => ({ ...current, items: current.items.map((row) => row.id === saved.id ? saved : row) }));
        setRemove(null);
      } catch (error) {
        setPage(prior);
        throw error;
      }
      await load().catch(() => undefined);
    });
  }

  const examples = locale === "en" ? ["Drink a glass of water", "Take an afternoon walk"] : ["Beber un vaso de agua", "Dar un paseo por la tarde"];
  const items = ready && online ? page.items : [];
  const groups = [
    { label: t.overdue, rows: items.filter((item) => !item.doneAt && new Date(item.dueAt).getTime() <= now), alert: true },
    { label: t.upcoming, rows: items.filter((item) => !item.doneAt && new Date(item.dueAt).getTime() > now), alert: false },
    { label: t.finished, rows: items.filter((item) => !!item.doneAt), alert: false },
  ];

  return (
    <section className="workbench" aria-labelledby="today-title">
      <div className="screen-top"><div><h1 id="today-title" tabIndex={-1}>{t.todayTitle}</h1><p className="view-intro">{t.todayIntro}</p></div>
        {ready && online && !form && <button className="button primary" onClick={() => { setNewDue(localDate(new Date(Date.now() + 30 * 60_000))); setForm("new"); }}>+ {t.newReminder}</button>}
      </div>
      {!ready ? (
        <div className="subpanel">
          <p>{t.reminderLogin}</p><button className="button primary" onClick={signIn}>{t.signIn}</button>
          <h2>{t.demoReminders}</h2>
          <ul className="reminder-list">{examples.map((text, index) => <li className="reminder-row" key={text}>
            <span className="reminder-icon"><Icon name={index ? "activity" : "water"} /></span><strong>{text}</strong>
          </li>)}</ul>
        </div>
      ) : !online ? <p>{t.offline}</p> : <>
        {form && <form key={form === "new" ? "new" : form.id} className="subpanel stacked-form" onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const when = new Date(String(formData.get("due")));
          if (!Number.isFinite(when.getTime())) { setNote(t.invalidInput); return; }
          const data = { title: formData.get("title"), kind: formData.get("kind"), dueAt: when.toISOString() };
          run(async () => {
            if (form === "new") await send("/api/reminders", "POST", data);
            else await send("/api/reminders/" + form.id, "PATCH", { ...data, action: "edit", version: form.version });
            setForm(null);
            await load().catch(() => undefined);
          });
        }}>
          <h2>{form === "new" ? t.newReminder : t.edit}</h2>
          <label htmlFor="reminder-title">{t.name}</label>
          <input id="reminder-title" name="title" required maxLength={80} defaultValue={form === "new" ? "" : form.title} />
          <label htmlFor="reminder-type">{t.reminderType}</label>
          <select id="reminder-type" name="kind" defaultValue={form === "new" ? "ACTIVITY" : form.kind}>
            {reminderKinds.map((kind) => <option key={kind} value={kind}>{kindCopy[locale][kind]}</option>)}
          </select>
          <label htmlFor="reminder-due">{t.time}</label>
          <input type="datetime-local" id="reminder-due" name="due" required
            defaultValue={form === "new" ? newDue : localDate(new Date(form.dueAt))} />
          <div className="actions">
            <button className="button primary" disabled={busy}>{form === "new" ? t.saveReminder : t.updateReminder}</button>
            <button type="button" className="button quiet" onClick={() => setForm(null)}>{t.cancel}</button>
          </div>
        </form>}
        {items.length === 0 && !form && <p>{t.noReminders}</p>}
        {groups.map(({ label, rows, alert }) => rows.length > 0 && <section key={label} className="reminder-group">
          <h2>{label}</h2>
          <ul className="reminder-list">{rows.map((item) => (
            <li key={item.id} className={"reminder-row" + (alert ? " is-due" : "")}>
              <span className={"reminder-icon " + item.kind.toLowerCase()}><Icon name={icon[item.kind]} /></span>
              <div className="reminder-text"><strong>{item.title}</strong><p>{kindCopy[locale][item.kind]} · <time dateTime={item.dueAt}>{format(locale, item.dueAt)}</time></p></div>
              <div className="actions">
                {remove === item.id ? <>
                  <p>{t.confirmRemove}</p>
                  <button className="button quiet" disabled={busy} onClick={() => change(item, "remove")}>{t.remove}</button>
                  <button className="button quiet" onClick={() => setRemove(null)}>{t.cancel}</button>
                </> : <>
                  <button className="button quiet" disabled={busy} onClick={() => change(item, item.doneAt ? "reopen" : "done")}>{item.doneAt ? t.undo : t.done}</button>
                  <button className="button quiet" disabled={busy} onClick={() => setForm(item)}>{t.edit}</button>
                  <button className="button quiet" disabled={busy} onClick={() => setRemove(item.id)}>{t.remove}</button>
                </>}
              </div>
            </li>
          ))}</ul>
        </section>)}
        {page.next && <button className="button quiet" disabled={busy} onClick={() => run(() => load(undefined, page.next ?? undefined))}>{t.more}</button>}
      </>}
      <p className="status" role="status">{note}</p>
    </section>
  );
}

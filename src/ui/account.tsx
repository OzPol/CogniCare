"use client";

import { useRef, useState } from "react";
import type { AccountView, Locale, OAuthProvider } from "@/shared/domain";
import { copy } from "./copy";
import { api, RequestError } from "./http";

type State = AccountView | null;
type FactorSetup = { key: string; qr: string };
const providerLabel: Record<OAuthProvider, string> = { google: "Google", microsoft: "Microsoft", github: "GitHub" };
const errors: Record<string, keyof typeof copy.en> = {
  invalid_code: "badCode", setup_expired: "mfaExpired", slow_down: "busy", temporarily_unavailable: "accountUnavailable",
  invalid_input: "invalidInput", INVALID_EMAIL_OR_PASSWORD: "badLogin", invalid_email_or_password: "badLogin",
  already_enrolled: "error", setup_in_progress: "busy", accounts_disabled: "demo",
  stale_version: "conflict", invite_unavailable: "inviteInvalid",
};

export function errorCopy(locale: Locale, error: unknown) {
  const t = copy[locale];
  if (error instanceof RequestError) return t[errors[error.code] ?? "error"];
  return error instanceof TypeError ? t.network : t.error;
}

export function Account({
  account, locale, online, refresh, signOut, close,
}: {
  account: State; locale: Locale; online: boolean;
  refresh: () => Promise<unknown>; signOut: () => Promise<void>; close: () => void;
}) {
  const t = copy[locale];
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<FactorSetup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const recoveryHeading = useRef<HTMLHeadingElement>(null);

  async function run(task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setStatus(t.loading);
    try {
      await task();
      setStatus("");
    } catch (error) {
      setStatus(errorCopy(locale, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workbench settings" aria-labelledby="account-title">
      <button className="button quiet back-button" onClick={close}><span aria-hidden="true">←</span> {t.home}</button>
      <h1 id="account-title" tabIndex={-1}>{codes.length ? t.recovery : t.myAccount}</h1>
      {codes.length > 0 ? (
        <div className="subpanel">
          <h2 ref={recoveryHeading} tabIndex={-1} className="sr-only">{t.recovery}</h2>
          <p>{t.recoveryHelp}</p>
          <ul className="recovery-list">{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          <button className="button primary" onClick={() => { setCodes([]); close(); }}>{t.recoveryDone}</button>
        </div>
      ) : !account ? <p>{online ? t.accountUnavailable : t.offline}</p>
        : account.state === "ready" ? (
          <div className="subpanel">
            <button className="button primary" disabled={busy || !online} onClick={() => run(signOut)}>{t.signOut}</button>
          </div>
        ) : account.state === "enroll" || account.state === "verify" ? (
          <div className="subpanel">
            <h2>{account.state === "enroll" ? t.factorEnroll : t.factorTitle}</h2>
            {account.state === "enroll" && !setup && <button className="button primary" disabled={busy || !online} onClick={() => run(async () => {
              setSetup(await api<FactorSetup>("/api/factor/enroll", {}));
            })}>{t.showSetup}</button>}
            {setup && <>
              <p>{t.factorHelp}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="" width={200} height={200} />
              <p>{t.setupKey} <code className="selectable">{setup.key}</code></p>
              <button className="button quiet" onClick={() => run(async () => {
                await navigator.clipboard.writeText(setup.key);
              })}>{t.copy}</button>
            </>}
            {account.state === "verify" && <p>{t.verifyHelp}</p>}
            {(setup || account.state === "verify") && (
              <form className="stacked-form" onSubmit={(event) => {
                event.preventDefault();
                const code = String(new FormData(event.currentTarget).get("code"));
                run(async () => {
                  try {
                    const result = await api<{ recovery: string[] }>("/api/factor/verify", { data: { code } });
                    setSetup(null);
                    setCodes(result.recovery);
                    await refresh();
                    if (result.recovery.length) requestAnimationFrame(() => recoveryHeading.current?.focus());
                    else close();
                  } catch (error) {
                    if (error instanceof RequestError && error.code === "setup_expired") setSetup(null);
                    throw error;
                  }
                });
              }}>
                <label htmlFor="auth-code">{t.otp}</label>
                <input required id="auth-code" name="code" maxLength={24} autoComplete="one-time-code"
                  inputMode={setup ? "numeric" : "text"} spellCheck={false} autoCapitalize="none" />
                <button className="button primary" disabled={busy || !online}>{t.verify}</button>
              </form>
            )}
            <button className="button quiet" disabled={busy || !online} onClick={() => run(signOut)}>{t.signOut}</button>
          </div>
        ) : account.state === "disabled" ? <><p>{t.demo}</p><button className="button primary" onClick={close}>{t.home}</button></>
          : account.state === "signed-out" && (
            <div className="subpanel">
              <p>{t.accountIntro} {t.guest}</p>
              {account.providers.map((provider) => <button key={provider} className="button primary" disabled={busy || !online}
                onClick={() => run(async () => {
                  const result = await api<{ url: string }>("/api/auth/sign-in/social", { data: { provider } });
                  window.location.assign(result.url);
                })}>{t.signIn} · {providerLabel[provider]}</button>)}
              {account.localLogin && <form className="stacked-form" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(async () => {
                  await api("/api/auth/sign-in/email", { data: { email: form.get("email"), password: form.get("password") } });
                  await refresh();
                });
              }}>
                <h2>{t.local}</h2>
                <label htmlFor="login-email">{t.email}</label>
                <input id="login-email" name="email" type="email" required autoComplete="email" maxLength={254} />
                <label htmlFor="login-password">{t.password}</label>
                <input id="login-password" name="password" type="password" required autoComplete="current-password" maxLength={128} />
                <button className="button primary" disabled={busy || !online}>{t.signIn}</button>
              </form>}
              {account.providers.length === 0 && !account.localLogin && <p>{t.accountUnavailable}</p>}
            </div>
          )}
      <p className="status" role="status">{status}</p>
    </section>
  );
}

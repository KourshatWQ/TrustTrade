import { ArrowRight, Bot, Fingerprint, Landmark, ListPlus, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";

const STEPS = [
  { icon: ListPlus, title: "List or request", body: "Sellers list an item, buyers describe what they want. Each sets a private price limit." },
  { icon: Bot, title: "Agents negotiate", body: "AI agents find the best match and haggle in the open. Code keeps them inside your limit." },
  { icon: Fingerprint, title: "Approve with passkey", body: "Funds move only after you approve with Face ID, Touch ID or Windows Hello." },
];

const TRUST = [
  { icon: Fingerprint, title: "Biometric approval", body: "Every payment step needs your passkey, verified by the smart contract." },
  { icon: Landmark, title: "Escrow on NEAR", body: "Money sits in escrow until the item changes hands." },
  { icon: LockKeyhole, title: "Private AI limits", body: "Your limits stay in a secure enclave, never shared with the other side." },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-16 sm:gap-20">
      <section className="flex flex-col items-start gap-6 pt-4 sm:pt-10">
        <span className="badge badge-blue">
          <ShieldCheck size={14} aria-hidden /> Second-hand marketplace on NEAR
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-fg sm:text-5xl">Let AI agents negotiate. You just approve.</h1>
        <p className="max-w-2xl text-lg text-muted">
          Your agent finds the right item and gets you a fair price. Nothing is paid until you approve with your passkey.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/market" className="btn btn-lg">
            Browse marketplace <ArrowRight size={18} aria-hidden />
          </Link>
          <Link href="/find" className="btn-ghost btn-lg">
            Create a request
          </Link>
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card flex flex-col gap-3 p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-[8px] bg-accent-soft text-accent">
                  <s.icon size={20} aria-hidden />
                </span>
                <span className="text-xs font-medium text-muted">Step {i + 1}</span>
              </div>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="trust" className="rounded-[12px] border border-line bg-panel p-6 sm:p-8">
        <h2 id="trust" className="sr-only">Why it is safe</h2>
        <ul className="grid gap-6 md:grid-cols-3">
          {TRUST.map((t) => (
            <li key={t.title} className="flex gap-4">
              <t.icon size={22} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <div>
                <h3 className="font-semibold">{t.title}</h3>
                <p className="mt-1 text-sm text-muted">{t.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

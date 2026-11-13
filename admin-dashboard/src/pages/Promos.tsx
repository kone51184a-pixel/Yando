import { FormEvent, useState } from "react";
import { collection, doc, getDoc, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { dateTime, errorMessage, fcfa, toDate } from "../format";
import { useQuery } from "../hooks";

interface Promo {
  type: "percent" | "fixed";
  value: number;
  maxUses: number | null;
  uses: number;
  active: boolean;
  expiresAt: Timestamp | null;
  createdAt?: unknown;
}

export default function Promos() {
  const { data: promos, error } = useQuery<Promo>(() => collection(db, "promoCodes"), []);
  const [form, setForm] = useState({ code: "", type: "percent" as Promo["type"], value: 20, maxUses: 100, expires: "" });
  const [message, setMessage] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const code = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return setMessage("Code : 3 à 20 caractères, lettres et chiffres.");
    if (form.type === "percent" && (form.value <= 0 || form.value > 100)) return setMessage("Pourcentage entre 1 et 100.");
    try {
      if ((await getDoc(doc(db, "promoCodes", code))).exists()) return setMessage("Ce code existe déjà.");
      await setDoc(doc(db, "promoCodes", code), {
        type: form.type,
        value: form.value,
        maxUses: form.maxUses > 0 ? form.maxUses : null,
        uses: 0,
        active: true,
        expiresAt: form.expires ? Timestamp.fromDate(new Date(form.expires + "T23:59:59")) : null,
        createdAt: Timestamp.now(),
      });
      setForm({ ...form, code: "" });
      setMessage(`Code ${code} créé.`);
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  const sorted = [...promos].sort((a, b) => Number(b.active) - Number(a.active) || a.id.localeCompare(b.id));

  return (
    <>
      <h1>Codes promo</h1>
      {error && <p className="error">{error}</p>}

      <form className="card" onSubmit={create}>
        <h2>Nouveau code</h2>
        <div className="form-row">
          <label>
            Code
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BIENVENUE" required />
          </label>
          <label>
            Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Promo["type"] })}>
              <option value="percent">Pourcentage</option>
              <option value="fixed">Montant fixe (FCFA)</option>
            </select>
          </label>
          <label>
            {form.type === "percent" ? "Réduction (%)" : "Réduction (FCFA)"}
            <input
              type="number"
              min={1}
              step={form.type === "percent" ? 1 : 25}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
            />
          </label>
          <label>
            Utilisations max (0 = illimité)
            <input type="number" min={0} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })} />
          </label>
          <label>
            Date de fin
            <input type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
          </label>
          <button className="primary">Créer</button>
        </div>
        <p className="muted small">Chaque passager ne peut utiliser un code qu'une seule fois.</p>
        {message && <p className="notice">{message}</p>}
      </form>

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Réduction</th>
              <th>Utilisations</th>
              <th>Fin</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const expired = !!p.expiresAt && (toDate(p.expiresAt)?.getTime() ?? 0) < Date.now();
              const exhausted = p.maxUses != null && p.uses >= p.maxUses;
              const state = !p.active ? "Désactivé" : expired ? "Expiré" : exhausted ? "Épuisé" : "Actif";
              return (
                <tr key={p.id}>
                  <td>
                    <code>{p.id}</code>
                  </td>
                  <td>{p.type === "percent" ? `${p.value} %` : fcfa(p.value)}</td>
                  <td>
                    {p.uses ?? 0}
                    {p.maxUses != null && ` / ${p.maxUses}`}
                  </td>
                  <td>{p.expiresAt ? dateTime(p.expiresAt) : "Aucune"}</td>
                  <td>
                    <span className={`tag ${state === "Actif" ? "ok" : ""}`}>{state}</span>
                  </td>
                  <td>
                    <button className="link" onClick={() => updateDoc(doc(db, "promoCodes", p.id), { active: !p.active })}>
                      {p.active ? "Désactiver" : "Réactiver"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {promos.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Aucun code promo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

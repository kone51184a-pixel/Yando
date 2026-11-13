import { FormEvent, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { errorMessage, fcfa, VEHICLE_CLASSES, VEHICLE_LABELS } from "../format";

interface PricingConfig {
  base: number;
  perKm: number;
  perMinute: number;
  minimum: number;
}
interface AppConfig {
  surge: number;
  commissionRate: number;
  freeCancelSeconds: number;
  cancelFee: number;
  offerTimeoutSeconds: number;
  searchRadiusKm: number;
  maxOffers: number;
}

const EMPTY: PricingConfig = { base: 0, perKm: 0, perMinute: 0, minimum: 0 };
const DEFAULT_CONFIG: AppConfig = {
  surge: 1,
  commissionRate: 0.15,
  freeCancelSeconds: 120,
  cancelFee: 500,
  offerTimeoutSeconds: 15,
  searchRadiusKm: 5,
  maxOffers: 5,
};

/** Même formule que le serveur, pour l'aperçu. */
function preview(p: PricingConfig, km: number, min: number, surge: number) {
  const raw = (p.base + km * p.perKm + min * p.perMinute) * surge;
  return Math.round(Math.max(p.minimum, raw) / 25) * 25;
}

export default function Pricing() {
  const [pricing, setPricing] = useState<Record<string, PricingConfig>>({});
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([...VEHICLE_CLASSES.map((c) => getDoc(doc(db, "pricing", c))), getDoc(doc(db, "config", "app"))]).then(
      (snaps) => {
        const p: Record<string, PricingConfig> = {};
        VEHICLE_CLASSES.forEach((c, i) => (p[c] = (snaps[i].data() as PricingConfig) ?? EMPTY));
        setPricing(p);
        setConfig({ ...DEFAULT_CONFIG, ...(snaps[3].data() as Partial<AppConfig>) });
        setLoading(false);
      },
    );
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (config.surge < 1 || config.surge > 2.5) return setMessage("La majoration doit être entre 1,0 et 2,5.");
    try {
      await Promise.all([
        ...VEHICLE_CLASSES.map((c) => setDoc(doc(db, "pricing", c), pricing[c])),
        setDoc(doc(db, "config", "app"), config),
      ]);
      setMessage("Enregistré. Les nouvelles commandes utilisent ces tarifs.");
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  const setP = (c: string, k: keyof PricingConfig, v: string) =>
    setPricing((p) => ({ ...p, [c]: { ...p[c], [k]: Math.max(0, Math.round(Number(v) || 0)) } }));
  const setC = (k: keyof AppConfig, v: number) => setConfig((c) => ({ ...c, [k]: v }));

  if (loading) return <p className="muted">Chargement…</p>;

  return (
    <form onSubmit={save}>
      <div className="row-between">
        <h1>Tarifs</h1>
        <button className="primary">Enregistrer</button>
      </div>
      {message && <p className="notice">{message}</p>}

      <section className="card">
        <h2>Prix par gamme (FCFA)</h2>
        <p className="muted small">
          Prix = max(minimum ; (base + km × prix/km + minutes × prix/minute) × majoration), arrondi à 25 FCFA.
        </p>
        <table className="form-table">
          <thead>
            <tr>
              <th>Gamme</th>
              <th>Base</th>
              <th>Par km</th>
              <th>Par minute</th>
              <th>Minimum</th>
              <th className="num">Exemple 5 km / 15 min</th>
            </tr>
          </thead>
          <tbody>
            {VEHICLE_CLASSES.map((c) => (
              <tr key={c}>
                <td>
                  <b>{VEHICLE_LABELS[c]}</b>
                </td>
                {(["base", "perKm", "perMinute", "minimum"] as const).map((k) => (
                  <td key={k}>
                    <input type="number" min={0} step={5} value={pricing[c]?.[k] ?? 0} onChange={(e) => setP(c, k, e.target.value)} />
                  </td>
                ))}
                <td className="num">{fcfa(preview(pricing[c] ?? EMPTY, 5, 15, config.surge))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Majoration (heure de pointe)</h2>
          <div className="surge">
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.1}
              value={config.surge}
              onChange={(e) => setC("surge", Number(e.target.value))}
            />
            <b>× {config.surge.toFixed(1)}</b>
          </div>
          <p className="muted small">1,0 = pas de majoration. S'applique aux nouvelles commandes uniquement.</p>
          <div className="row">
            <button type="button" onClick={() => setC("surge", 1)}>
              Normal
            </button>
            <button type="button" onClick={() => setC("surge", 1.3)}>
              Pointe ×1,3
            </button>
            <button type="button" onClick={() => setC("surge", 1.5)}>
              Forte ×1,5
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Règles de la plateforme</h2>
          <NumberField
            label="Commission (%)"
            value={Math.round(config.commissionRate * 100)}
            onChange={(v) => setC("commissionRate", v / 100)}
            max={50}
          />
          <NumberField label="Frais d'annulation (FCFA)" value={config.cancelFee} onChange={(v) => setC("cancelFee", v)} step={25} />
          <NumberField
            label="Annulation gratuite pendant (secondes)"
            value={config.freeCancelSeconds}
            onChange={(v) => setC("freeCancelSeconds", v)}
          />
          <NumberField
            label="Temps pour accepter une course (secondes)"
            value={config.offerTimeoutSeconds}
            onChange={(v) => setC("offerTimeoutSeconds", v)}
            max={60}
          />
          <NumberField label="Rayon de recherche (km)" value={config.searchRadiusKm} onChange={(v) => setC("searchRadiusKm", v)} max={30} />
          <NumberField label="Chauffeurs sollicités au maximum" value={config.maxOffers} onChange={(v) => setC("maxOffers", v)} max={20} />
        </section>
      </div>
    </form>
  );
}

function NumberField(props: { label: string; value: number; onChange: (v: number) => void; step?: number; max?: number }) {
  return (
    <label className="inline">
      <span>{props.label}</span>
      <input
        type="number"
        min={0}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}

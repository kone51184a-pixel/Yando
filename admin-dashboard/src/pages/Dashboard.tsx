import { collection, orderBy, query, where } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import { ACTIVE_STATUSES, fcfa, minutesBetween, startOfToday, time, VEHICLE_LABELS } from "../format";
import { useDriverLocations, useQuery } from "../hooks";
import StatusBadge from "../components/StatusBadge";

interface Ride {
  status: string;
  price: number;
  commission?: number;
  tip?: number;
  vehicleClass: string;
  createdAt?: unknown;
  assignedAt?: unknown;
  pickup: { label: string };
  dropoff: { label: string };
  cancellationFee?: number;
}

export default function Dashboard() {
  const today = startOfToday();
  const { data: rides, loading, error } = useQuery<Ride>(
    () => query(collection(db, "rides"), where("createdAt", ">=", today), orderBy("createdAt", "desc")),
    [today.getTime()],
  );
  const online = useDriverLocations();

  const completed = rides.filter((r) => r.status === "completed");
  const cancelled = rides.filter((r) => r.status === "cancelled");
  const noDriver = rides.filter((r) => r.status === "no_driver");
  const active = rides.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const revenue = completed.reduce((s, r) => s + (r.price ?? 0), 0);
  const commission = completed.reduce((s, r) => s + (r.commission ?? 0), 0);
  const waits = rides.map((r) => minutesBetween(r.createdAt, r.assignedAt)).filter((m): m is number => m != null);
  const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;

  const byClass = ["moto", "standard", "confort"].map((c) => ({
    c,
    n: completed.filter((r) => r.vehicleClass === c).length,
  }));

  return (
    <>
      <h1>Aujourd'hui</h1>
      {error && <p className="error">{error}</p>}
      <div className="stats">
        <Stat label="Courses commandées" value={loading ? "…" : rides.length} />
        <Stat label="Terminées" value={completed.length} />
        <Stat label="En cours" value={active.length} />
        <Stat label="Chauffeurs en ligne" value={online.length} />
        <Stat label="Chiffre d'affaires" value={fcfa(revenue)} />
        <Stat label="Commission plateforme" value={fcfa(commission)} />
        <Stat
          label="Attente moyenne"
          value={avgWait == null ? "—" : `${avgWait < 1 ? Math.round(avgWait * 60) + " s" : avgWait.toFixed(1) + " min"}`}
          hint="Entre la commande et l'acceptation"
        />
        <Stat
          label="Annulées / sans chauffeur"
          value={`${cancelled.length} / ${noDriver.length}`}
          hint={rides.length ? `${Math.round(((cancelled.length + noDriver.length) / rides.length) * 100)} % des commandes` : undefined}
        />
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Courses terminées par gamme</h2>
          {byClass.map(({ c, n }) => (
            <div key={c} className="bar-row">
              <span>{VEHICLE_LABELS[c]}</span>
              <div className="bar">
                <div style={{ width: `${completed.length ? (n / completed.length) * 100 : 0}%` }} className={`fill-${c}`} />
              </div>
              <b>{n}</b>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="row-between">
            <h2>Dernières courses</h2>
            <Link to="/courses">Tout voir</Link>
          </div>
          {rides.length === 0 && !loading && <p className="muted">Aucune course aujourd'hui.</p>}
          <table>
            <tbody>
              {rides.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td className="muted">{time(r.createdAt)}</td>
                  <td>
                    {r.pickup?.label} → {r.dropoff?.label}
                  </td>
                  <td className="num">{fcfa(r.price)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="stat card">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

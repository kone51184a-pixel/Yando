import { useEffect, useState } from "react";
import { collection, doc, getDoc, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { dateTime, fcfa, PAYMENT_LABELS, STATUS_LABELS, VEHICLE_LABELS } from "../format";
import { useQuery, WithId } from "../hooks";
import StatusBadge from "../components/StatusBadge";

export interface Ride {
  passengerId: string;
  passengerName?: string;
  driverId: string | null;
  driver?: { name: string; vehicle?: { model?: string; plate?: string } } | null;
  pickup: { label: string };
  dropoff: { label: string };
  vehicleClass: string;
  paymentMethod: string;
  distanceKm: number;
  durationMin: number;
  routeSource: string;
  surge: number;
  fareBeforePromo: number;
  promoCode: string | null;
  discount: number;
  price: number;
  commission?: number;
  driverEarnings?: number;
  tip?: number;
  rating?: { stars: number; comment: string | null };
  status: string;
  cancelledBy?: string;
  cancelReason?: string | null;
  cancellationFee?: number;
  pinAttempts?: number;
  createdAt?: unknown;
  assignedAt?: unknown;
  arrivedAt?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  cancelledAt?: unknown;
}

export default function Rides() {
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { data: rides, loading, error } = useQuery<Ride>(
    () =>
      status
        ? query(collection(db, "rides"), where("status", "==", status), orderBy("createdAt", "desc"), limit(100))
        : query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(100)),
    [status],
  );
  const current = rides.find((r) => r.id === selected) ?? null;

  return (
    <>
      <div className="row-between">
        <h1>Courses</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="split wide-left">
        <section className="card list">
          {loading && <p className="muted">Chargement…</p>}
          {!loading && rides.length === 0 && <p className="muted">Aucune course.</p>}
          <table className="clickable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Trajet</th>
                <th>Gamme</th>
                <th className="num">Prix</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {rides.map((r) => (
                <tr key={r.id} className={selected === r.id ? "selected" : ""} onClick={() => setSelected(r.id)}>
                  <td className="muted small">{dateTime(r.createdAt)}</td>
                  <td>
                    {r.pickup?.label} → {r.dropoff?.label}
                  </td>
                  <td>{VEHICLE_LABELS[r.vehicleClass]}</td>
                  <td className="num">{fcfa(r.price)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          {current ? <RideDetail ride={current} /> : <p className="muted">Sélectionnez une course.</p>}
        </section>
      </div>
    </>
  );
}

export function RideDetail({ ride }: { ride: WithId<Ride> }) {
  const [payment, setPayment] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    setPayment(null);
    getDoc(doc(db, "payments", ride.id)).then((s) => setPayment(s.exists() ? s.data() : null));
  }, [ride.id, ride.status]);

  return (
    <div>
      <div className="row-between">
        <h2>Course</h2>
        <StatusBadge status={ride.status} />
      </div>
      <div className="muted small">{ride.id}</div>

      <dl className="kv">
        <dt>Trajet</dt>
        <dd>
          {ride.pickup?.label} → {ride.dropoff?.label}
        </dd>
        <dt>Distance / durée</dt>
        <dd>
          {ride.distanceKm} km · {ride.durationMin} min {ride.routeSource === "estimation" && <span className="tag">estimé</span>}
        </dd>
        <dt>Passager</dt>
        <dd>{ride.passengerName ?? ride.passengerId}</dd>
        <dt>Chauffeur</dt>
        <dd>
          {ride.driver ? `${ride.driver.name} · ${ride.driver.vehicle?.model ?? ""} ${ride.driver.vehicle?.plate ?? ""}` : "—"}
        </dd>
        <dt>Paiement</dt>
        <dd>
          {PAYMENT_LABELS[ride.paymentMethod] ?? ride.paymentMethod}
          {payment && ` · ${payment.status === "paid" ? "payé" : payment.status === "pending" ? "en attente" : String(payment.status)}`}
        </dd>
      </dl>

      <h3>Prix</h3>
      <dl className="kv">
        <dt>Tarif calculé</dt>
        <dd>
          {fcfa(ride.fareBeforePromo)} {ride.surge > 1 && <span className="tag warn">majoration ×{ride.surge}</span>}
        </dd>
        {ride.discount > 0 && (
          <>
            <dt>Code promo</dt>
            <dd>
              {ride.promoCode} (−{fcfa(ride.discount)})
            </dd>
          </>
        )}
        <dt>Prix payé</dt>
        <dd>
          <b>{fcfa(ride.price)}</b>
        </dd>
        {ride.commission != null && (
          <>
            <dt>Commission</dt>
            <dd>{fcfa(ride.commission)}</dd>
            <dt>Gain chauffeur</dt>
            <dd>{fcfa(ride.driverEarnings)}</dd>
          </>
        )}
        {!!ride.tip && (
          <>
            <dt>Pourboire</dt>
            <dd>{fcfa(ride.tip)}</dd>
          </>
        )}
        {!!ride.cancellationFee && (
          <>
            <dt>Frais d'annulation</dt>
            <dd>{fcfa(ride.cancellationFee)}</dd>
          </>
        )}
      </dl>

      {ride.rating && (
        <>
          <h3>Avis du passager</h3>
          <p>
            {"★".repeat(ride.rating.stars)}
            {"☆".repeat(5 - ride.rating.stars)} {ride.rating.comment && `— ${ride.rating.comment}`}
          </p>
        </>
      )}

      {ride.status === "cancelled" && (
        <>
          <h3>Annulation</h3>
          <p>
            Par le {ride.cancelledBy === "driver" ? "chauffeur" : "passager"}
            {ride.cancelReason && ` : « ${ride.cancelReason} »`}
          </p>
        </>
      )}

      <h3>Chronologie</h3>
      <ul className="timeline">
        <li>Commandée : {dateTime(ride.createdAt)}</li>
        {ride.assignedAt != null && <li>Acceptée : {dateTime(ride.assignedAt)}</li>}
        {ride.arrivedAt != null && <li>Chauffeur arrivé : {dateTime(ride.arrivedAt)}</li>}
        {ride.startedAt != null && <li>Démarrée (PIN) : {dateTime(ride.startedAt)}</li>}
        {ride.completedAt != null && <li>Terminée : {dateTime(ride.completedAt)}</li>}
        {ride.cancelledAt != null && <li>Annulée : {dateTime(ride.cancelledAt)}</li>}
      </ul>
      {!!ride.pinAttempts && <p className="small warn-text">{ride.pinAttempts} code(s) PIN faux saisi(s).</p>}
    </div>
  );
}

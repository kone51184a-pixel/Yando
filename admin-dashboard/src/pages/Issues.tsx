import { useState } from "react";
import { collection, doc, limit, orderBy, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { dateTime, errorMessage, fcfa, startOfToday } from "../format";
import { useQuery, WithId } from "../hooks";
import { Ride, RideDetail } from "./Rides";

interface Report {
  reporterId: string;
  rideId?: string;
  text: string;
  status?: "open" | "resolved";
  adminNote?: string;
  createdAt?: unknown;
}

export default function Issues() {
  const [tab, setTab] = useState<"reports" | "cancelled" | "no_driver">("reports");
  return (
    <>
      <h1>Problèmes</h1>
      <div className="tabs">
        <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>
          Signalements
        </button>
        <button className={tab === "cancelled" ? "active" : ""} onClick={() => setTab("cancelled")}>
          Courses annulées
        </button>
        <button className={tab === "no_driver" ? "active" : ""} onClick={() => setTab("no_driver")}>
          Sans chauffeur
        </button>
      </div>
      {tab === "reports" ? <Reports /> : <RideList status={tab} />}
    </>
  );
}

function Reports() {
  const { data: reports, error } = useQuery<Report>(() => query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(100)), []);
  return (
    <section className="card">
      {error && <p className="error">{error}</p>}
      {reports.length === 0 && <p className="muted">Aucun signalement.</p>}
      {reports.map((r) => (
        <ReportItem key={r.id} report={r} />
      ))}
    </section>
  );
}

function ReportItem({ report }: { report: WithId<Report> }) {
  const [note, setNote] = useState(report.adminNote ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const open = report.status !== "resolved";

  async function setStatus(status: "open" | "resolved") {
    try {
      await updateDoc(doc(db, "reports", report.id), { status, adminNote: note, updatedAt: Timestamp.now() });
      setMessage(status === "resolved" ? "Marqué comme résolu." : "Rouvert.");
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  return (
    <div className={`report ${open ? "" : "resolved"}`}>
      <div className="row-between">
        <span className={`tag ${open ? "warn" : "ok"}`}>{open ? "Ouvert" : "Résolu"}</span>
        <span className="muted small">{dateTime(report.createdAt)}</span>
      </div>
      <p>{report.text}</p>
      <div className="muted small">
        Par {report.reporterId}
        {report.rideId && ` · course ${report.rideId}`}
      </div>
      <div className="row">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note interne (action faite, remboursement…)" />
        {open ? (
          <button className="primary" onClick={() => setStatus("resolved")}>
            Résolu
          </button>
        ) : (
          <button onClick={() => setStatus("open")}>Rouvrir</button>
        )}
      </div>
      {message && <p className="small">{message}</p>}
    </div>
  );
}

function RideList({ status }: { status: "cancelled" | "no_driver" }) {
  const since = new Date(startOfToday().getTime() - 6 * 86400000); // 7 derniers jours
  const [selected, setSelected] = useState<string | null>(null);
  const { data: rides, error } = useQuery<Ride>(
    () =>
      query(
        collection(db, "rides"),
        where("status", "==", status),
        where("createdAt", ">=", since),
        orderBy("createdAt", "desc"),
        limit(100),
      ),
    [status],
  );
  const current = rides.find((r) => r.id === selected) ?? null;
  const fees = rides.reduce((s, r) => s + (r.cancellationFee ?? 0), 0);

  return (
    <>
      <p className="muted">
        7 derniers jours : {rides.length} course(s)
        {status === "cancelled" && ` · frais d'annulation : ${fcfa(fees)}`}
        {status === "no_driver" && " — à surveiller : manque de chauffeurs dans certaines zones ou à certaines heures."}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="split wide-left">
        <section className="card list">
          <table className="clickable">
            <tbody>
              {rides.map((r) => (
                <tr key={r.id} className={selected === r.id ? "selected" : ""} onClick={() => setSelected(r.id)}>
                  <td className="muted small">{dateTime(r.createdAt)}</td>
                  <td>
                    {r.pickup?.label} → {r.dropoff?.label}
                  </td>
                  <td>{status === "cancelled" ? (r.cancelledBy === "driver" ? "par le chauffeur" : "par le passager") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">{current ? <RideDetail ride={current} /> : <p className="muted">Sélectionnez une course.</p>}</section>
      </div>
    </>
  );
}

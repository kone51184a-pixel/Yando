import { useEffect, useState } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { callFn, db, storage } from "../firebase";
import { dateTime, errorMessage, VEHICLE_LABELS } from "../format";
import { useDriverLocations, useQuery, WithId } from "../hooks";

interface Driver {
  name: string;
  phone?: string;
  photoUrl?: string | null;
  vehicleClass: string;
  vehicle?: { model?: string; color?: string; plate?: string } | null;
  documents?: Record<string, string>;
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string | null;
  ratingSum?: number;
  ratingCount?: number;
  currentRideId?: string | null;
  createdAt?: unknown;
  reviewedAt?: unknown;
}

const TABS = [
  { key: "pending", label: "À valider" },
  { key: "approved", label: "Validés" },
  { key: "rejected", label: "Refusés" },
] as const;

const DOC_LABELS: Record<string, string> = {
  license: "Permis de conduire",
  idCard: "Pièce d'identité",
  vehicleDocs: "Papiers du véhicule",
};

export default function Drivers() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data: drivers, loading, error } = useQuery<Driver>(
    () => query(collection(db, "drivers"), where("status", "==", tab), orderBy("createdAt", "desc")),
    [tab],
  );
  const online = new Set(useDriverLocations().map((d) => d.id));
  const current = drivers.find((d) => d.id === selected) ?? null;

  return (
    <>
      <h1>Chauffeurs</h1>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => (setTab(t.key), setSelected(null), setNotice(null))}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="split">
        <section className="card list">
          {loading && <p className="muted">Chargement…</p>}
          {!loading && drivers.length === 0 && <p className="muted">Aucun chauffeur.</p>}
          {drivers.map((d) => (
            <button key={d.id} className={`list-item ${selected === d.id ? "selected" : ""}`} onClick={() => (setSelected(d.id), setNotice(null))}>
              <div>
                <b>{d.name}</b> {online.has(d.id) && <span className="dot-online" title="En ligne" />}
                <div className="muted small">
                  {VEHICLE_LABELS[d.vehicleClass]} · {d.vehicle?.plate ?? "sans plaque"}
                </div>
              </div>
              <div className="muted small">{dateTime(d.createdAt)}</div>
            </button>
          ))}
        </section>

        <section className="card">
          {current ? <DriverDetail driver={current} onDone={(m) => (setNotice(m), setSelected(null))} /> : <p className="muted">Sélectionnez un chauffeur.</p>}
        </section>
      </div>
    </>
  );
}

function DriverDetail({ driver, onDone }: { driver: WithId<Driver>; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rating = driver.ratingCount ? (driver.ratingSum! / driver.ratingCount).toFixed(1) : null;

  async function decide(approve: boolean) {
    let reason: string | null = null;
    if (!approve) {
      reason = window.prompt("Motif du refus (envoyé au chauffeur) :", "Documents illisibles");
      if (reason === null) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await callFn("validateDriver", { driverId: driver.id, approve, reason });
      // La fiche quitte l'onglet courant : le message est affiché par la page.
      onDone(`${driver.name} : ${approve ? "chauffeur validé" : "chauffeur refusé ou suspendu"}.`);
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="row">
        {driver.photoUrl ? <img src={driver.photoUrl} className="avatar" alt="" /> : <div className="avatar placeholder" />}
        <div>
          <h2>{driver.name}</h2>
          <div className="muted">{driver.phone ?? "—"}</div>
        </div>
      </div>

      <dl className="kv">
        <dt>Gamme</dt>
        <dd>{VEHICLE_LABELS[driver.vehicleClass]}</dd>
        <dt>Véhicule</dt>
        <dd>
          {driver.vehicle?.model ?? "—"} · {driver.vehicle?.color ?? "—"}
        </dd>
        <dt>Plaque</dt>
        <dd>{driver.vehicle?.plate ?? "—"}</dd>
        <dt>Note</dt>
        <dd>{rating ? `${rating} / 5 (${driver.ratingCount} avis)` : "Pas encore noté"}</dd>
        <dt>Inscrit le</dt>
        <dd>{dateTime(driver.createdAt)}</dd>
        {driver.status === "rejected" && (
          <>
            <dt>Motif du refus</dt>
            <dd>{driver.rejectionReason ?? "—"}</dd>
          </>
        )}
        {driver.currentRideId && (
          <>
            <dt>Course en cours</dt>
            <dd>{driver.currentRideId}</dd>
          </>
        )}
      </dl>

      <h3>Documents</h3>
      <div className="docs">
        {Object.keys(DOC_LABELS).map((key) => (
          <DocumentPreview key={key} label={DOC_LABELS[key]} path={driver.documents?.[key]} />
        ))}
      </div>

      <div className="row actions">
        {driver.status !== "approved" && (
          <button className="primary" disabled={busy} onClick={() => decide(true)}>
            Valider
          </button>
        )}
        {driver.status !== "rejected" && (
          <button className="danger" disabled={busy} onClick={() => decide(false)}>
            {driver.status === "approved" ? "Suspendre" : "Refuser"}
          </button>
        )}
      </div>
      {message && <p className="small">{message}</p>}
    </div>
  );
}

function DocumentPreview({ label, path }: { label: string; path?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setUrl(null);
    setError(false);
    if (!path) return;
    getDownloadURL(ref(storage, path))
      .then(setUrl)
      .catch(() => setError(true));
  }, [path]);

  return (
    <div className="doc">
      <div className="small">{label}</div>
      {!path && <div className="muted small">Non fourni</div>}
      {error && <div className="error small">Introuvable</div>}
      {url &&
        (path?.toLowerCase().endsWith(".pdf") ? (
          <a href={url} target="_blank" rel="noreferrer">
            Ouvrir le PDF
          </a>
        ) : (
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={label} />
          </a>
        ))}
    </div>
  );
}

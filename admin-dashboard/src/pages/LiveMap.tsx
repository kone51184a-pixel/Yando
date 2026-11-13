import { collection, query, where } from "firebase/firestore";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";
import { db } from "../firebase";
import { ACTIVE_STATUSES, fcfa, VEHICLE_COLORS, VEHICLE_LABELS } from "../format";
import { useDriverLocations, useQuery } from "../hooks";
import StatusBadge from "../components/StatusBadge";

const BAMAKO: [number, number] = [12.6392, -8.0029];

interface Ride {
  status: string;
  price: number;
  vehicleClass: string;
  driverId: string | null;
  passengerName?: string;
  driver?: { name: string } | null;
  pickup: { lat: number; lng: number; label: string };
  dropoff: { lat: number; lng: number; label: string };
}

export default function LiveMap() {
  const drivers = useDriverLocations();
  const { data: rides } = useQuery<Ride>(() => query(collection(db, "rides"), where("status", "in", ACTIVE_STATUSES)), []);
  const busy = new Set(rides.map((r) => r.driverId).filter(Boolean));

  return (
    <>
      <div className="row-between">
        <h1>Carte en direct</h1>
        <div className="legend">
          {Object.entries(VEHICLE_LABELS).map(([c, l]) => (
            <span key={c}>
              <i style={{ background: VEHICLE_COLORS[c] }} /> {l}
            </span>
          ))}
          <span>
            <i className="ring" /> En course
          </span>
          <span>
            <i style={{ background: "#16a34a" }} /> Départ demandé
          </span>
        </div>
      </div>
      <p className="muted">
        {drivers.length} chauffeur(s) en ligne · {rides.length} course(s) active(s). Mise à jour en temps réel.
      </p>

      <div className="map card">
        <MapContainer center={BAMAKO} zoom={13} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {drivers.map((d) => (
            <CircleMarker
              key={d.id}
              center={[d.lat, d.lng]}
              radius={busy.has(d.id) ? 9 : 7}
              pathOptions={{
                color: busy.has(d.id) ? "#111" : "#fff",
                weight: busy.has(d.id) ? 3 : 2,
                fillColor: VEHICLE_COLORS[d.vehicleClass] ?? "#555",
                fillOpacity: 0.95,
              }}
            >
              <Popup>
                <b>{d.id}</b>
                <br />
                {VEHICLE_LABELS[d.vehicleClass]} · {busy.has(d.id) ? "en course" : "libre"}
                <br />
                Vu il y a {Math.round((Date.now() - d.ts) / 1000)} s
              </Popup>
            </CircleMarker>
          ))}
          {rides.map((r) => (
            <RideOverlay key={r.id} ride={r} />
          ))}
        </MapContainer>
      </div>
    </>
  );
}

function RideOverlay({ ride }: { ride: Ride & { id: string } }) {
  return (
    <>
      <Polyline
        positions={[
          [ride.pickup.lat, ride.pickup.lng],
          [ride.dropoff.lat, ride.dropoff.lng],
        ]}
        pathOptions={{ color: "#16a34a", dashArray: "6 6", weight: 2 }}
      />
      <CircleMarker center={[ride.pickup.lat, ride.pickup.lng]} radius={6} pathOptions={{ color: "#16a34a", fillOpacity: 1 }}>
        <Popup>
          <StatusBadge status={ride.status} />
          <br />
          {ride.pickup.label} → {ride.dropoff.label}
          <br />
          {VEHICLE_LABELS[ride.vehicleClass]} · {fcfa(ride.price)}
          <br />
          Passager : {ride.passengerName ?? "—"}
          {ride.driver && (
            <>
              <br />
              Chauffeur : {ride.driver.name}
            </>
          )}
        </Popup>
      </CircleMarker>
    </>
  );
}

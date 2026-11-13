import { useEffect, useState } from "react";
import { DocumentData, onSnapshot, Query } from "firebase/firestore";
import { onValue, ref } from "firebase/database";
import { rtdb } from "./firebase";

export type WithId<T = DocumentData> = T & { id: string };

/** Écoute une requête Firestore en temps réel. `deps` relance l'écoute quand ils changent. */
export function useQuery<T = DocumentData>(build: () => Query | null, deps: unknown[]) {
  const [data, setData] = useState<WithId<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = build();
    if (!q) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

export interface DriverLocation {
  lat: number;
  lng: number;
  online: boolean;
  vehicleClass: string;
  ts: number;
  heading?: number;
}

/** Positions des chauffeurs (Realtime Database), filtrées : en ligne et récentes. */
export function useDriverLocations(maxAgeMs = 90_000) {
  const [locations, setLocations] = useState<Record<string, DriverLocation>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    return onValue(ref(rtdb, "driverLocations"), (snap) => setLocations((snap.val() as Record<string, DriverLocation>) ?? {}));
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const online = Object.entries(locations)
    .filter(([, l]) => l.online && now - l.ts <= maxAgeMs)
    .map(([id, l]) => ({ id, ...l }));
  return online;
}

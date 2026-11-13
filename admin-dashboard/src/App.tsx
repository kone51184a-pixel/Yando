import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { signOut } from "firebase/auth";
import { collection, query, where } from "firebase/firestore";
import { auth, db, useEmulators } from "./firebase";
import { useAuth } from "./auth";
import { useQuery } from "./hooks";
import Dashboard from "./pages/Dashboard";
import LiveMap from "./pages/LiveMap";
import Drivers from "./pages/Drivers";
import Rides from "./pages/Rides";
import Pricing from "./pages/Pricing";
import Promos from "./pages/Promos";
import Issues from "./pages/Issues";

export default function App() {
  const { user } = useAuth();
  const pending = useQuery(() => query(collection(db, "drivers"), where("status", "==", "pending")), []);
  const openReports = useQuery(() => query(collection(db, "reports"), where("status", "==", "open")), []);

  const links = [
    { to: "/", label: "Tableau de bord" },
    { to: "/carte", label: "Carte en direct" },
    { to: "/chauffeurs", label: "Chauffeurs", badge: pending.data.length },
    { to: "/courses", label: "Courses" },
    { to: "/tarifs", label: "Tarifs" },
    { to: "/promos", label: "Codes promo" },
    { to: "/problemes", label: "Problèmes", badge: openReports.data.length },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Yando</div>
        <div className="muted small">Administration — Bamako</div>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === "/"}>
              {l.label}
              {!!l.badge && <span className="badge">{l.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {useEmulators && <div className="tag warn">Émulateurs</div>}
          <div className="small muted">{user?.email}</div>
          <button className="link" onClick={() => signOut(auth)}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/carte" element={<LiveMap />} />
          <Route path="/chauffeurs" element={<Drivers />} />
          <Route path="/courses" element={<Rides />} />
          <Route path="/tarifs" element={<Pricing />} />
          <Route path="/promos" element={<Promos />} />
          <Route path="/problemes" element={<Issues />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

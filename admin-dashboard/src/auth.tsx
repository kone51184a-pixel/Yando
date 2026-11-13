import { createContext, FormEvent, ReactNode, useContext, useEffect, useState } from "react";
import { onIdTokenChanged, signInWithEmailAndPassword, signOut, User } from "firebase/auth";
import { auth, useEmulators } from "./firebase";
import { errorMessage } from "./format";

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, isAdmin: false, loading: true });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, isAdmin: false, loading: true });
  useEffect(
    () =>
      onIdTokenChanged(auth, async (user) => {
        if (!user) return setState({ user: null, isAdmin: false, loading: false });
        const token = await user.getIdTokenResult();
        setState({ user, isAdmin: token.claims.admin === true, loading: false });
      }),
    [],
  );
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <div className="center muted">Chargement…</div>;
  if (!user) return <LoginPage />;
  if (!isAdmin) {
    return (
      <div className="center">
        <div className="card narrow">
          <h2>Accès refusé</h2>
          <p>
            Le compte <b>{user.email ?? user.uid}</b> n'est pas administrateur.
          </p>
          <p className="muted small">
            Donner le rôle : <code>npm run set-admin -- {user.uid}</code> dans backend/functions, puis se reconnecter.
          </p>
          <button onClick={() => signOut(auth)}>Se déconnecter</button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(errorMessage(err).includes("invalid") ? "E-mail ou mot de passe incorrect." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <div className="brand big">Yando</div>
        <p className="muted">Administration</p>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Mot de passe
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
        {useEmulators && (
          <p className="muted small">
            Mode émulateurs : créez le compte dans l'interface http://127.0.0.1:4000 (onglet Authentication).
          </p>
        )}
      </form>
    </div>
  );
}

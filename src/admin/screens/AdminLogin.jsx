import React from "react";
import logoIcon from "../../../assets/logo-icon.png";
import { iniciarSesionAdmin } from "../adminAuth";

export default function AdminLogin() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password || loading) return;
    setLoading(true);
    setError(null);
    try {
      await iniciarSesionAdmin(email.trim(), password);
      // El cambio de pantalla lo dispara AdminApp al escuchar el cambio de sesión.
    } catch (err) {
      setError("No se pudo iniciar sesión — revisá el usuario y la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen login-screen">
      <div className="login-wrap">
        <div className="brand-mark">
          <img className="brand-logo" src={logoIcon} alt="San Lorenzo Star" />
          <h1>RepartoApp — Admin</h1>
          <p>Panel de rendiciones · San Lorenzo Star</p>
        </div>
        <form className="card login-card" onSubmit={handleSubmit}>
          {error && (
            <div className="alert-card">
              <span className="ic">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <div className="field">
            <label htmlFor="adminEmail">Usuario</label>
            <input
              id="adminEmail"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@sanlorenzostar.com"
            />
          </div>
          <div className="field">
            <label htmlFor="adminPassword">Contraseña</label>
            <input
              id="adminPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? "Ingresando…" : "Ingresar"}
          </button>
          <p className="login-note">
            Los usuarios de este panel se crean desde Firebase, no hay alta pública.
          </p>
        </form>
      </div>
    </div>
  );
}

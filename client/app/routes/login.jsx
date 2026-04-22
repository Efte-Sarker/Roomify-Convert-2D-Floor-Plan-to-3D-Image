import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router";
import { login as loginUser } from "../../lib/auth";
import Button from "../../components/ui/Button";
import { ArrowLeft } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const { refreshAuth } = useOutletContext();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await loginUser({ username, password });
      await refreshAuth();
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <button
          onClick={() => navigate("/")}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 0', background: 'transparent', border: 'none', color: '#71717a', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 20 }}
        >
          <ArrowLeft size={15} />
          Back
        </button>

        <div className="auth-card__header">
          <h1 className="auth-card__title">Log in</h1>
          <p className="auth-card__subtitle">
            Welcome back. Sign in to upload floor plans and manage projects.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="login-username" className="auth-label">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="auth-input"
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="login-password" className="auth-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              required
            />
          </div>

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="auth-submit-wrap">
            <Button type="submit" disabled={loading} fullWidth>
              {loading ? "Logging in…" : "Log in"}
            </Button>
          </div>

          <p className="auth-card__footer">
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="auth-card__link">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
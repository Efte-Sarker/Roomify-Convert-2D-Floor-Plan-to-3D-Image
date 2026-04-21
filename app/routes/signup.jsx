import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router";
import { register as registerUser } from "../../lib/auth";
import Button from "../../components/ui/Button";
import { ArrowLeft } from "lucide-react";

export default function Signup() {
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
      await registerUser({ username, password });
      await refreshAuth();
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign up failed.");
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
          <h1 className="auth-card__title">Create an account</h1>
          <p className="auth-card__subtitle">
            Join Roomify to save projects and render your floor plans.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="signup-username" className="auth-label">
              Username
            </label>
            <input
              id="signup-username"
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
            <label htmlFor="signup-password" className="auth-label">
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              name="password"
              autoComplete="new-password"
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
              {loading ? "Creating account…" : "Sign up"}
            </Button>
          </div>

          <p className="auth-card__footer">
            Already have an account?{" "}
            <Link to="/login" className="auth-card__link">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
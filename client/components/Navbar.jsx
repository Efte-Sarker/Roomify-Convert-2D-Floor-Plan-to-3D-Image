import { Box, History } from "lucide-react";
import { useOutletContext, useNavigate, Link } from "react-router";

// Button style matching RoomEditor navbar buttons exactly:
// padding 8px 16px, fontSize 13, borderRadius 6, border none
const editorBtnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 6, border: 'none', color: 'white',
  cursor: 'pointer', fontSize: 13, fontWeight: 500,
  fontFamily: "Instrument Serif", transition: 'background 0.15s',
};

const Navbar = () => {
  const { isSignedIn, userName, signOut } = useOutletContext();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/login");
    } catch (e) {
      console.error(`Sign out failed: ${e}`);
    }
  };

  return (
    <header className="navbar">
      <nav className="inner">
        {/* Left: brand only */}
        <div className="left">
          <div className="brand" onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
            <Box className="logo" />
            <span className="name">Roomify</span>
          </div>
        </div>

        {/* Right: History → divider → username → Log Out   (or Log In / Sign Up) */}
        <div className="actions">
          {isSignedIn ? (
            <>
              {/* History link — left of username */}
              <Link
                to="/history"
                className="navbar-history-link"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <History size={14} />
                History
              </Link>

              {/* Divider matching RoomEditor's Back ↔ title divider */}
              <div style={{ width: 1, height: 20, background: '#e4e4e7', flexShrink: 0 }} />

              <span className="greeting">
                {userName ? `Hi, ${userName}` : "Signed in"}
              </span>

              <button
                onClick={handleSignOut}
                style={{ ...editorBtnBase, background: '#000', }}
                onMouseEnter={e => (e.currentTarget.style.background = '#27272a')}
                onMouseLeave={e => (e.currentTarget.style.background = '#000')}
              >
                Log Out
              </button>
            </>
          ) : (
            <>
              <Link to="/login">
                <button style={{ ...editorBtnBase, background: 'transparent', color: '#374151', border: '1px solid #e4e4e7' }}>
                  Log In
                </button>
              </Link>
              <Link to="/signup">
                <button style={{ ...editorBtnBase, background: '#000', color: '#fff' }}>
                  Sign Up
                </button>
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
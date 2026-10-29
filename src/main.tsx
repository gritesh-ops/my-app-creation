import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import App from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { loadRuntimeConfig } from './lib/config.js';
import { initSupabase } from './lib/supabase.js';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');
const root = createRoot(container);

function MissingSetup({ detail }: { detail: string }) {
  return (
    <div className="auth__main" style={{ minHeight: '100vh' }}>
      <div className="auth__card">
        <div className="brand" style={{ fontSize: '1.15rem' }}>
          <span className="brand__mark">TP</span> TeamPilot AI
        </div>
        <div className="card">
          <div className="card__body stack">
            <h1>Almost there</h1>
            <p className="muted">
              The app is running, but it still needs a Supabase project for sign-in, storage and real-time chat.
            </p>
            <pre
              className="small"
              style={{
                background: '#f1f2fa',
                padding: 12,
                borderRadius: 10,
                whiteSpace: 'pre-wrap',
                margin: 0,
              }}
            >
              1. Create a free project at supabase.com{'\n'}
              2. SQL Editor → paste supabase/schema.sql → Run{'\n'}
              3. Set SUPABASE_URL and SUPABASE_ANON_KEY{'\n'}
              4. Restart the app
            </pre>
            <p className="small muted">Details: {detail}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

loadRuntimeConfig()
  .then((config) => {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      root.render(<MissingSetup detail="SUPABASE_URL / SUPABASE_ANON_KEY are not set on the server." />);
      return;
    }
    initSupabase(config);
    root.render(
      <StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <App aiConfigured={config.aiConfigured} />
          </AuthProvider>
        </BrowserRouter>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(<MissingSetup detail={error instanceof Error ? error.message : 'Unknown configuration error.'} />);
  });

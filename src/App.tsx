import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider.js';
import Layout from './components/Layout.js';
import LoginPage from './pages/LoginPage.js';
import ProjectPage from './pages/ProjectPage.js';
import ProjectWizardPage from './pages/ProjectWizardPage.js';
import ProjectsPage from './pages/ProjectsPage.js';
import { Spinner } from './components/ui.js';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App({ aiConfigured }: { aiConfigured: boolean }) {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<ProjectsPage aiConfigured={aiConfigured} />} />
        <Route path="/projects/new" element={<ProjectWizardPage aiConfigured={aiConfigured} />} />
        <Route path="/projects/:projectId" element={<ProjectPage aiConfigured={aiConfigured} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

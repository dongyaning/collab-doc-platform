import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import { LoginPage } from './pages/login';
import { RegisterPage } from './pages/register';
import { KnowledgeBaseListPage } from './pages/knowledge-base-list';
import { KnowledgeBaseViewPage } from './pages/knowledge-base-view';
import { PerformancePage } from './pages/performance';
import { AppLayout } from './pages/app-layout';
import { themeTokens } from './styles/tokens';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: themeTokens,
      }}
    >
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route element={<AppLayout />}>
                <Route path="/kb" element={<KnowledgeBaseListPage />} />
                <Route path="/performance" element={<PerformancePage />} />
                <Route path="/kb/:kbId" element={<KnowledgeBaseViewPage />} />
                <Route path="/kb/:kbId/:nodeId" element={<KnowledgeBaseViewPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/kb" replace />} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}

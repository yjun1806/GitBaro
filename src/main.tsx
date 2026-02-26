import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./i18n/config";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

// Tauri 윈도우 포커스 이벤트를 React Query에 연동
// 포커스 시 모든 쿼리를 invalidate하여 staleTime과 관계없이 즉시 갱신
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  focusManager.setFocused(focused);
  if (focused) {
    queryClient.invalidateQueries();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

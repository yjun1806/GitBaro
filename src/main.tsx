import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./i18n/config";
import "./styles/globals.css";

// Tauri 윈도우 포커스 이벤트를 React Query에 연동
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  focusManager.setFocused(focused);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

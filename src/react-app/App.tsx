import { useCallback, useEffect, useState } from "react";
import type { Me } from "../shared/types";
import { api, ApiError } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { VerifyPage } from "./pages/VerifyPage";
import { DashboardPage } from "./pages/DashboardPage";

export function App() {
  // ページ数が少ないのでルーターは使わず、パスで切り替える
  if (window.location.pathname === "/verify") {
    return <VerifyPage />;
  }
  return <Home />;
}

function Home() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState("");

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>("/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setError(String(e));
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (me === undefined) return <main className="container"><p>読み込み中...</p></main>;
  if (me === null) return <LoginPage />;
  return <DashboardPage me={me} onLogout={() => setMe(null)} />;
}

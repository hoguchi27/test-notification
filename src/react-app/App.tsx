import { useCallback, useEffect, useState } from "react";
import type { Me } from "../shared/types";
import { api, ApiError } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { SetPasswordPage } from "./pages/SetPasswordPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";

export function App() {
  // ページ数が少ないのでルーターは使わず、パスで切り替える
  switch (window.location.pathname) {
    case "/set-password":
      return <SetPasswordPage />;
    case "/forgot-password":
      return <ForgotPasswordPage />;
    default:
      return <Home />;
  }
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
  if (me === null) return <LoginPage onLoggedIn={loadMe} />;
  // 管理者以外が /admin を開いた場合は通常の画面を出す（API 側でも 403 にしている）
  if (window.location.pathname === "/admin" && me.role === "admin") {
    return <AdminUsersPage me={me} onLogout={() => setMe(null)} />;
  }
  return <DashboardPage me={me} onLogout={() => setMe(null)} />;
}

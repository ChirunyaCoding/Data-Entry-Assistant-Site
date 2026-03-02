
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { loadKenAllData } from "./app/lib/kenAll.ts";
import "./styles/index.css";

// アプリ表示と同時に住所マスタ読み込みを先行開始する
void loadKenAllData().catch(() => {
  // 失敗時の表示はフォーム側で行う
});

createRoot(document.getElementById("root")!).render(<App />);
  

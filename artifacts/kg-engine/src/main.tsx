import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ROOT_ELEMENT_ID } from "@/constants/app";

createRoot(document.getElementById(ROOT_ELEMENT_ID)!).render(<App />);

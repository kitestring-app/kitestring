import { useEffect } from "react";
import "./BackgroundMotion.css";

/** Keep CSS backgrounds still while either renderer is hidden. */
export function useBackgroundMotion() {
  useEffect(() => {
    const update = () => document.documentElement.classList.toggle("themes-hidden", document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.documentElement.classList.remove("themes-hidden");
    };
  }, []);
}

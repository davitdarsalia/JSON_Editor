import { FC, useEffect, useState } from "react";
import "../styles/Snackbar.css";

export const Snackbar: FC = () => {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleShowSnackbar = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string }>;
      setMessage(customEvent.detail.message);
      setVisible(true);

      setTimeout(() => {
        setVisible(false);
      }, 3000);
    };

    window.addEventListener("show-snackbar", handleShowSnackbar);
    return () => {
      window.removeEventListener("show-snackbar", handleShowSnackbar);
    };
  }, []);

  return (
    <div className={`snackbar ${visible ? "show" : ""}`}>
      <span className="snackbar-icon">✓</span>
      <span className="snackbar-text">{message}</span>
    </div>
  );
};

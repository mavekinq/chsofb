import { useEffect } from "react";

const TARGET_URL = "https://docs.google.com/spreadsheets/d/171G8dMhMLTkTEOayurEhVB8KFXmiuvLymk9XvdBhfzA/edit";

const ExcelRedirect = () => {
  useEffect(() => {
    window.location.replace(TARGET_URL);
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
      Excel sayfasina yonlendiriliyorsunuz...
    </div>
  );
};

export default ExcelRedirect;
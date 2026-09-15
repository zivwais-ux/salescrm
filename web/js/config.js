/* הגדרות המערכת. אפשר לערוך כאן, או דרך מסך "הגדרות וסנכרון" (נשמר בדפדפן). */
window.APP_CONFIG = {
  // כתובת הפרויקט ב-Supabase ומפתח ה-anon. השאירו ריק כדי לעבוד מקומית בלבד.
  supabaseUrl: "",
  supabaseAnonKey: "",
  // דלי ב-Supabase Storage שאליו נשמר קובץ האקסל המעודכן אחרי כל שינוי.
  exportBucket: "exports",
  exportPath: "sales-latest.xlsx",
  // ספריות חיצוניות (נטענות לפי דרישה, רק לייצוא/ייבוא אקסל ולסנכרון).
  xlsxCdn: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  supabaseCdn: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js",
  storageKey: "gadot_sales_crm_v1",
};

/* הגדרות המערכת. */
window.APP_CONFIG = {
  name: "BENY",
  branch: "גדות מסופים · סניף 06",
  // ספריית xlsx נטענת לפי דרישה, רק כשמייצאים או מייבאים קובץ.
  xlsxCdn: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  storageKey: "gadot_sales_crm_v1",
  themeKey: "beny_theme",
  textKey: "beny_text",

  /* סנכרון בין המכשירים. ריק = כבוי לגמרי, והמערכת מתנהגת כמו קודם:
     הכול נשמר בדפדפן הזה בלבד. המפתח כאן הוא המפתח הציבורי של Supabase —
     הוא נועד לשבת בדפדפן, ואין לו גישה לטבלה עצמה אלא דרך שתי פונקציות
     שדורשות את קוד הסנכרון. ראו supabase/0001_sync.sql. */
  sync: {
    url: "https://ghwhyrcqvivytjcafyfd.supabase.co",
    key: "sb_publishable_3h_PBDaBkQG7dv21amNwBQ_fElZy4gp",
  },
};

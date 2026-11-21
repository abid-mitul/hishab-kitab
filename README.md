# হিসাব কিতাব · Hishab Kitab

Family expense tracker (PWA) — GitHub Pages front end, Google Sheets database via Google Apps Script.

**App:** https://abid-mitul.github.io/hishab-kitab/

## Phase 1 features
- Separate PIN login for **Husband** (admin) and **Wife**; same shared data
- Add expense: amount, category, paid by (Cash / MFS / Cards / Banks), date, spent for, place/shop, note, optional receipt photo (Google Drive)
- Dashboard: month total vs budget, today, daily average, month-end forecast, vs last month, charts by category / day / payment / person / spent-for, top places, 6-month trend
- Optional category budgets + overall monthly budget; rule-based smart alerts
- Only Husband can edit/delete; Wife can flag an entry for correction
- Bulk delete (select, delete all filtered, full reset) → Recycle Bin (30-day restore, auto-purge, empty bin)
- Activity log with date/time (Husband only; never erased by resets)
- Works offline — entries queue on the phone and sync automatically
- English / বাংলা, light / dark theme, installable home-screen icon

## Backend setup
See `backend/Code.gs` header. Default PINs after `setup()`: Husband `1234`, Wife `5678` — change them in **More → Change my PIN**.

---
Developed by: Md Abid Hassan Mitul · Internal Use Only.

# Devworkspace — React Port

إعادة بناء موقع (41 صفحة) من HTML فانيليا إلى **Vite + React** — بدون أي تغيير في التصميم أو الأنيميشن أو السلوك.

## التشغيل

الشرط الوحيد: Node.js 18 أو أحدث.

```bash
npm install          # مرة واحدة (يهيّئ node_modules)
npm run dev          # → http://localhost:5199  (وضع التطوير — البورت ثابت)
```

لبيئة الإنتاج:

```bash
npm run build        # يبني dist/
npm run preview      # → http://localhost:5200  (يشغّل البناء النهائي)
```

> ملاحظة: البروكس `${'/'}api` يحوّل نداءات المتصفح إلى غيتواي الـ API محليًا على `http://127.0.0.1:3001` — شغّل `../backend` أولًا (`pnpm install && pnpm native:up && pnpm dev`). بدون الـ backend ستظهر رسائل انتهاء جلسة عند دخول الحسابات.

## الصفحات (41)

| القسم | المسارات | العدد |
|---|---|---|
| الموقع العام | `/` · `/pricing` | 2 |
| التسجيل | `/login` · `/register` · `/forgot-password` · `/reset-password` · `/invitation` · `/onboarding` | 6 |
| مساحة الشغل | `/workspace/dashboard · projects · my-tasks · clients · client · documents · document · reviews · reports · team · audit · notifications · settings · account` | 14 |
| داخل المشروع | `/project/project · project-tasks · project-task · project-review · project-activity · project-access · project-discussions · project-files · project-milestones · project-deliverables` | 10 |
| بورتال العميل | `/portal/portal-projects · portal-project · portal-deliverables · portal-review · portal-updates · portal-notifications · portal-account` | 7 |
| خاصة | `/404.html` · `/loading.html` | 2 |

- **URLs نظيفة** بدون `.html` — والامتداد القديم شغّال كمان (توافق).
- الرابط الغلط `→` صفحة 404 المصممة كلديف `404` حي.
- البورتات ثابتة في `vite.config.js` (5199 تطوير / 5200 إنتاج).

## البنية

```
devworkspace-react/
├── *.html + workspace/ + project/ + portal/   ← 41 مدخل (شells صغيرة تشير لـ src)
├── src/
│   ├── app/Doc.jsx + shell.js.txt             ← محرك العرض (يحوّل الماركُب الأصلي)
│   ├── components/ · pages/ · lib/ · styles/  ← الكود الفعلي
│   └── pages/*/*/page.js.txt                  ← سلوك الصفحة الأصلي (يُقرا وقت التشغيل bـ ?raw)
├── tools/gen-app-pages.py                     ← مولّد الصفحات من الأصل الفانيليا
└── vite.config.js                             ← البروك cleanUrls + 404 + البورتات
```

## نقاط مهمة عن المحتوى

- **كل الصفحات مربوطة بالـ backend الفعلي** عبر `src/lib/api.js` (جلسات بكوكي `__Host-devworkspace.session_token`، CSRF، `If-Match` للتحقق من التغييرات المتزامنة، و`Idempotency-Key`).
- بيانات تسجيل الدخول التجريبية: `demo@agency.com` / `Password123!` (التسجيل الحقيقي + التفعيل عبر Mailpit المحلي).
- آخر صفحة تُربط بالـ API الحقيقية كانت `/workspace/audit` (سجل التدقيق للإدارة فقط — ينعادي `GET /organizations/{id}/audit`).
- صفحة `loading.html` نسخة عرض منفصلة (مفيش حاجة بتفتحها من التطبيق).

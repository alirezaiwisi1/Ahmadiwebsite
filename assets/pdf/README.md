# منابع PDF

این پوشه محل قرارگیری فایل‌های PDF کتاب‌هاست. پیوندهای مستقیم کاربران را به مرورگر
طبیعی خود ارجاع می‌دهند و نیازی به کتاب‌خوان داخلی نیست.

## فایل‌های مورد انتظار

| فایل |
| --- |
| `The_Mahdis_Manifesto_Booklet_Farsi.pdf` |
| `The-Mahdis-Manifesto.pdf` |
| `The-Goal-of-the-Wise-Persian.pdf` |

## روش افزودن

از ریشهٔ پروژه:

```bash
mkdir -p assets/pdf
cp sources/*.pdf assets/pdf/
git add assets/pdf && git commit -m "Add book PDFs" && git push
```

توجه: پوشهٔ `sources/` در `.gitignore` است و هرگز نباید به مخزن اضافه شود؛ تنها نسخهٔ
کپی‌شده در `assets/pdf/` منتشر می‌شود.

# منابع PDF برای کتاب‌خوان داخلی

این پوشه محل قرارگیری فایل‌های PDF کتاب‌هاست تا کتاب‌خوان (`reader.html`) بتواند آن‌ها را
بدون دانلود، مستقیم داخل وب‌سایت نمایش دهد.

## فایل‌های مورد انتظار

| فایل | شناسه در `index.json` |
| --- | --- |
| `The_Mahdis_Manifesto_Booklet_Farsi.pdf` | `manifesto-fa` |
| `The-Mahdis-Manifesto.pdf` | `manifesto-en` |
| `Hadaf-Hakim.pdf` | `hadaf-hakim` (اختیاری) |

## روش افزودن (یک دستور)

از ریشهٔ پروژه:

```bash
mkdir -p assets/pdf
cp sources/The_Mahdis_Manifesto_Booklet_Farsi.pdf sources/The-Mahdis-Manifesto.pdf assets/pdf/
git add assets/pdf && git commit -m "Add book PDFs for the built-in reader" && git push
```

توجه: پوشهٔ `sources/` در `.gitignore` است و هرگز نباید به مخزن اضافه شود؛ تنها نسخهٔ
کپی‌شده در `assets/pdf/` منتشر می‌شود.

## رفتار کتاب‌خوان بدون فایل محلی

اگر فایلی در این پوشه نباشد، کتاب‌خوان به‌ترتیب به منبع بعدی (لینک دانلود رسمی)
تلاش می‌کند؛ اگر آن هم در دسترس نباشد (مثلاً به‌دلیل محدودیت CORS)، پیام خطای
منظم با دکمهٔ «دانلود مستقیم» نمایش داده می‌شود و لینک‌های تلگرام همچنان معتبرند.

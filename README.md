# C Mastery for Reverse Engineers — لغة C من الصفر للاحتراف ⚙️

كورس C تفاعلي بالعربي (RTL)، من الصفر لحد مستوى المحترف، ومصمم خصيصًا لـ **الـ Reverse Engineering وتحليل الـ Malware**: مش بس تكتب C، لكن تفهم هي بتتحول لإيه في الذاكرة وفي الـ Assembly.

> الأكواد وأسماء المتغيرات والمخرجات **بالإنجليزية**، والشرح **بالعربي**.

## المحتوى

| الجزء | المراحل |
|---|---|
| **1 · الأساسيات** | الأدوات ومراحل الـ compilation · الأنواع وتمثيل البيانات (two's complement، endianness، IEEE-754) · العمليات والـ bitwise · التحكم في التدفق (jump tables) · الدوال والـ scope · الـ arrays والـ strings |
| **2 · الذاكرة والبوينترز** | الـ pointers · pointers متقدمة (void*، function pointers، dynamic API resolution) · خريطة الذاكرة والـ heap · structs/unions (struct recovery) · الـ preprocessor والمشاريع متعددة الملفات · الملفات والـ binary parsing الآمن |
| **3 · C تحت المجهر** | Assembly x86-64 (وتكتب Assembly بنفسك) · من C لـ Assembly (stack frames، calling conventions، magic numbers) · UB والثغرات والحمايات · PE/ELF والـ linking · C على Windows للمحلل |
| **4 · التطبيق والمرجع** | 8 مشاريع (hexdump، strings، Base64، RC4، XOR brute-force، PE parser على header حقيقي، crackme + keygen، bytecode VM) · Cheat Sheet · مصادر وخريطة طريق |

- **98 سؤال تفاعلي** بشرح للإجابة.
- **41 تحدي كود** بيتصحح أوتوماتيك (منهم تحديات بتكتب فيها Assembly بإيدك).
- **8 مشاريع** بحلول مرجعية كاملة شغّالة.
- **108 مثال كود** — **82 قابل للتشغيل**، وكلهم عليهم زرار **⚙ ASM** بيعرض الـ Assembly بـ `-O0/-O1/-O2/-Os`.
- تتبّع التقدم، وضع داكن/فاتح، تحكم في حجم الخط، بحث، ومحوّل أنظمة عددية تفاعلي.

## إزاي التشغيل بيشتغل

الصفحة **static بالكامل** (مفيش server)، فبتشتغل على GitHub Pages أو أي استضافة ثابتة:

- زرار **تشغيل** و**ASM** بيبعتوا الكود لـ [Compiler Explorer](https://godbolt.org) (x86-64 gcc 15.2، Linux) ويعرضوا النتيجة. محتاج إنترنت، ومتحطش بيانات سرية في الكود.
- كل مثال جوه الصفحة معاه **مخرجات متحقق منها مسبقًا** بتظهر لو مفيش اتصال.
- التقدّم بيتحفظ في `localStorage` تحت `cMastery.v1`.

## النشر على GitHub Pages

```bash
git remote add origin https://github.com/<your-user>/c-mastery.git
git push -u origin main
```

بعدين من GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save**. بعد دقيقة الكورس هيبقى على:

```
https://<your-user>.github.io/c-mastery/
```

## التطوير: الـ build والتحقق

المحتوى بيتكتب في `src/sections/*.html` بـ tags مختصرة (`<c-example>`، `<quiz>`، `<challenge>`)، و`tools/build.py` بيحوّلها لـ `index.html` **وبيتحقق من كل حاجة**:

1. كل مثال وكل حل وكل starter بيتعمله compile بـ gcc المحلي: `-std=c17 -Wall -Wextra -Werror`.
2. كل مثال قابل للتشغيل بيتنفذ فعليًا على Compiler Explorer، والمخرجات الحقيقية بتتحفظ في الصفحة.
3. كل حل لتحدي لازم مخرجاته تطابق المطلوب حرف بحرف.
4. فهارس إجابات الأسئلة، الـ IDs، والروابط الداخلية بيتشيك عليها.

أي فشل = الـ build بيقف ومفيش `index.html` بايظ بيتكتب.

```bash
python tools/build.py            # build + verify (uses tools/.ce-cache.json)
python tools/build.py --offline  # skip Compiler Explorer for uncached code
```

المتطلبات: Python 3.9+ و gcc (على Windows: MSYS2 UCRT64).

### هيكل الملفات

```
c-mastery/
├── index.html              الصفحة النهائية (generated — متعدلهاش يدوي)
├── assets/
│   ├── app.js              المحرك: التشغيل عبر Compiler Explorer، ASM viewer، التصحيح، التقدم
│   ├── effects.js          التأثيرات، خلفية الـ hex، التحكم في حجم الخط
│   ├── styles.css          التصميم الأساسي
│   ├── effects.css         طبقة التأثيرات
│   ├── c.css               مكونات الكورس (ASM panel، memory diagrams، converter)
│   └── theme.css           طبقة الهوية والراحة البصرية
├── src/
│   ├── template.html       هيكل الصفحة
│   └── sections/           الدروس (00 → 19)
└── tools/
    ├── build.py            الـ build والتحقق
    ├── pe_header_bytes.txt bytes حقيقية من PE header (مشروع 06)
    └── .ce-cache.json      cache لنتايج Compiler Explorer
```

## ملاحظة أمان

كل الأكواد تعليمية وآمنة. لما تبدأ تحلل samples حقيقية: **VM معزولة دايمًا** (FLARE-VM / REMnux)، من غير shared folders، ومع snapshots نضيفة.

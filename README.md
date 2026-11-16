# AetherFlow Agent Studio — راهنمای نصب و راه‌اندازی روی سرور لینوکس

پلتفرم چندعاملی هوشمند **AetherFlow Agent Studio** (بوم گره‌محور React Flow، چت گروهی زنده، باگ‌رپورت، نظارت خودکار مدیر، اتصال مخازن GitHub / ZIP، و سندباکس اجرای کد) آماده استقرار روی سرورهای لینوکس (Ubuntu / Debian / RHEL / Rocky / Alma / Alpine) است.

---

## ۱. لینک نصب فوری با یک دستور روی سرور لینوکس (نصب اولیه)

اسکریپت نصب به‌طور خودکار تمام پیش‌نیازهای لازم شامل `git`، `curl`، `python3` و بسته به روش انتخابی **Node.js 22 LTS** یا **Docker Engine + Compose** را نصب کرده و پروژه را از مخزن رسمی کلون، بیلد و اجرا می‌کند:

### حالت خودکار (Auto: در صورت وجود داکر با Docker، وگرنه Native + سرویس `systemd`):
```bash
curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash
```

### نصب با سرویس دائمی لینوکس (`systemd` + نصب خودکار Node.js 22):
```bash
curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --systemd
```

### نصب و اتصال خودکار دامنه + گواهی HTTPS (Nginx + Let's Encrypt):
اسکریپت نصب هنگام نصب اولیه به‌صورت خودکار **نام دامنه (و ایمیل اختیاری)** را از شما می‌پرسد تا **Nginx Reverse Proxy** و گواهی رایگان **HTTPS SSL** را تنظیم و فعال کند (برای رد کردن این مرحله کافیست کلید Enter را بزنید یا فلگ `--no-domain` را بدهید):
```bash
curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --systemd
```
یا تعیین مستقیم دامنه در دستور نصب:
```bash
curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --systemd --domain studio.example.com
```

### نصب با Docker Compose (نصب خودکار Docker Engine در صورت نبودن):
```bash
curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --docker
```

### تنظیم پورت دلخواه (مثلاً پورت `8080`)، مسیر نصب یا نصب بدون سوال (`--no-domain`):
```bash
curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --systemd --dir /opt/aetherflow-studio --port 8080 --no-domain
```

---

## ۲. لینک آپدیت سریع (بدون درخواست مشخصات و بدون تغییر تنظیمات قبلی)

اگر نرم‌افزار قبلاً روی سرور نصب شده و می‌خواهید **فقط آخرین تغییرات را از گیت‌هاب بگیرید و آپدیت کنید** (بدون پرسیدن دوباره دامنه، ایمیل، پورت یا تنظیمات، و با حفظ کامل فایل `.env`، دیتابیس SQLite، کلیدهای API، پروژه‌های آفلاین و گواهی SSL):

```bash
curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --update
```

یا از داخل پوشه پروژه روی سرور:
```bash
./install-linux.sh --update
```

این دستور به‌صورت خودکار حالت نصب فعلی (`systemd` یا `Docker`) و مسیر نصب قبلی را تشخیص می‌دهد، آخرین نسخه کدها را دریافت و بیلد می‌کند و سرویس را بدون هیچ سوالی ری‌استارت می‌نماید.

---

## پیش‌نیازهای نصب (تامین‌شده توسط اسکریپت)
- **سیستم‌عامل‌های پشتیبانی‌شده:** Ubuntu 20.04/22.04/24.04، Debian 11/12، Rocky/Alma/RHEL/Fedora، و Alpine Linux
- **ابزارهای پایه:** `git`، `curl`، `ca-certificates`، `python3`، `python3-pip` و کامپایلر `build-essential`
- **محیط اجرا:** **Node.js v22+** (برای پشتیبانی بومی `node:sqlite`) یا **Docker + Docker Compose v2**

---

## مدیریت سرویس روی سرور لینوکس

مدیریت سرویس `systemd`:
```bash
sudo systemctl status aetherflow-studio
sudo systemctl restart aetherflow-studio
sudo journalctl -u aetherflow-studio -f
```

---

## متغیرهای محیطی (`.env`)

پس از نصب، فایل `.env` در مسیر پروژه ساخته می‌شود (`/opt/aetherflow-studio/.env` یا `~/aetherflow-studio/.env`):

| متغیر | توضیح |
|---|---|
| `PORT` | پورت اجرا روی سرور (پیش‌فرض `3000`) |
| `GEMINI_API_KEY` | کلید Google AI Studio برای اجرای زنده ایجنت‌ها و آنالیز مدیر |
| `OPENAI_API_KEY` | کلید OpenAI (اختیاری) |
| `ANTHROPIC_API_KEY` | کلید Anthropic Claude (اختیاری) |
| `OPENCODE_API_KEY` | کلید OpenCode Zen (اختیاری — مدل‌های رایگان بدون کلید هم کار می‌کنند) |
| `OLLAMA_BASE_URL` | آدرس سرور Ollama محلی (پیش‌فرض `http://host.docker.internal:11434`) |

# AetherFlow Studio — راهنمای نصب و راه‌اندازی روی سرور لینوکس

پلتفرم چندعاملی هوشمند **AetherFlow Studio** (بوم گره‌محور React Flow، چت گروهی زنده، باگ‌رپورت، نظارت خودکار مدیر، اتصال مخازن GitHub / ZIP، و سندباکس اجرای کد) آماده استقرار روی سرورهای لینوکس (Ubuntu / Debian / RHEL / Docker) است.

---

## روش اول: نصب یک‌مرحله‌ای با Docker Compose (پیشنهادی)

پیش‌نیاز: نصب بودن **Docker** و **Docker Compose v2** روی سرور لینوکس.

```bash
# ۱. تنظیم متغیرهای محیطی (کلیدهای API اختیاری در حالت Sandbox Dry-Run)
cp .env.example .env
nano .env

# ۲. اجرا با اسکریپت خودکار یا مستقیم با Docker Compose
chmod +x install-linux.sh
./install-linux.sh --docker
# یا مستقیماً:
docker compose up -d --build
```

- پورت پیش‌فرض: `http://<SERVER-IP>:3000`
- دیتابیس SQLite، فایل‌های سندباکس و پروژه‌های واردشده در Volumeهای دائمی داکر ذخیره می‌شوند.
- برای اتصال به **Ollama** نصب‌شده روی هاست لینوکس، مقدار پیش‌فرض `OLLAMA_BASE_URL=http://host.docker.internal:11434` از قبل تنظیم شده است.

---

## روش دوم: نصب مستقیم (Native) و سرویس دائمی systemd

پیش‌نیاز: **Node.js 22+** (برای پشتیبانی بومی `node:sqlite`)، `git` و `python3`.

```bash
# بررسی پیش‌نیازهای سیستم بدون تغییر فایل‌ها
chmod +x install-linux.sh
./install-linux.sh --check

# نصب وابستگی‌ها، بیلد نسخه Production و اجرا
./install-linux.sh --native

# نصب به عنوان سرویس پس‌زمینه دائمی در لینوکس (systemd)
./install-linux.sh --systemd
```

مدیریت سرویس پس از نصب `systemd`:
```bash
sudo systemctl status aetherflow-studio
sudo systemctl restart aetherflow-studio
sudo journalctl -u aetherflow-studio -f
```

---

## متغیرهای محیطی (`.env`)

| متغیر | توضیح |
|---|---|
| `PORT` | پورت اجرا روی سرور (پیش‌فرض `3000`) |
| `GEMINI_API_KEY` | کلید Google AI Studio برای اجرای زنده ایجنت‌ها و آنالیز مدیر |
| `OPENAI_API_KEY` | کلید OpenAI (اختیاری) |
| `ANTHROPIC_API_KEY` | کلید Anthropic Claude (اختیاری) |
| `OPENCODE_API_KEY` | کلید OpenCode Zen (اختیاری — مدل‌های رایگان بدون کلید هم کار می‌کنند) |
| `OLLAMA_BASE_URL` | آدرس سرور Ollama محلی (پیش‌فرض `http://host.docker.internal:11434`) |

---

## پشته جایگزین Python FastAPI + Docker SDK (`deploy/`)

فایل‌های مرجع پایتون (FastAPI + LiteLLM + AutoGen + Docker SDK Sandbox + Nginx) نیز در پوشه `deploy/` همراه با کانفیگ `deploy/frontend/nginx.conf` قرار دارند:

```bash
cp deploy/.env.example deploy/.env
cd deploy && docker compose up -d --build
```

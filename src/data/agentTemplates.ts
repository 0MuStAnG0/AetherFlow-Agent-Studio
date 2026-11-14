import type {
  AgentNodeData,
  AgentPowerLevel,
  AgentRole,
  LLMProvider,
  WorkflowConfig,
} from '../types/workflow';

export interface AgentRoleTemplate {
  id: string;
  role: AgentRole;
  title: string;
  subtitle: string;
  section: string;
  positionTitle: string;
  responsibility: string;
  powerLevel: AgentPowerLevel;
  defaultProvider: LLMProvider;
  defaultModel: string;
  defaultTemperature: number;
  defaultTools: AgentNodeData['tools'];
  systemPrompt: string;
}

export interface AgentSpecialtyPreset {
  id: string;
  section: string;
  role: AgentRole;
  enTitle: string;
  faTitle: string;
  enPosition: string;
  faPosition: string;
  enResponsibility: string;
  faResponsibility: string;
  powerLevel: AgentPowerLevel;
  defaultTools: AgentNodeData['tools'];
  systemPrompt: string;
}

export const AGENT_SECTIONS: Array<{ id: string; en: string; fa: string }> = [
  { id: 'Architecture & Management', en: 'Architecture & Management', fa: 'معماری و مدیریت پروژه' },
  { id: 'Backend & API', en: 'Backend & API', fa: 'بک‌اند و توسعه API' },
  { id: 'Frontend & UI', en: 'Frontend & UI', fa: 'فرانت‌اند و رابط کاربری' },
  { id: 'Full-Stack & Integration', en: 'Full-Stack & Integration', fa: 'فول‌استک و یکپارچه‌سازی' },
  { id: 'Database & Storage', en: 'Database, SQL & Storage', fa: 'دیتابیس، SQL و ذخیره‌سازی' },
  { id: 'Authentication & RBAC', en: 'Authentication, Identity & RBAC', fa: 'احراز هویت، دسترسی و RBAC' },
  { id: 'Security & QA', en: 'Security, AppSec & PenTest', fa: 'امنیت سایبری، AppSec و تست نفوذ' },
  { id: 'QA & Automated Testing', en: 'QA, Automated Testing & E2E', fa: 'تضمین کیفیت، تست خودکار و E2E' },
  { id: 'DevOps & Sandbox', en: 'DevOps, Docker & Linux Server', fa: 'DevOps، داکر، CI/CD و سرور لینوکس' },
  { id: 'Cloud & SRE', en: 'Cloud Infrastructure, K8s & SRE', fa: 'زیرساخت ابری، کوبرنتیز و SRE' },
  { id: 'AI & Prompts', en: 'AI, LLM Agents, RAG & Prompts', fa: 'هوش مصنوعی، ایجنت‌ها، RAG و پرامپت' },
  { id: 'Data Science & ML', en: 'Data Engineering, ML & Analytics', fa: 'مهندسی داده، یادگیری ماشین و تحلیل' },
  { id: 'Payments & Fintech', en: 'Payments, Fintech & Billing', fa: 'درگاه پرداخت، فین‌تک و تراکنش مالی' },
  { id: 'Messaging & Realtime', en: 'Messaging, Queues & Bots', fa: 'صف پیام، وب‌سوکت و بات‌ها' },
  { id: 'Mobile & Edge', en: 'Mobile, React Native, Flutter & PWA', fa: 'موبایل، فلاتر، React Native و PWA' },
  { id: 'UI/UX & Accessibility', en: 'UI/UX Design, Accessibility & RTL', fa: 'طراحی UI/UX، دسترس‌پذیری و فارسی‌سازی' },
  { id: 'Performance & Caching', en: 'Performance, Caching & Scalability', fa: 'بهینه‌سازی سرعت، کش و مقیاس‌پذیری' },
  { id: 'SEO & Web Vitals', en: 'SEO, Core Web Vitals & Growth', fa: 'سئو فنی، سرعت وب و ساختار داده' },
  { id: 'Blockchain & Web3', en: 'Blockchain, Web3 & Smart Contracts', fa: 'بلاکچین، Web3 و قرارداد هوشمند' },
  { id: 'Product & Research', en: 'Product, Documentation & OpenAPI', fa: 'مدیریت محصول، مستندسازی و OpenAPI' },
];

export const AGENT_SPECIALTY_PRESETS: AgentSpecialtyPreset[] = [
  // 1. Architecture & Management
  {
    id: 'spec-lead-architect',
    section: 'Architecture & Management',
    role: 'manager',
    enTitle: 'Manager & Lead Architect',
    faTitle: 'ایجنت مدیر و معمار ارشد سیستم',
    enPosition: 'Lead Software Architect & Engineering Manager',
    faPosition: 'معمار ارشد نرم‌افزار و مدیر فنی پروژه',
    enResponsibility: 'Break down tasks, inspect team outputs during Test & Deploy, and delegate fixes to domain agents.',
    faResponsibility: 'خرد کردن وظایف، بررسی و آنالیز دقیق خروجی تیم در تست و دپلوی و ارجاع مشکلات به ایجنت مربوطه.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: false, execBash: false },
    systemPrompt:
      'You are the Lead Software Architect & Engineering Manager. Break user tasks into clear milestones, audit all sandbox files and test outputs, and delegate any defect to the responsible specialist.',
  },
  {
    id: 'spec-microservices-architect',
    section: 'Architecture & Management',
    role: 'manager',
    enTitle: 'Microservices & DDD Architect',
    faTitle: 'معمار میکروسرویس و طراحی دامنه (DDD)',
    enPosition: 'Principal Distributed Systems Architect',
    faPosition: 'معمار سیستم‌های توزیع‌شده و میکروسرویس',
    enResponsibility: 'Define service boundaries, API contracts, event schemas, and inter-service resilience.',
    faResponsibility: 'طراحی مرز سرویس‌ها، قراردادهای API، معماری رویدادمحور و پایداری سیستم.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal Distributed Systems & DDD Architect. Design clean service boundaries, OpenAPI/AsyncAPI contracts, and fault-tolerant architectures.',
  },
  // 2. Backend & API
  {
    id: 'spec-backend-python',
    section: 'Backend & API',
    role: 'backend',
    enTitle: 'Python / FastAPI / Django Specialist',
    faTitle: 'متخصص بک‌اند Python / FastAPI / Django',
    enPosition: 'Senior Python Backend Engineer',
    faPosition: 'مهندس ارشد بک‌اند پایتون (FastAPI / Django)',
    enResponsibility: 'Build async REST/WebSocket endpoints, Pydantic schemas, and clean service layers.',
    faResponsibility: 'پیاده‌سازی APIهای سریع، اعتبارسنجی Pydantic، منطق دامنه و سرویس‌های بک‌اند پایتون.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Python Backend Engineer specializing in FastAPI, Django, Pydantic v2, and async services. Write validated, production-grade backend modules.',
  },
  {
    id: 'spec-backend-node',
    section: 'Backend & API',
    role: 'backend',
    enTitle: 'Node.js / TypeScript / NestJS Specialist',
    faTitle: 'متخصص بک‌اند Node.js / TypeScript / Express',
    enPosition: 'Senior Node.js & TypeScript API Engineer',
    faPosition: 'مهندس ارشد بک‌اند Node.js و TypeScript',
    enResponsibility: 'Develop Express/NestJS/Fastify APIs, middleware, strict TypeScript types, and error handling.',
    faResponsibility: 'توسعه سرویس‌های Node.js و TypeScript با ساختار ماژولار، میان‌افزارهای امن و مدیریت خطا.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Node.js & TypeScript Backend Engineer. Build strongly-typed Express/NestJS APIs with strict input validation and structured error responses.',
  },
  {
    id: 'spec-backend-go-rust',
    section: 'Backend & API',
    role: 'backend',
    enTitle: 'Go (Golang) & Rust Systems Engineer',
    faTitle: 'متخصص سیستم‌های سریع Go و Rust',
    enPosition: 'Staff Golang / Rust Backend Engineer',
    faPosition: 'مهندس ارشد سرویس‌های پرترافیک Go و Rust',
    enResponsibility: 'Build high-concurrency microservices, gRPC servers, and memory-safe backend workers.',
    faResponsibility: 'پیاده‌سازی میکروسرویس‌های پرترافیک، هم‌زمانی بالا و پردازش سریع با Go و Rust.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Staff Systems Engineer specializing in Go (Golang) and Rust. Write high-throughput, concurrency-safe services with explicit error handling.',
  },
  {
    id: 'spec-graphql-grpc',
    section: 'Backend & API',
    role: 'backend',
    enTitle: 'GraphQL & gRPC API Specialist',
    faTitle: 'متخصص طراحی GraphQL و gRPC',
    enPosition: 'Principal API & Protocol Architect',
    faPosition: 'طراح و متخصص پروتکل‌های GraphQL و gRPC',
    enResponsibility: 'Design GraphQL schemas, resolvers, dataloader batching, and Protobuf gRPC services.',
    faResponsibility: 'طراحی اسکیمای GraphQL، رفع مشکل N+1 و پیاده‌سازی سرویس‌های Protobuf / gRPC.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are an API Protocol Specialist in GraphQL, REST OpenAPI, and gRPC/Protobuf. Optimize resolvers, schema evolution, and type safety.',
  },
  // 3. Frontend & UI
  {
    id: 'spec-frontend-react',
    section: 'Frontend & UI',
    role: 'frontend',
    enTitle: 'React / Next.js / TypeScript Specialist',
    faTitle: 'متخصص فرانت‌اند React و Next.js',
    enPosition: 'Principal React & Next.js Engineer',
    faPosition: 'مهندس ارشد فرانت‌اند React، Next.js و TypeScript',
    enResponsibility: 'Build modular React components, hooks, SSR/SPA routing, and Tailwind CSS interfaces.',
    faResponsibility: 'توسعه کامپوننت‌های ماژولار React و Next.js با تایپ‌اسکریپت و استایل Tailwind CSS.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal React, Next.js, and TypeScript Frontend Engineer. Build accessible, responsive Tailwind CSS components with clean state management.',
  },
  {
    id: 'spec-frontend-vue-angular',
    section: 'Frontend & UI',
    role: 'frontend',
    enTitle: 'Vue.js / Nuxt & Angular Specialist',
    faTitle: 'متخصص فرانت‌اند Vue.js / Nuxt و Angular',
    enPosition: 'Senior Vue / Angular Frontend Architect',
    faPosition: 'مهندس ارشد فرانت‌اند Vue.js و Angular',
    enResponsibility: 'Develop reactive SPA/SSR views, Pinia/RxJS state stores, and component libraries.',
    faResponsibility: 'توسعه رابط کاربری واکنش‌گرا و مدیریت State پیشرفته در پروژه‌های Vue و Angular.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Frontend Architect specializing in Vue 3 / Nuxt and Angular. Build clean, reactive, well-typed components and stores.',
  },
  // 4. Full-Stack & Integration
  {
    id: 'spec-fullstack-integrator',
    section: 'Full-Stack & Integration',
    role: 'custom',
    enTitle: 'Full-Stack & End-to-End Integrator',
    faTitle: 'مهندس فول‌استک و یکپارچه‌سازی فرانت و بک‌اند',
    enPosition: 'Lead Full-Stack Integration Engineer',
    faPosition: 'مهندس ارشد فول‌استک و اتصال API به رابط کاربری',
    enResponsibility: 'Bridge backend APIs and frontend views, synchronize types, and wire WebSockets & webhooks.',
    faResponsibility: 'اتصال کامل APIهای بک‌اند به فرانت‌اند، هماهنگ‌سازی تایپ‌ها و ارتباط زنده WebSocket.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Lead Full-Stack Integration Engineer. Ensure seamless contract alignment between backend routes, database models, and frontend UI state.',
  },
  // 5. Database & Storage
  {
    id: 'spec-db-postgres-sql',
    section: 'Database & Storage',
    role: 'backend',
    enTitle: 'PostgreSQL / MySQL / SQLite Architect',
    faTitle: 'معمار دیتابیس SQL (Postgres / MySQL / SQLite)',
    enPosition: 'Principal Database & SQL Optimization Architect',
    faPosition: 'معمار ارشد دیتابیس، طراحی جداول و بهینه‌سازی کوئری SQL',
    enResponsibility: 'Design normalized schemas, indexes, migrations, transactions, and high-speed SQL queries.',
    faResponsibility: 'طراحی جداول، ایندکس‌گذاری، مایگریشن، تراکنش‌های ACID و بهینه‌سازی کوئری‌های سنگین.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal Database & SQL Architect. Design normalized schemas, composite indexes, safe migrations, and deadlock-free transactions.',
  },
  {
    id: 'spec-db-redis-nosql',
    section: 'Database & Storage',
    role: 'backend',
    enTitle: 'Redis, MongoDB & Vector DB Specialist',
    faTitle: 'متخصص کش Redis، دیتابیس NoSQL و Vector DB',
    enPosition: 'Senior NoSQL, Caching & Vector Storage Engineer',
    faPosition: 'متخصص ذخیره‌سازی NoSQL، کش توزیع‌شده Redis و دیتابیس برداری',
    enResponsibility: 'Implement Redis caching strategies, rate limiters, MongoDB pipelines, and pgvector/Qdrant.',
    faResponsibility: 'پیاده‌سازی کشینگ هوشمند Redis، محدودکننده نرخ درخواست و دیتابیس‌های NoSQL و برداری.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior NoSQL, Redis Caching, and Vector Database Engineer. Design low-latency cache invalidation, distributed locks, and vector indexes.',
  },
  // 6. Authentication & RBAC
  {
    id: 'spec-auth-rbac',
    section: 'Authentication & RBAC',
    role: 'security_qa',
    enTitle: 'Auth, OAuth2, JWT & RBAC Specialist',
    faTitle: 'متخصص احراز هویت (OAuth2 / JWT) و سطح دسترسی RBAC',
    enPosition: 'Identity, Authentication & Access Control Architect',
    faPosition: 'معمار احراز هویت، مدیریت نشست و کنترل دسترسی نقش‌محور (RBAC)',
    enResponsibility: 'Implement OAuth2/OIDC, secure JWT/cookie sessions, 2FA, and granular multi-role permissions.',
    faResponsibility: 'پیاده‌سازی لاگین امن، OAuth2، مدیریت توکن‌ها و تعریف دقیق مجوزهای دسترسی هر نقش کاربری.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are an Identity, Authentication & RBAC Security Architect. Implement secure session management, OAuth2 flows, password hashing, and strict role-based access control.',
  },
  // 7. Security & QA
  {
    id: 'spec-sec-owasp',
    section: 'Security & QA',
    role: 'security_qa',
    enTitle: 'OWASP AppSec & Vulnerability Auditor',
    faTitle: 'بازرس امنیت کد (OWASP) و تست نفوذ',
    enPosition: 'Principal Application Security & PenTest Auditor',
    faPosition: 'بازرس ارشد امنیت نرم‌افزار، کشف آسیب‌پذیری و تست نفوذ',
    enResponsibility: 'Audit code for SQLi, XSS, SSRF, path traversal, secret leaks, and harden security headers.',
    faResponsibility: 'بررسی امنیتی کد برای جلوگیری از نفوذ، تزریق کد، نشت کلیدهای محرمانه و آسیب‌پذیری‌های OWASP.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal Application Security & Penetration Testing Auditor. Audit all code against OWASP Top 10 risks, eliminate injection vectors, and enforce least privilege.',
  },
  // 8. QA & Automated Testing
  {
    id: 'spec-qa-unit-integration',
    section: 'QA & Automated Testing',
    role: 'security_qa',
    enTitle: 'Unit & Integration Test Engineer',
    faTitle: 'متخصص تست واحد (Unit) و تست یکپارچه‌سازی',
    enPosition: 'Senior Automated QA & Test Suite Engineer',
    faPosition: 'مهندس ارشد تضمین کیفیت و نوشتن تست‌های خودکار (Pytest / Vitest)',
    enResponsibility: 'Write deterministic unit, API integration, and regression test suites covering edge cases.',
    faResponsibility: 'نوشتن تست‌های دقیق واحد و یکپارچه‌سازی برای پوشش کامل سناریوهای عادی و مرزی.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: true },
    systemPrompt:
      'You are a Senior Automated QA Engineer. Write deterministic unit and integration tests using pytest, node:test, or vitest covering happy paths and edge cases.',
  },
  {
    id: 'spec-qa-e2e-playwright',
    section: 'QA & Automated Testing',
    role: 'security_qa',
    enTitle: 'Playwright E2E & Load Test Specialist',
    faTitle: 'متخصص تست End-to-End مرورگر (Playwright) و تست بار',
    enPosition: 'Lead E2E Browser & Performance Test Engineer',
    faPosition: 'متخصص تست خودکار مرورگر با Playwright و تست استرس/بار',
    enResponsibility: 'Build automated Playwright user-journey checks and k6/Locust API stress benchmarks.',
    faResponsibility: 'شبیه‌سازی رفتار واقعی کاربر در مرورگر و سنجش پایداری سیستم زیر بار ترافیکی.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: true },
    systemPrompt:
      'You are a Lead E2E & Performance Test Engineer. Create reliable Playwright browser tests and API load benchmarks with zero flaky selectors.',
  },
  // 9. DevOps & Sandbox
  {
    id: 'spec-devops-linux-docker',
    section: 'DevOps & Sandbox',
    role: 'executor',
    enTitle: 'Linux Server, Docker & Bash Executor',
    faTitle: 'متخصص سرور لینوکس، Docker و اجرای سندباکس',
    enPosition: 'Senior Linux Systems & Docker DevOps Engineer',
    faPosition: 'مهندس ارشد سرور لینوکس، Docker Compose، Nginx و systemd',
    enResponsibility: 'Write Dockerfiles, Linux install scripts, systemd services, and run sandbox verification.',
    faResponsibility: 'آماده‌سازی اسکریپت‌های نصب لینوکس، کانتینرهای Docker، سرویس‌های systemd و اجرای تست در سندباکس.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: true },
    systemPrompt:
      'You are a Senior Linux Systems & Docker DevOps Engineer. Build hardened Dockerfiles, idempotent Bash installers, Nginx configs, and verify builds inside the Linux sandbox.',
  },
  {
    id: 'spec-devops-cicd',
    section: 'DevOps & Sandbox',
    role: 'executor',
    enTitle: 'CI/CD Pipelines (GitHub Actions / GitLab CI)',
    faTitle: 'متخصص پایپ‌لاین CI/CD و استقرار خودکار گیت‌هاب',
    enPosition: 'Principal CI/CD & Release Automation Engineer',
    faPosition: 'مهندس استقرار خودکار (GitHub Actions / GitLab CI) و انتشار نسخه',
    enResponsibility: 'Create automated test, build, container registry, and zero-downtime deployment workflows.',
    faResponsibility: 'طراحی پایپ‌لاین‌های تست، بیلد و دپلوی خودکار بدون قطعی سرویس در گیت‌هاب و سرور.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal CI/CD & Release Automation Engineer. Author fast, cached, secure GitHub Actions and GitLab CI pipelines.',
  },
  // 10. Cloud & SRE
  {
    id: 'spec-cloud-k8s-sre',
    section: 'Cloud & SRE',
    role: 'executor',
    enTitle: 'Kubernetes, Terraform & SRE Specialist',
    faTitle: 'متخصص کوبرنتیز (K8s)، زیرساخت ابری و SRE',
    enPosition: 'Staff Cloud Infrastructure & Site Reliability Engineer',
    faPosition: 'مهندس قابلیت اطمینان سایت (SRE)، مانیتورینگ و Kubernetes',
    enResponsibility: 'Configure Kubernetes manifests, Terraform IaC, health probes, and Prometheus/Grafana alerts.',
    faResponsibility: 'مدیریت کلاستر کوبرنتیز، زیرساخت کدنویسی‌شده (IaC)، لاگینگ و مانیتورینگ سلامت سرویس.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Staff Cloud Infrastructure & SRE Engineer. Design resilient Kubernetes deployments, Terraform modules, and observability metrics.',
  },
  // 11. AI & Prompts
  {
    id: 'spec-ai-rag-agents',
    section: 'AI & Prompts',
    role: 'custom',
    enTitle: 'LLM Multi-Agent, RAG & Prompt Architect',
    faTitle: 'متخصص هوش مصنوعی، RAG و مهندسی پرامپت',
    enPosition: 'Principal AI Agent & RAG Pipeline Architect',
    faPosition: 'معمار سیستم‌های هوشمند، جستجوی برداری (RAG) و بهینه‌سازی پرامپت',
    enResponsibility: 'Design structured LLM prompts, function calling schemas, RAG retrieval, and AI guardrails.',
    faResponsibility: 'طراحی پرامپت‌های مهندسی‌شده، اتصال ابزارها به مدل‌های زبانی، پایپ‌لاین RAG و جلوگیری از خطای مدل.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal AI Agent & Prompt Engineering Architect. Design deterministic system prompts, JSON schema outputs, tool-calling workflows, and RAG pipelines.',
  },
  // 12. Data Science & ML
  {
    id: 'spec-data-etl-ml',
    section: 'Data Science & ML',
    role: 'custom',
    enTitle: 'Data Pipeline (ETL), Analytics & ML Engineer',
    faTitle: 'مهندس پایپ‌لاین داده (ETL)، تحلیل داده و یادگیری ماشین',
    enPosition: 'Senior Data Engineering & ML Specialist',
    faPosition: 'متخصص پردازش داده، پایپ‌لاین‌های ETL و مدل‌های یادگیری ماشین',
    enResponsibility: 'Build streaming/batch ETL pipelines, data validation, analytics queries, and ML inference APIs.',
    faResponsibility: 'پیاده‌سازی پایپ‌لاین‌های جمع‌آوری، پاک‌سازی و تحلیل داده و سروینگ مدل‌های یادگیری ماشین.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Data & Machine Learning Engineer. Build reliable ETL pipelines, data validation schemas, and low-latency model inference endpoints.',
  },
  // 13. Payments & Fintech
  {
    id: 'spec-payments-fintech',
    section: 'Payments & Fintech',
    role: 'backend',
    enTitle: 'Payment Gateways, Billing & Ledger Specialist',
    faTitle: 'متخصص درگاه پرداخت، کیف پول و تراکنش‌های مالی',
    enPosition: 'Principal Fintech & Payment Integration Engineer',
    faPosition: 'مهندس ارشد فین‌تک، درگاه‌های پرداخت، وب‌هوک‌های بانکی و دفترکل مالی',
    enResponsibility: 'Implement idempotent payment webhooks, double-entry ledgers, subscriptions, and fraud checks.',
    faResponsibility: 'پیاده‌سازی امن درگاه‌های پرداخت، کیف پول، تراکنش‌های بدون تکرار (Idempotent) و تسویه حساب.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal Fintech & Payments Engineer. Implement idempotent payment processing, cryptographic webhook verification, and atomic ledger transactions.',
  },
  // 14. Messaging & Realtime
  {
    id: 'spec-messaging-queues-bots',
    section: 'Messaging & Realtime',
    role: 'backend',
    enTitle: 'Queues (Kafka/RabbitMQ), WebSockets & Bots',
    faTitle: 'متخصص صف پیام، وب‌سوکت و ربات‌های تلگرام/دیسکورد',
    enPosition: 'Senior Event-Driven & Bot Integration Engineer',
    faPosition: 'متخصص صف‌های پیام (RabbitMQ/BullMQ)، نوتیفیکیشن و بات‌های پیام‌رسان',
    enResponsibility: 'Build async job workers, realtime WebSocket rooms, notification dispatchers, and chat bots.',
    faResponsibility: 'پیاده‌سازی صف‌های پردازش پس‌زمینه، ارتباط آنی WebSocket، ارسال ایمیل/پیامک و ربات‌ها.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Event-Driven Messaging & Bot Engineer. Build resilient background workers, dead-letter queues, WebSocket hubs, and bot webhooks.',
  },
  // 15. Mobile & Edge
  {
    id: 'spec-mobile-rn-flutter-pwa',
    section: 'Mobile & Edge',
    role: 'frontend',
    enTitle: 'Mobile (React Native / Flutter) & PWA Specialist',
    faTitle: 'متخصص موبایل (React Native / Flutter) و وب‌اپلیکیشن PWA',
    enPosition: 'Senior Mobile & Offline-First PWA Engineer',
    faPosition: 'مهندس ارشد اپلیکیشن موبایل و PWA با قابلیت کار آفلاین',
    enResponsibility: 'Develop responsive mobile screens, offline sync, service workers, and native device bridges.',
    faResponsibility: 'توسعه رابط موبایل، همگام‌سازی آفلاین، Service Worker و بهینه‌سازی مصرف باتری و شبکه.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Mobile & PWA Engineer specializing in React Native, Flutter, and Offline-First Progressive Web Apps.',
  },
  // 16. UI/UX & Accessibility
  {
    id: 'spec-uiux-rtl-i18n',
    section: 'UI/UX & Accessibility',
    role: 'frontend',
    enTitle: 'UI/UX Design System, RTL/Persian & Accessibility',
    faTitle: 'متخصص طراحی UI/UX، فارسی‌سازی (RTL) و دسترس‌پذیری',
    enPosition: 'Principal Design System, i18n & Accessibility Specialist',
    faPosition: 'متخصص تجربه کاربری، طراحی سیستم، چندزبانگی (فارسی/انگلیسی) و WCAG',
    enResponsibility: 'Refine visual hierarchy, bidirectional RTL/LTR layouts, keyboard navigation, and ARIA compliance.',
    faResponsibility: 'بهبود زیبایی بصری، چیدمان استاندارد راست‌به‌چپ فارسی (RTL) و دسترس‌پذیری کامل رابط کاربری.',
    powerLevel: 'pro',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal UI/UX Design System, RTL/LTR Internationalization, and WCAG Accessibility Specialist. Craft polished, accessible, bilingual user interfaces.',
  },
  // 17. Performance & Caching
  {
    id: 'spec-performance-profiler',
    section: 'Performance & Caching',
    role: 'custom',
    enTitle: 'Performance Profiler & Latency Optimizer',
    faTitle: 'متخصص بهینه‌سازی سرعت، مصرف حافظه و مقیاس‌پذیری',
    enPosition: 'Staff Performance & Systems Optimization Engineer',
    faPosition: 'مهندس ارشد بهینه‌سازی کارایی، رفع گلوگاه‌های سرعت و نشت حافظه',
    enResponsibility: 'Eliminate memory leaks, N+1 queries, bundle bloat, and optimize p99 API response latency.',
    faResponsibility: 'شناسایی و رفع گلوگاه‌های سرعت در فرانت‌اند و بک‌اند، کاهش حجم باندل و بهینه‌سازی مصرف رم و CPU.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Staff Performance Optimization Engineer. Profile and eliminate CPU/memory bottlenecks, slow queries, and unnecessary re-renders.',
  },
  // 18. SEO & Web Vitals
  {
    id: 'spec-seo-webvitals',
    section: 'SEO & Web Vitals',
    role: 'frontend',
    enTitle: 'Technical SEO, Schema.org & Core Web Vitals',
    faTitle: 'متخصص سئو فنی، متاتگ‌ها و Core Web Vitals',
    enPosition: 'Senior Technical SEO & Web Performance Specialist',
    faPosition: 'متخصص سئو تکنیکال، داده‌های ساختاریافته (JSON-LD) و سرعت صفحات',
    enResponsibility: 'Implement OpenGraph metadata, JSON-LD structured data, sitemaps, and semantic HTML.',
    faResponsibility: 'پیاده‌سازی استانداردهای سئو فنی، اسکیمای JSON-LD، متاتگ‌های اشتراک‌گذاری و بهبود رتبه صفحه.',
    powerLevel: 'standard',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Technical SEO & Core Web Vitals Specialist. Implement semantic HTML, JSON-LD structured data, OpenGraph tags, and fast LCP/CLS metrics.',
  },
  // 19. Blockchain & Web3
  {
    id: 'spec-web3-solidity',
    section: 'Blockchain & Web3',
    role: 'custom',
    enTitle: 'Smart Contracts (Solidity) & Web3 Specialist',
    faTitle: 'متخصص بلاکچین، قرارداد هوشمند (Solidity) و Web3',
    enPosition: 'Lead Smart Contract Engineer & Web3 Auditor',
    faPosition: 'مهندس و بازرس امنیتی قراردادهای هوشمند و اتصال کیف پول Web3',
    enResponsibility: 'Develop and audit Solidity smart contracts, prevent reentrancy bugs, and integrate Web3 wallets.',
    faResponsibility: 'توسعه و بازرسی امنیتی قراردادهای هوشمند، بهینه‌سازی Gas و اتصال به کیف پول‌های رمزارزی.',
    powerLevel: 'ultra',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Lead Smart Contract & Web3 Security Engineer. Write gas-efficient, reentrancy-safe Solidity contracts and clean ethers/viem integrations.',
  },
  // 20. Product & Research
  {
    id: 'spec-product-docs-openapi',
    section: 'Product & Research',
    role: 'custom',
    enTitle: 'Technical Writer, README & OpenAPI Specialist',
    faTitle: 'متخصص مستندسازی فنی، README و مستندات API',
    enPosition: 'Principal Technical Writer & Developer Experience Lead',
    faPosition: 'نویسنده ارشد مستندات فنی، راهنمای نصب و کاتالوگ OpenAPI/Swagger',
    enResponsibility: 'Write crystal-clear README guides, architecture diagrams, changelogs, and OpenAPI specs.',
    faResponsibility: 'نگارش مستندات دقیق پروژه، راهنمای نصب و راه‌اندازی، دیاگرام‌های معماری و مستندات API.',
    powerLevel: 'standard',
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal Technical Writer & DX Architect. Produce accurate, developer-friendly README documentation, setup guides, and OpenAPI specifications.',
  },
];

export const POWER_LEVEL_META: Record<
  AgentPowerLevel,
  {
    en: string;
    fa: string;
    short: string;
    defaultTemp: number;
    maxTokens: number;
    directive: string;
  }
> = {
  eco: {
    en: 'Eco · Fast',
    fa: 'سبک و سریع (Eco)',
    short: 'Eco',
    defaultTemp: 0.15,
    maxTokens: 1024,
    directive: 'Be concise, direct, and fast; optimize for minimal latency and token efficiency.',
  },
  standard: {
    en: 'Standard · Balanced',
    fa: 'استاندارد (Balanced)',
    short: 'Std',
    defaultTemp: 0.25,
    maxTokens: 2048,
    directive: 'Deliver balanced, practical engineering output with clear rationale and validation.',
  },
  pro: {
    en: 'Pro · High Power',
    fa: 'قدرتمند (Pro)',
    short: 'Pro',
    defaultTemp: 0.2,
    maxTokens: 4096,
    directive: 'Apply senior-level architectural rigor, thorough edge-case analysis, and production-grade code.',
  },
  ultra: {
    en: 'Ultra · Deep Reasoning',
    fa: 'حداکثر قدرت (Ultra)',
    short: 'Ultra',
    defaultTemp: 0.15,
    maxTokens: 8192,
    directive: 'Perform exhaustive deep reasoning, multi-step verification, security hardening, and root-cause analysis.',
  },
};

export const PROVIDER_MODELS: Record<
  LLMProvider,
  { label: string; envRef: string; models: string[] }
> = {
  gemini: {
    label: 'Google Gemini (AI Studio)',
    envRef: 'GEMINI_API_KEY',
    models: ['gemini-4-hydrogen', 'gemini-4-argon', 'gemini-4-carbon', 'gemini-3.1-flash-lite'],
  },
  openai: {
    label: 'OpenAI ChatGPT',
    envRef: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4.1', 'o3-mini'],
  },
  anthropic: {
    label: 'Anthropic Claude',
    envRef: 'ANTHROPIC_API_KEY',
    models: ['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
  },
  ollama: {
    label: 'Local Ollama',
    envRef: 'OLLAMA_BASE_URL',
    models: ['ollama/qwen2.5-coder:32b', 'ollama/llama3.3:70b', 'ollama/deepseek-r1:14b'],
  },
  opencode: {
    label: 'OpenCode Zen (Free Models)',
    envRef: 'OPENCODE_API_KEY',
    models: [
      'big-pickle',
      'deepseek-v4.1-flash-free',
      'glm-5.3-flash-free',
      'mimo-v2.6-flash-free',
      'minimax-m3.1-flash-free',
      'longcat-2.5-free',
      'nemotron-3.5-super-vl-free',
      'nemotron-3.5-lightning-free',
      'iceman-free',
      'inkling-2-small-free',
      'beam-free',
      'flint-40b-free',
    ],
  },
};

export const AGENT_ROLE_TEMPLATES: AgentRoleTemplate[] = [
  {
    id: 'tpl-manager',
    role: 'manager',
    title: 'Manager Agent',
    subtitle: 'Breaks down tasks, coordinates handoffs, and approves completion.',
    section: 'Architecture & Management',
    positionTitle: 'Lead Architect & Manager',
    responsibility: 'Break down requirements, audit outputs, and delegate domain fixes.',
    powerLevel: 'ultra',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-4-hydrogen',
    defaultTemperature: 0.2,
    defaultTools: { readFile: true, writeFile: false, execBash: false },
    systemPrompt:
      'You are the Lead Software Architect & GroupChat Manager. Break the user task into concrete backend, frontend, security, and verification milestones. Assign the next agent clearly and declare TERMINATE only after Executor confirms passing checks.',
  },
  {
    id: 'tpl-backend',
    role: 'backend',
    title: 'Backend Agent',
    subtitle: 'Designs FastAPI/Express endpoints, SQLite/Postgres schemas, and core services.',
    section: 'Backend & API',
    positionTitle: 'Senior Backend Engineer',
    responsibility: 'Design APIs, validation, business logic, and database persistence.',
    powerLevel: 'pro',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-4-hydrogen',
    defaultTemperature: 0.2,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Senior Backend Engineer. Write clean, production-ready Python (FastAPI) or TypeScript APIs with input validation, structured error handling, and database persistence. Emit concrete file payloads when creating code.',
  },
  {
    id: 'tpl-frontend',
    role: 'frontend',
    title: 'Frontend Agent',
    subtitle: 'Builds React + Tailwind interfaces, state management, and accessible controls.',
    section: 'Frontend & UI',
    positionTitle: 'Principal Frontend Engineer',
    responsibility: 'Build accessible React UI, state flows, and responsive layouts.',
    powerLevel: 'pro',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4o',
    defaultTemperature: 0.3,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal Frontend Engineer. Produce modular React + TypeScript + Tailwind CSS components with accessible form controls, loading/empty/error states, and WebSocket integration.',
  },
  {
    id: 'tpl-security',
    role: 'security_qa',
    title: 'Security & QA Agent',
    subtitle: 'Audits OWASP risks, validates sanitization, and writes automated tests.',
    section: 'Security & QA',
    positionTitle: 'Security & QA Auditor',
    responsibility: 'Audit OWASP security risks and write deterministic automated tests.',
    powerLevel: 'ultra',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-3-7-sonnet-latest',
    defaultTemperature: 0.1,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are an Application Security & QA Engineer. Audit generated code for injection, auth bypass, path traversal, and unsafe shell execution. Write deterministic pytest or node:test assertions covering happy paths and edge cases.',
  },
  {
    id: 'tpl-executor',
    role: 'executor',
    title: 'Executor Agent',
    subtitle: 'Runs code inside the isolated Linux Docker sandbox and reports logs.',
    section: 'DevOps & Sandbox',
    positionTitle: 'Sandbox DevOps Executor',
    responsibility: 'Execute builds, linters, and test suites inside Linux sandbox.',
    powerLevel: 'standard',
    defaultProvider: 'ollama',
    defaultModel: 'ollama/qwen2.5-coder:32b',
    defaultTemperature: 0.0,
    defaultTools: { readFile: true, writeFile: true, execBash: true },
    systemPrompt:
      'You are the Sandbox Execution & DevOps Agent. Execute tests, linters, and build checks inside the isolated Linux Docker container. Report exact stdout/stderr exit codes so Backend/Frontend agents can self-heal on failure.',
  },
  {
    id: 'tpl-database',
    role: 'backend',
    title: 'Database & SQL Agent',
    subtitle: 'Designs PostgreSQL/SQLite schemas, migrations, indexes, and Redis caching.',
    section: 'Database & Storage',
    positionTitle: 'Principal Database Architect',
    responsibility: 'Design relational schemas, SQL queries, migrations, and caching layers.',
    powerLevel: 'ultra',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-4-hydrogen',
    defaultTemperature: 0.15,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal Database & Storage Architect. Design normalized SQL schemas, high-performance indexes, safe migrations, and Redis caching layers.',
  },
  {
    id: 'tpl-ai-rag',
    role: 'custom',
    title: 'AI & Prompt Architect',
    subtitle: 'Builds LLM agents, RAG vector pipelines, tool schemas, and guardrails.',
    section: 'AI & Prompts',
    positionTitle: 'Principal AI & RAG Architect',
    responsibility: 'Design LLM system prompts, RAG retrieval pipelines, and structured outputs.',
    powerLevel: 'ultra',
    defaultProvider: 'gemini',
    defaultModel: 'gemini-4-hydrogen',
    defaultTemperature: 0.2,
    defaultTools: { readFile: true, writeFile: true, execBash: false },
    systemPrompt:
      'You are a Principal AI & Prompt Engineering Architect. Design structured LLM prompts, function-calling schemas, RAG pipelines, and output guardrails.',
  },
];

export const DEFAULT_SEED_WORKFLOWS: WorkflowConfig[] = [
  {
    id: 'wf-fullstack-pipeline',
    name: 'Full-Stack Engineering & Security Pipeline',
    description:
      'Five-agent software delivery graph: Manager orchestrates Backend and Frontend, Security & QA audits and writes tests, and Executor verifies inside Linux Docker sandbox.',
    maxRounds: 6,
    humanInTheLoop: true,
    updatedAt: '2026-11-14T08:00:00.000Z',
    nodes: [
      {
        id: 'node-manager',
        type: 'agentNode',
        position: { x: 40, y: 180 },
        data: {
          label: 'Manager Agent',
          role: 'manager',
          section: 'Architecture & Management',
          positionTitle: 'Lead Architect & Manager',
          responsibility: 'Break down requirements, audit outputs, and delegate domain fixes.',
          powerLevel: 'ultra',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.2,
          systemPrompt: AGENT_ROLE_TEMPLATES[0].systemPrompt,
          tools: { readFile: true, writeFile: false, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-backend',
        type: 'agentNode',
        position: { x: 340, y: 70 },
        data: {
          label: 'Backend Agent',
          role: 'backend',
          section: 'Backend & API',
          positionTitle: 'Senior Backend Engineer',
          responsibility: 'Design APIs, validation, business logic, and database persistence.',
          powerLevel: 'pro',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.2,
          systemPrompt: AGENT_ROLE_TEMPLATES[1].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-frontend',
        type: 'agentNode',
        position: { x: 340, y: 310 },
        data: {
          label: 'Frontend Agent',
          role: 'frontend',
          section: 'Frontend & UI',
          positionTitle: 'Principal Frontend Engineer',
          responsibility: 'Build accessible React UI, state flows, and responsive layouts.',
          powerLevel: 'pro',
          provider: 'openai',
          model: 'gpt-4o',
          envSecretRef: 'OPENAI_API_KEY',
          temperature: 0.3,
          systemPrompt: AGENT_ROLE_TEMPLATES[2].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-security',
        type: 'agentNode',
        position: { x: 660, y: 180 },
        data: {
          label: 'Security & QA Agent',
          role: 'security_qa',
          section: 'Security & QA',
          positionTitle: 'Security & QA Auditor',
          responsibility: 'Audit OWASP security risks and write deterministic automated tests.',
          powerLevel: 'ultra',
          provider: 'anthropic',
          model: 'claude-3-7-sonnet-latest',
          envSecretRef: 'ANTHROPIC_API_KEY',
          temperature: 0.1,
          systemPrompt: AGENT_ROLE_TEMPLATES[3].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-executor',
        type: 'agentNode',
        position: { x: 960, y: 180 },
        data: {
          label: 'Executor Agent',
          role: 'executor',
          section: 'DevOps & Sandbox',
          positionTitle: 'Sandbox DevOps Executor',
          responsibility: 'Execute builds, linters, and test suites inside Linux sandbox.',
          powerLevel: 'standard',
          provider: 'ollama',
          model: 'ollama/qwen2.5-coder:32b',
          envSecretRef: 'OLLAMA_BASE_URL',
          temperature: 0.0,
          systemPrompt: AGENT_ROLE_TEMPLATES[4].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: true },
          status: 'idle',
        },
      },
    ],
    edges: [
      { id: 'e-mgr-be', source: 'node-manager', target: 'node-backend', label: 'API Spec' },
      { id: 'e-mgr-fe', source: 'node-manager', target: 'node-frontend', label: 'UI Spec' },
      { id: 'e-be-sec', source: 'node-backend', target: 'node-security', label: 'Audit' },
      { id: 'e-fe-sec', source: 'node-frontend', target: 'node-security', label: 'Audit' },
      { id: 'e-sec-exec', source: 'node-security', target: 'node-executor', label: 'Run Tests' },
      { id: 'e-exec-be', source: 'node-executor', target: 'node-backend', label: 'Self-Heal Logs', animated: true },
    ],
  },
  {
    id: 'wf-security-audit',
    name: 'Security Audit & Self-Healing Sandbox',
    description:
      'Focused 3-agent loop using distinct Gemini system prompts for static analysis, patch generation, and isolated container verification.',
    maxRounds: 4,
    humanInTheLoop: true,
    updatedAt: '2026-11-14T08:00:00.000Z',
    nodes: [
      {
        id: 'node-mgr-2',
        type: 'agentNode',
        position: { x: 80, y: 180 },
        data: {
          label: 'Triage Manager',
          role: 'manager',
          section: 'Architecture & Management',
          positionTitle: 'Security Triage Manager',
          responsibility: 'Triage audit findings and coordinate remediation patches.',
          powerLevel: 'ultra',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.15,
          systemPrompt: AGENT_ROLE_TEMPLATES[0].systemPrompt,
          tools: { readFile: true, writeFile: false, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-sec-2',
        type: 'agentNode',
        position: { x: 400, y: 180 },
        data: {
          label: 'Vulnerability Auditor',
          role: 'security_qa',
          section: 'Security & QA',
          positionTitle: 'Vulnerability Auditor',
          responsibility: 'Scan dependencies, auth boundaries, and generate security patches.',
          powerLevel: 'ultra',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.1,
          systemPrompt: AGENT_ROLE_TEMPLATES[3].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: false },
          status: 'idle',
        },
      },
      {
        id: 'node-exec-2',
        type: 'agentNode',
        position: { x: 720, y: 180 },
        data: {
          label: 'Docker Sandbox Runner',
          role: 'executor',
          section: 'DevOps & Sandbox',
          positionTitle: 'Sandbox Verifier',
          responsibility: 'Verify remediation patches in isolated Docker container.',
          powerLevel: 'standard',
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          envSecretRef: 'GEMINI_API_KEY',
          temperature: 0.0,
          systemPrompt: AGENT_ROLE_TEMPLATES[4].systemPrompt,
          tools: { readFile: true, writeFile: true, execBash: true },
          status: 'idle',
        },
      },
    ],
    edges: [
      { id: 'e2-1', source: 'node-mgr-2', target: 'node-sec-2', label: 'Scope' },
      { id: 'e2-2', source: 'node-sec-2', target: 'node-exec-2', label: 'Verify Patch' },
    ],
  },
];

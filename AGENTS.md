# AGENTS.md — MernProject Engineering Guidelines

This document outlines the core architecture principles, conventions, and operational workflows for AI agents and human contributors working within the **MernProject** codebase.

---

## 1. Pure MERN Architecture

MernProject is strictly a **Pure MERN** application. All features, APIs, and business operations must conform to this architecture:

- **Backend (`server/`)**: Node.js and Express with MongoDB / Mongoose.
  - Native ES Modules (`"type": "module"`).
  - Single unified REST API running on port `4000` (`http://localhost:4000/api`).
  - Both storefront (`client/`) and dashboard (`admin/`) communicate with this same API service; there is **no separate admin backend**.
- **Storefront Client (`client/`)**: React 18 SPA built with Vite, Tailwind CSS, Lucide icons, and React Router on port `5173`.
- **Admin Dashboard (`admin/`)**: React 18 SPA built with Vite, Tailwind CSS, Lucide icons, and React Router on port `5174`.
- **No Python / FastAPI Services**:
  - Do **not** reintroduce, revive, or couple Python, FastAPI, Flask, or external microservices into the stack.
  - Any pricing estimation, device grading, or valuation logic must be authored directly in JavaScript/Node.js within `server/src/services/` or `server/src/modules/`.
  - Stale files under `server/src/ml/` are legacy artifacts and must remain deprecated/unlinked.

---

## 2. Respect Existing Code, Patterns & Style

Maintain consistency with the surrounding codebase and adhere to established patterns:

- **Directory Conventions**:
  - `server/src/controllers/` — Request handlers and HTTP response formatting.
  - `server/src/models/` — Mongoose schemas, indexes, and lifecycle hooks.
  - `server/src/routes/` — Express route definitions with attached auth & validation middlewares.
  - `server/src/middleware/` — Authentication, rate limiting, error handling, upload handling.
  - `server/src/validators/` — Request payload validation (Zod schemas).
  - `server/src/services/` — Reusable domain logic (eSewa gateway, email, file storage).
  - `client/src/` & `admin/src/` — Components, pages, hooks, contexts, and API utilities.
- **Data Modeling & Validation**:
  - Respect existing model enums and constraints (e.g., `Device.js` uses strict enums: `ALLOWED_CONDITIONS = ["new", "like_new", "pre_owned", "refurbished"]`, `ALLOWED_AVAILABILITY = ["in_stock", "out_of_stock", "coming_soon"]`).
  - Do not create redundant Mongoose indexes (avoid specifying both `{ index: true }` and `schema.index(...)` for the same field).
- **Style Rules**:
  - Match existing code formatting, naming styles (camelCase for variables/functions, PascalCase for components/models), and comment conventions.
  - **Avoid unnecessary boilerplate**: Do not generate excessive single-use abstraction files or fragmented utility folders for trivial logic.
  - **Preserve working code**: Never perform unprompted rewrites, mass formatting overhauls, or refactors of working modules unrelated to the assigned task. Preserve existing comments and docstrings.

---

## 3. Scoped Changes & Secrets Handling

- **Minimal Blast Radius**: Touch only the specific files required to complete the task. Avoid broad, sweeping modifications across multiple directories.
- **Zero Secret Leakage**:
  - **Never** read, write, log, commit, or expose real production secrets, API tokens, or user credentials.
  - Do not overwrite production or developer `.env` files.
  - If a feature requires new environment configuration, update the corresponding `.env.example` (`server/.env.example`, `client/.env.example`, or `admin/.env.example`) with dummy values and descriptive comments.
- **Local Dev Fallbacks**:
  - Existing default database: `mongodb://127.0.0.1:27017/cashyourphone` (kept unchanged so existing local data remains available).
  - Keep the existing MongoDB database name and `CLOUDINARY_FOLDER=cashyourphone` unless intentionally migrating data and uploaded assets; changing either can make existing data/assets appear missing.
  - Upload mode: `UPLOAD_MODE=local` saves uploads locally to `server/uploads` without requiring third-party Cloudinary credentials.
  - Payment gateway: Use standard eSewa sandbox/UAT credentials (`EPAYTEST`).

---

## 4. Verification & Testing

Every modification must be verified before concluding work:

1. **Frontend Builds**:
   ```bash
   cd client && npm run build
   cd ../admin && npm run build
   ```
   Both Vite builds must exit with code `0` and without syntax or bundle errors.

2. **Backend Syntax & Sanity**:
   ```bash
   cd server && node -c server.js
   ```
   Ensure server entry and modified modules have no syntax errors or unresolved imports.

3. **Database & Seed Scripts**:
   - If database schemas or seed data are touched, verify that `npm run seed` and `npm run seed:admin` execute successfully without validation errors.

4. **Transparent Reporting**:
   - Always report exactly what files were created or modified.
   - Clearly identify anything that could not be verified automatically and requires manual testing (e.g., live eSewa redirect flow, production Redis BullMQ queues, live Cloudinary uploads).

---

## 5. Quick Reference

| Service | Directory | Tech Stack | Dev Command | Default Port |
| :--- | :--- | :--- | :--- | :--- |
| **Backend API** | `server/` | Node.js, Express, Mongoose | `npm run dev` | `http://localhost:4000` |
| **Storefront** | `client/` | React 18, Vite, Tailwind CSS | `npm run dev` | `http://localhost:5173` |
| **Admin Panel** | `admin/` | React 18, Vite, Tailwind CSS | `npm run dev` | `http://localhost:5174` |
